const { readJson, writeJson } = require("./dataStore");
const { getPrice } = require("./mexcMarket");
const { getOpenPositions, closeLivePositionVolume } = require("./mexcFutures");
const { sendTelegram } = require("./telegram");
const { registerTradeClose } = require("./riskGuard");
const { stopBot } = require("./botState");

const FILE = "mexc_managed_positions.json";
let running = false;

function load() {
  return readJson(FILE, []);
}

function save(rows) {
  writeJson(FILE, rows.slice(-100));
}

function getManagedPositionsSummary() {
  return load().filter((row) => row.active).map((row) => ({
    symbol: row.symbol,
    side: row.side,
    entry: row.entry,
    stopLossPrice: row.stopLossPrice,
    tp1Done: row.tp1Done,
    tp2Done: row.tp2Done,
    profitGuardArmed: row.profitGuardArmed,
    bestPnlUsdt: row.bestPnlUsdt,
    lastPnl: row.lastPnl,
    createdAt: row.createdAt,
  }));
}

function registerManagedPosition({ symbol, side, tradePlan, vol, marginUsdt, equityUsdt, leverage }) {
  const rows = load();
  rows.push({
    id: `mexc_${Date.now()}`,
    symbol: String(symbol).replace("_", ""),
    side,
    expectedVol: Number(vol),
    marginUsdt: Number(marginUsdt || 0),
    equityUsdt: Number(equityUsdt || 0),
    leverage: Number(leverage || 1),
    entry: Number(tradePlan.entry),
    tp1Price: Number(tradePlan.tp1Price),
    tp2Price: Number(tradePlan.tp2Price),
    tp3Price: Number(tradePlan.tp3Price),
    stopLossPrice: Number(tradePlan.stopLossPrice),
    tp1Done: false,
    tp2Done: false,
    peakPrice: Number(tradePlan.entry),
    active: true,
    createdAt: new Date().toISOString(),
  });
  save(rows);
}

function calculatePositionPnl(row, price, entryOverride = null) {
  const entry = Number(entryOverride || row.entry);
  if (!entry || !price) return { percent: 0, usdt: 0 };
  const percent = row.side === "LONG"
    ? ((price - entry) / entry) * 100
    : ((entry - price) / entry) * 100;
  const usdt = Number(row.marginUsdt || 0) * Number(row.leverage || 1) * percent / 100;
  return { percent: Number(percent.toFixed(3)), usdt: Number(usdt.toFixed(3)) };
}

function accountPnlPercent(row, pnl) {
  const equity = Number(row.equityUsdt || 0);
  if (equity > 0) return Number(pnl.usdt || 0) / equity * 100;
  // Yalnızca eski, equity kaydı bulunmayan pozisyonlar için güvenli geri dönüş.
  return Number(pnl.percent || 0);
}

function getRotationBlockedSymbols() {
  const cooldownMs = Math.max(1, Number(process.env.WIN_ROTATION_COOLDOWN_MINUTES || 30)) * 60 * 1000;
  const now = Date.now();
  return new Set(load().filter((row) => {
    if (row.active) return true;
    const closedAt = row.closedAt ? new Date(row.closedAt).getTime() : 0;
    return closedAt > 0 && now - closedAt < cooldownMs;
  }).map((row) => String(row.symbol).replace("_", "")));
}

function targetReached(row, price, target) {
  return row.side === "LONG" ? price >= target : price <= target;
}

function retraceReached(row, price) {
  const pct = Math.max(0.05, Number(process.env.TRAILING_RETRACE_PERCENT || 0.35));
  return row.side === "LONG"
    ? price <= row.peakPrice * (1 - pct / 100)
    : price >= row.peakPrice * (1 + pct / 100);
}

function numberEnv(name, fallback, min = -Infinity) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
}

function evaluateProfitDefense(row, pnl, now = Date.now()) {
  if (process.env.PROFIT_GUARD_ENABLED === "false" || row.tp1Done) return { action: null };

  const currentPercent = Number(pnl.percent || 0);
  const previousPeak = Number(row.bestPnlPercent || 0);
  const peakPercent = Math.max(previousPeak, currentPercent);
  const armUsdt = numberEnv("PROFIT_GUARD_ARM_USDT", 0.30, 0.05);
  const givebackRatio = numberEnv("PROFIT_GUARD_GIVEBACK_PERCENT", 25, 5) / 100;
  const estimatedRoundTripFeePercent = numberEnv("PROFIT_GUARD_FEE_PERCENT", 0.10, 0);
  const minNetUsdt = numberEnv("PROFIT_GUARD_MIN_NET_USDT", 0.02, 0);
  const notionalUsdt = Number(row.marginUsdt || 0) * Number(row.leverage || 1);
  const estimatedFeeUsdt = notionalUsdt * estimatedRoundTripFeePercent / 100;
  const estimatedNetUsdt = Number(pnl.usdt || 0) - estimatedFeeUsdt;
  const giveback = peakPercent > 0 ? (peakPercent - currentPercent) / peakPercent : 0;
  const peakUsdt = Math.max(Number(row.bestPnlUsdt || 0), Number(pnl.usdt || 0));
  const usdtGiveback = peakUsdt > 0 ? (peakUsdt - Number(pnl.usdt || 0)) / peakUsdt : 0;
  const armed = Boolean(row.profitGuardArmed) || peakUsdt >= armUsdt;

  const maxMinutes = numberEnv("MAX_POSITION_MINUTES", 45, 5);
  const timeExitMaxLossPercent = numberEnv("TIME_EXIT_MAX_LOSS_PERCENT", 0.12, 0);
  const ageMinutes = Math.max(0, (now - new Date(row.createdAt).getTime()) / 60000);

  if (armed && usdtGiveback >= givebackRatio && currentPercent > estimatedRoundTripFeePercent && estimatedNetUsdt >= minNetUsdt) {
    return { action: "PROFIT_GUARD_EXIT", armed, peakPercent, peakUsdt, giveback: usdtGiveback, estimatedNetUsdt, ageMinutes };
  }

  if (ageMinutes >= maxMinutes && currentPercent >= -timeExitMaxLossPercent) {
    const action = estimatedNetUsdt > 0 ? "TIME_PROFIT_EXIT" : "TIME_FLAT_EXIT";
    return { action, armed, peakPercent, peakUsdt, giveback: usdtGiveback, estimatedNetUsdt, ageMinutes };
  }

  return { action: null, armed, peakPercent, peakUsdt, giveback: usdtGiveback, estimatedNetUsdt, ageMinutes };
}

function protectedStop(row, lockPercent = 0.15) {
  const entry = Number(row.entry);
  return row.side === "LONG"
    ? entry * (1 + lockPercent / 100)
    : entry * (1 - lockPercent / 100);
}

function dollarStage(row, pnl) {
  const equivalentUsdt = Number(row.marginUsdt || 0) * Number(row.leverage || 1) * Number(pnl.percent || 0) / 100;
  if (!row.tp1Done && equivalentUsdt >= numberEnv("TP1_TRIGGER_USDT", 0.50, 0.05)) return "TP1";
  if (row.tp1Done && !row.tp2Done && equivalentUsdt >= numberEnv("TP2_TRIGGER_USDT", 1.00, 0.10)) return "TP2";
  if (row.tp2Done && equivalentUsdt >= numberEnv("FINAL_TARGET_USDT", 2.00, 0.20)) return "FINAL";
  return null;
}

async function managePositions() {
  if (running || process.env.MEXC_LIVE_TRADING_ENABLED !== "true") return;
  running = true;
  try {
    const rows = load();
    const activeRows = rows.filter((row) => row.active);
    if (!activeRows.length) return;
    const positions = await getOpenPositions();

    for (const row of activeRows) {
      const position = positions.find((p) => String(p.symbol).replace("_", "") === row.symbol && (row.side === "LONG" ? Number(p.positionType) === 1 : Number(p.positionType) === 2));
      if (!position) {
        const ageMs = Date.now() - new Date(row.createdAt).getTime();
        if (ageMs < 60000) continue;
        row.active = false;
        row.closedAt = new Date().toISOString();
        row.closeReason = "EXCHANGE_OR_MANUAL_CLOSE";
        const lastPnl = row.lastPnl || { percent: 0, usdt: 0 };
        if (!row.riskRegistered) {
          registerTradeClose(accountPnlPercent(row, lastPnl), "LIVE");
          row.riskRegistered = true;
        }
        await sendTelegram(`✅ <b>MEXC İŞLEM KAPANDI</b>\n${row.symbol} ${row.side}\nSon ölçülen sonuç: <b>%${lastPnl.percent}</b> / yaklaşık <b>${lastPnl.usdt} USDT</b>\nKesin gerçekleşen sonucu MEXC işlem geçmişinden kontrol et.`);
        continue;
      }
      const price = Number((await getPrice(row.symbol)).price);
      const entryPrice = Number(position.holdAvgPrice || position.openAvgPrice || row.entry);
      const pnl = calculatePositionPnl(row, price, entryPrice);
      const exchangePnl = Number(position.unrealisedPnl ?? position.unrealizedPnl ?? position.unrealisedProfit ?? position.pnl);
      if (Number.isFinite(exchangePnl)) pnl.usdt = Number(exchangePnl.toFixed(3));
      row.entry = entryPrice;
      row.lastPrice = price;
      row.lastPnl = pnl;
      const defense = evaluateProfitDefense(row, pnl);
      row.bestPnlPercent = Number(defense.peakPercent || row.bestPnlPercent || 0);
      row.bestPnlUsdt = Math.max(Number(row.bestPnlUsdt || 0), Number(pnl.usdt || 0));
      row.profitGuardArmed = Boolean(defense.armed);
      row.peakPrice = row.side === "LONG" ? Math.max(Number(row.peakPrice), price) : Math.min(Number(row.peakPrice), price);
      const available = Math.max(0, Number(position.holdVol));
      const stage = dollarStage(row, pnl);

      if (row.profitGuardArmed && !row.profitGuardNotified) {
        row.profitGuardNotified = true;
        await sendTelegram(`🔐 <b>MEXC KÂR KORUMASI AKTİF</b>\n${row.symbol} ${row.side}\nAçık kâr: <b>${pnl.usdt} USDT</b>\nZirve kârın %${numberEnv("PROFIT_GUARD_GIVEBACK_PERCENT", 25, 5)} kadarı geri verilirse, komisyon sonrası pozitif sonuç korunacak.`);
      }

      const noticeMs = Math.max(1, Number(process.env.TELEGRAM_PNL_MINUTES || 5)) * 60 * 1000;
      const lastNoticeAt = row.lastPnlNoticeAt ? new Date(row.lastPnlNoticeAt).getTime() : 0;
      if (Date.now() - lastNoticeAt >= noticeMs) {
        row.lastPnlNoticeAt = new Date().toISOString();
        const icon = pnl.usdt >= 0 ? "🟢" : "🔴";
        await sendTelegram(`${icon} <b>MEXC POZİSYON DURUMU</b>\n${row.symbol} ${row.side}\nGiriş: <b>${entryPrice}</b>\nŞu an: <b>${price}</b>\nKâr/Zarar: <b>%${pnl.percent}</b>\nYaklaşık sonuç: <b>${pnl.usdt} USDT</b>`);
      }

      if (defense.action && available > 0) {
        const result = await closeLivePositionVolume(position, available, { restoreStopLossPrice: row.stopLossPrice });
        row.active = false;
        row.closedAt = new Date().toISOString();
        row.closeReason = defense.action;
        if (!row.riskRegistered) {
          registerTradeClose(accountPnlPercent(row, pnl), "LIVE");
          row.riskRegistered = true;
        }
        const title = defense.action === "PROFIT_GUARD_EXIT" ? "KÂR KORUMA ÇIKIŞI" : "SÜRE DOLUŞU ÇIKIŞI";
        await sendTelegram(`🔐 <b>MEXC ${title}</b>\n${row.symbol} ${row.side}\nEn iyi hareket: <b>%${Number(defense.peakPercent).toFixed(3)}</b>\nÇıkış anı: <b>%${pnl.percent}</b> / yaklaşık <b>${pnl.usdt} USDT</b>\nTahmini komisyon sonrası: <b>${Number(defense.estimatedNetUsdt).toFixed(3)} USDT</b>\nKapatılan kontrat: <b>${result.vol}</b>`);
        continue;
      }

      const dollarExitMode = process.env.DOLLAR_EXIT_MODE !== "false";

      if (stage === "TP1" || (!dollarExitMode && !row.tp1Done && targetReached(row, price, row.tp1Price))) {
        const nextStop = protectedStop(row, numberEnv("TP1_LOCK_PERCENT", 0.15, 0.02));
        const result = await closeLivePositionVolume(position, available * Number(process.env.TP1_CLOSE_PERCENT || 50) / 100, {
          restoreStopLossPrice: row.stopLossPrice,
          nextStopLossPrice: nextStop,
        });
        row.tp1Done = true;
        row.stopLossPrice = Number(result.protection?.stopLossPrice || nextStop);
        row.bestPnlUsdt = 0;
        if (result.fullyClosed) row.active = false;
        await sendTelegram(`🎯 <b>MEXC TP1 ALINDI</b>\n${row.symbol} ${row.side}\nKâr/Zarar: <b>%${pnl.percent}</b> / yaklaşık <b>${pnl.usdt} USDT</b>\nKapatılan kontrat: <b>${result.vol}</b>\nKalan pozisyon takip ediliyor.`);
        continue;
      }

      if (stage === "TP2" || (!dollarExitMode && row.tp1Done && !row.tp2Done && targetReached(row, price, row.tp2Price))) {
        const original = Number(row.expectedVol || position.holdVol);
        const nextStop = protectedStop(row, numberEnv("TP2_LOCK_PERCENT", 0.50, 0.05));
        const result = await closeLivePositionVolume(position, Math.min(available, original * Number(process.env.TP2_CLOSE_PERCENT || 30) / 100), {
          restoreStopLossPrice: row.stopLossPrice,
          nextStopLossPrice: nextStop,
        });
        row.tp2Done = true;
        row.stopLossPrice = Number(result.protection?.stopLossPrice || nextStop);
        row.bestPnlUsdt = 0;
        if (result.fullyClosed) row.active = false;
        await sendTelegram(`🎯 <b>MEXC TP2 ALINDI</b>\n${row.symbol} ${row.side}\nKâr/Zarar: <b>%${pnl.percent}</b> / yaklaşık <b>${pnl.usdt} USDT</b>\nKapatılan kontrat: <b>${result.vol}</b>\nKalan bölüm trailing ile korunuyor.`);
        continue;
      }

      if (stage === "FINAL" || (row.tp1Done && retraceReached(row, price))) {
        const result = await closeLivePositionVolume(position, available, { restoreStopLossPrice: row.stopLossPrice });
        row.active = false;
        row.closedAt = new Date().toISOString();
        row.closeReason = "TRAILING_EXIT";
        if (!row.riskRegistered) {
          registerTradeClose(accountPnlPercent(row, pnl), "LIVE");
          row.riskRegistered = true;
        }
        await sendTelegram(`🔒 <b>MEXC TRAILING ÇIKIŞ</b>\n${row.symbol} ${row.side}\nSonuç: <b>%${pnl.percent}</b> / yaklaşık <b>${pnl.usdt} USDT</b>\nKapatılan kontrat: <b>${result.vol}</b>`);
      }
    }
    save(rows);
  } catch (err) {
    console.error("MEXC pozisyon yöneticisi:", err.message);
    stopBot();
    await sendTelegram(`🚨 <b>MEXC POZİSYON YÖNETİM HATASI</b>\n${err.message}\nGüvenlik için yeni işlem taraması otomatik durduruldu. Açık pozisyonu MEXC üzerinden kontrol et.`).catch(() => {});
  } finally {
    running = false;
  }
}

function startMexcPositionManager() {
  const seconds = Math.max(5, Number(process.env.POSITION_MANAGER_SECONDS || 10));
  setInterval(() => managePositions(), seconds * 1000);
  console.log(`🛡️ MEXC pozisyon yöneticisi aktif: ${seconds} saniye`);
}

module.exports = { registerManagedPosition, getManagedPositionsSummary, getRotationBlockedSymbols, calculatePositionPnl, evaluateProfitDefense, dollarStage, managePositions, startMexcPositionManager };
