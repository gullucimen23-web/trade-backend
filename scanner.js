const { getKlines, getPrice } = require("./marketData");
const { analyzeMarket, analyzeMultiTimeframe, analyzeSwingPlan } = require("./strategy");
const { askOpenAIWithGuard } = require("./openaiGuard");
const { sendTelegram, sendTelegramWithButtons } = require("./telegram");
const { buildTradePlan } = require("./risk");
const { updatePaperTrades, createPaperTrade } = require("./paperTrade");
const { canOpenTrade, registerTradeOpen } = require("./riskGuard");
const { createApproval } = require("./approvalStore");
const { isBotActive } = require("./botState");
const { getActiveTrackedTradesBySymbol, closeTrackedTrade, saveTrackedTrade } = require("./trackStore");
const { calculatePnlPercent, getPositionAdvice, formatTradeReport } = require("./positionAdvisor");
const { buildOpportunityList, formatOpportunityTable } = require("./opportunityEngine");
const { openTestnetTrade } = require("./binanceFuturesTestnet");
const { openLiveTrade: openMexcLiveTrade, getOpenPositions: getMexcOpenPositions, getUsdtAccountState, calculateTieredMargin } = require("./mexcFutures");
const { getTradingUniverse } = require("./mexcUniverse");
const { evaluateLiveCandidate } = require("./liveGate");
const { registerManagedPosition, getRotationBlockedSymbols } = require("./mexcPositionManager");

const SYMBOLS = (process.env.SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

let lastSignals = {};
let lastFollowReportAt = {};
let lastMarketSummaryAt = 0;
let lastOpportunityRadarAt = 0;
let latestSignals = {};
let scanRunning = false;
let lastWatchAlerts = {};
let entryLocks = {};
let currentScanSymbols = [...SYMBOLS];
let currentMarketMeta = {};
let liveExecutionRunning = false;
let lastInsufficientNoticeAt = 0;
const liveFailureLocks = {};

async function getScanUniverse() {
  if (process.env.AUTO_SYMBOL_UNIVERSE !== "true" || process.env.MARKET_DATA_SOURCE !== "MEXC") {
    currentScanSymbols = [...SYMBOLS];
    currentMarketMeta = {};
    return currentScanSymbols;
  }
  try {
    const universe = await getTradingUniverse();
    currentScanSymbols = universe.symbols;
    currentMarketMeta = universe.meta;
    return currentScanSymbols;
  } catch (err) {
    console.error("MEXC dinamik coin listesi alınamadı, sabit liste kullanılacak:", err.message);
    currentScanSymbols = [...SYMBOLS];
    currentMarketMeta = {};
    return currentScanSymbols;
  }
}

function getSignalLevel(score) {
  if (score >= 85) return "🟢 İŞLEM AÇ";
  if (score >= 75) return "🟡 HAZIR OL";
  if (score >= 55) return "👀 RADAR";
  return "⏳ BEKLE";
}

function hasRecentEntryLock(symbol) {
  const lock = entryLocks[symbol];
  if (!lock) return false;
  const cooldownMs = Number(process.env.ENTRY_SIGNAL_LOCK_MINUTES || 5) * 60 * 1000;
  return Date.now() - lock.at < cooldownMs;
}

function setEntryLock(symbol, side) {
  entryLocks[symbol] = { side, at: Date.now() };
}

function shouldSendUrgent(trade, advice) {
  if (!["CRITICAL", "HIGH"].includes(advice.urgency)) return false;
  const now = Date.now();
  const lastAt = trade.lastUrgentAt ? new Date(trade.lastUrgentAt).getTime() : 0;
  const minGap = Number(process.env.URGENT_REPEAT_SECONDS || 90) * 1000;
  return trade.lastUrgentStatus !== advice.status || now - lastAt > minGap;
}

async function sendUserTrackedReports(symbol, signal, currentPrice) {
  const trackedTrades = getActiveTrackedTradesBySymbol(symbol);
  for (const trade of trackedTrades) {
    const pnlPercent = calculatePnlPercent(trade, currentPrice);
    const advice = getPositionAdvice(trade, signal, currentPrice, pnlPercent);
    saveTrackedTrade(trade);

    const urgent = shouldSendUrgent(trade, advice);
    const now = Date.now();
    const lastAt = lastFollowReportAt[trade.id] || 0;
    const intervalMs = Number(process.env.FOLLOW_REPORT_SECONDS || 60) * 1000;

    if (urgent) {
      trade.lastUrgentStatus = advice.status;
      trade.lastUrgentAt = new Date().toISOString();
      saveTrackedTrade(trade);
      await sendTelegramWithButtons(formatTradeReport(trade, signal, currentPrice, advice, pnlPercent), [
        [{ text: "🛑 İşlemden Çıktım / Takibi Bırak", callback_data: `STOPTRACK:${trade.symbol}:${trade.id}` }],
      ], trade.userId);
      if (["EXIT_NOW", "PROFIT_EXIT"].includes(advice.status) && process.env.AUTO_CLOSE_ON_EXIT_SIGNAL === "true") {
        closeTrackedTrade(trade, advice.status, currentPrice, pnlPercent);
      }
      continue;
    }

    if (now - lastAt >= intervalMs) {
      lastFollowReportAt[trade.id] = now;
      await sendTelegramWithButtons(formatTradeReport(trade, signal, currentPrice, advice, pnlPercent), [
        [{ text: "🛑 İşlemden Çıktım / Takibi Bırak", callback_data: `STOPTRACK:${trade.symbol}:${trade.id}` }],
      ], trade.userId);
    }
  }
}


function getWatchKey(symbol, signal) {
  const side = signal.side && signal.side !== "NONE" ? signal.side : "NONE";
  const bucket = Math.floor(Number(signal.score || 0) / 5) * 5;
  const trigger = side === "LONG" ? signal.resistance : signal.support;
  return `${symbol}_${side}_${bucket}_${Math.round(Number(trigger || 0))}`;
}

function shouldSendWatchAlert(symbol, signal) {
  if (!signal || !signal.side || signal.side === "NONE") return false;
  if (signal.entryApproved) return false;
  if (getActiveTrackedTradesBySymbol(symbol).length > 0 || hasRecentEntryLock(symbol)) return false;
  const minScore = Number(process.env.WATCH_ALERT_SCORE || 60);
  if (Number(signal.score || 0) < minScore) return false;

  const key = getWatchKey(symbol, signal);
  const now = Date.now();
  const lastAt = lastWatchAlerts[key] || 0;
  const cooldownMs = Number(process.env.WATCH_ALERT_COOLDOWN_SECONDS || 180) * 1000;
  if (now - lastAt < cooldownMs) return false;

  lastWatchAlerts[key] = now;
  return true;
}

function buildWatchMessage(symbol, signal) {
  const side = signal.side && signal.side !== "NONE" ? signal.side : "BEKLE";
  const t = signal.entryTrigger || {};
  const stage = signal.entryStage || (Number(signal.score || 0) >= 75 ? "PREPARE" : "EARLY");
  const title = stage === "PREPARE" ? "🟡 <b>AKSİYON: HAZIR OL</b>" : "👀 <b>AKSİYON: RADAR</b>";
  const instruction = stage === "PREPARE"
    ? "Henüz işlem açma. Tetik oluşursa ayrı bir <b>🟢 İŞLEM AÇ</b> mesajı gelecek."
    : "Sadece izle. Bu mesaj işlem açma komutu değildir.";

  const triggerPrice = t.triggerPrice || (side === "LONG" ? signal.resistance : signal.support);
  const distance = triggerPrice && signal.lastClose
    ? Math.abs(((Number(triggerPrice) - Number(signal.lastClose)) / Number(signal.lastClose)) * 100).toFixed(2)
    : "-";

  const zoneLow = t.entryZoneLow || signal.plan?.entryLow || "-";
  const zoneHigh = t.entryZoneHigh || signal.plan?.entryHigh || "-";
  const breakoutLine = side === "LONG"
    ? `LONG için ${signal.resistance} üstü 15m hacimli kapanış`
    : side === "SHORT"
      ? `SHORT için ${signal.support} altı 15m hacimli kapanış`
      : "Net yön oluşması bekleniyor";
  const pullbackLine = side === "LONG"
    ? "LONG için EMA21/destekten yukarı dönüş + hacim korunması"
    : side === "SHORT"
      ? "SHORT için EMA21/dirençten aşağı dönüş + hacim korunması"
      : "Pullback için net yön bekleniyor";

  return `
${title}

<b>${symbol}</b>
Yön: <b>${side}</b>
Skor: <b>${signal.score}/100</b> | Güven: <b>${signal.confidence || signal.score}%</b>
Fiyat: <b>${signal.lastClose}</b> | Hacim: <b>x${signal.volumeRatio}</b>

📍 <b>Olası Giriş Bölgesi</b>
${zoneLow} - ${zoneHigh}

⏳ <b>Komut</b>
${instruction}

🔔 <b>Beklenen Tetik</b>
• ${breakoutLine}
• ${pullbackLine}

📏 <b>Tetiğe Kalan Mesafe</b>
%${distance}

⛔ <b>Eksik / Engel</b>
${signal.filters?.slice(0, 4).map((r) => `• ${r}`).join("\n") || "• Net onay bekleniyor"}
`;
}

function buildSignalMessage(symbol, signal, tradePlan) {
  const t = signal.entryTrigger || {};
  const entryType = t.entryType || "BREAKOUT";
  const entryTypeLabel = entryType === "PULLBACK" ? "Pullback / erken dönüş" : "Breakout / kırılım";

  return `
🟢 <b>AKSİYON: İŞLEM AÇ</b>

<b>${symbol}</b>
Yön: <b>${signal.side}</b>
Giriş Tipi: <b>${entryTypeLabel}</b>
Skor: <b>${signal.score}/100</b> | Güven: <b>${signal.confidence}%</b>
Süre: <b>${tradePlan.timeWindow}</b>

📥 <b>Giriş Bölgesi</b>
<b>${tradePlan.entryLow} - ${tradePlan.entryHigh}</b>

🛑 <b>Stop</b>
<b>${tradePlan.stopLossPrice}</b>  (%${tradePlan.stopLossPercent})

🎯 <b>Kâr Alma</b>
TP1: <b>${tradePlan.tp1Price}</b> → %${tradePlan.tp1ClosePercent} kapat
TP2: <b>${tradePlan.tp2Price}</b> → %${tradePlan.tp2ClosePercent} kapat
TP3: <b>${tradePlan.tp3Price}</b> → kalan %${tradePlan.tp3ClosePercent}

💰 <b>Plan Özeti</b>
Hedef: <b>${tradePlan.targetProfitUsdt} USDT</b>
Tahmini risk: <b>${tradePlan.estimatedRiskUsdt} USDT</b>
Risk/Ödül: <b>1:${tradePlan.riskReward}</b>
Kaldıraç: <b>${tradePlan.leverage}x</b>
Tahmini marjin: <b>${tradePlan.estimatedMarginUsdt} USDT</b>

📌 <b>Net Komut</b>
✅ Bu mesaj gelirse işlem açılabilir.
✅ Stop ve TP olmadan işlem açma.
✅ TP1 gelirse kârın bir kısmını al ve stop'u girişe çek.

<b>Sebep</b>
${signal.reasons.slice(0, 6).map((r) => `✅ ${r}`).join("\n")}

⚠️ Bu otomatik emir değildir; karar kullanıcıdadır.
`;
}

async function sendMarketSummaryIfNeeded() {
  const intervalMs = Number(process.env.MARKET_SUMMARY_MINUTES || 10) * 60 * 1000;
  const radarMs = Number(process.env.OPPORTUNITY_RADAR_MINUTES || 15) * 60 * 1000;
  const now = Date.now();

  if (now - lastMarketSummaryAt >= intervalMs) {
    lastMarketSummaryAt = now;
    const rows = currentScanSymbols.slice(0, 12).map((symbol) => {
      const signal = latestSignals[symbol];
      if (!signal) return `${symbol}: veri bekleniyor`;
      const direction = signal.side && signal.side !== "NONE" ? signal.side : "BEKLE";
      const regime = signal.marketRegime?.label || "-";
      return `${symbol}: ${getSignalLevel(signal.score)} | ${direction} | Skor ${signal.score} | L:${signal.longScore} S:${signal.shortScore} | Hacim x${signal.volumeRatio} | ${regime}`;
    }).join("\n");

    await sendTelegram(`
📊 <b>Piyasa Durum Raporu</b>

${rows}

Açık pozisyon varsa bot takip eder. Aksiyon dili: BEKLE / HAZIR OL / İŞLEM AÇ / POZİSYONU KORU / ÇIK.
`);
  }

  if (process.env.OPPORTUNITY_RADAR_ENABLED !== "false" && now - lastOpportunityRadarAt >= radarMs) {
    lastOpportunityRadarAt = now;
    await sendTelegram(formatOpportunityTable(latestSignals));
  }
}

async function scanSymbol(symbol) {
  const [candles15m, candles1h, candles4h] = await Promise.all([
    getKlines(symbol, "5m", 220),
    getKlines(symbol, "1h", 220),
    getKlines(symbol, "4h", 220),
  ]);

  const signal = analyzeSwingPlan({ candles15m, candles1h, candles4h });
  const currentPrice = signal.lastClose;
  latestSignals[symbol] = signal;

  const paperUpdate = await updatePaperTrades(symbol, currentPrice);
  const closedTrades = Array.isArray(paperUpdate)
    ? paperUpdate
    : Array.isArray(paperUpdate?.closed)
      ? paperUpdate.closed
      : [];
  const paperEvents = Array.isArray(paperUpdate?.events) ? paperUpdate.events : [];

  for (const event of paperEvents) {
    if (event.type === "TP1") {
      await sendTelegram(`🎯 <b>TP1 GELDİ</b>\n${event.trade.symbol} ${event.trade.side}\nPnL: <b>%${event.pnlPercent}</b>\nKârın bir kısmı alındı, stop girişe çekildi.`);
    } else if (event.type === "TP2") {
      await sendTelegram(`🎯 <b>TP2 GELDİ</b>\n${event.trade.symbol} ${event.trade.side}\nPnL: <b>%${event.pnlPercent}</b>\nKalan pozisyon TP3 / stop ile takip ediliyor.`);
    } else if (event.type === "RISK_MOVED") {
      await sendTelegram(`📊 <b>POZİSYONU KORU</b>\n${event.trade.symbol} ${event.trade.side}\n${event.message}\nYeni Stop: <b>${event.trade.activeStopLossPrice}</b>`);
    }
  }

  for (const closed of closedTrades) {
    const action = closed.status === "CLOSED_TP" ? "✅ TP ile kapandı" : "🛑 Stop ile kapandı";
    await sendTelegram(`${action}\n<b>${closed.symbol} ${closed.side}</b>\nPnL: <b>%${closed.pnlPercent}</b>`);
  }

  await sendUserTrackedReports(symbol, signal, currentPrice);

  const signalThreshold = Number(process.env.SWING_MIN_SCORE || process.env.V8_MIN_SCORE || 52);
  if (
    signal.score < signalThreshold ||
    !signal.side ||
    signal.side === "NONE"
  ) {
    if (shouldSendWatchAlert(symbol, signal)) {
      await sendTelegram(buildWatchMessage(symbol, signal));
      console.log("👀 Hazırlık uyarısı gönderildi:", symbol, signal.side, signal.score);
    }
    if (signal.entryBlocked) {
      console.log(`⏳ ${symbol} izleniyor ama giriş yok: ${signal.filters?.join(" | ")}`);
    }
    return null;
  }

  const signalKey = `${symbol}_${signal.side}_${Math.round(signal.lastClose)}_${Math.floor(signal.score / 5)}`;
  const isNewSignal = lastSignals[symbol] !== signalKey;
  if (isNewSignal) lastSignals[symbol] = signalKey;

  const tradePlan = buildTradePlan(symbol, signal);
  const candidate = { symbol, signal, tradePlan, currentPrice };
  if (signal.entryApproved !== true || signal.entryBlocked === true) {
    return candidate;
  }
  const approval = createApproval(symbol, signal, tradePlan);

  if (isNewSignal && process.env.AUTO_PAPER_TRADING !== "false") {
    const paperTrade = await createPaperTrade(symbol, signal, tradePlan, { source: "AUTO_SIGNAL" });
    if (paperTrade) {
      console.log("🧪 Auto paper trade açıldı:", paperTrade.id, symbol, signal.side);
      if (process.env.PAPER_OPEN_NOTIFY === "true") {
        await sendTelegram(`🧪 <b>Paper Trade Açıldı</b>
${paperTrade.id} — ${symbol} ${signal.side}
Entry: <b>${paperTrade.entry}</b>
Stop: <b>${paperTrade.stopLossPrice}</b>
TP1/TP2/TP3: <b>${paperTrade.tp1Price}</b> / <b>${paperTrade.tp2Price}</b> / <b>${paperTrade.tp3Price}</b>`);
      }
    }
  }

  if (
    isNewSignal &&
    process.env.EXECUTION_EXCHANGE !== "MEXC" &&
    process.env.FUTURES_TESTNET_ENABLED === "true" &&
    process.env.AUTO_TESTNET_TRADING === "true" &&
    signal.entryApproved === true &&
    signal.entryBlocked !== true &&
    Number(signal.score || 0) >= Number(process.env.AUTO_TESTNET_MIN_SCORE || 88)
  ) {
    try {
      const testOrder = await openTestnetTrade({
        symbol,
        side: signal.side,
        currentPrice,
        stopLossPrice: tradePlan.stopLossPrice,
        takeProfitPrice: tradePlan.tp3Price || tradePlan.tp2Price || tradePlan.tp1Price,
      });
      registerTradeOpen("TESTNET");
      await sendTelegram(`🧪 <b>FUTURES TESTNET EMRİ AÇILDI</b>\n${symbol} ${signal.side}\nMiktar: <b>${testOrder.quantity}</b>\nKaldıraç: <b>${testOrder.leverage}x</b>\nBu gerçek para işlemi değildir.`);
    } catch (err) {
      console.error(`${symbol} testnet emir hatası:`, err.message);
      await sendTelegram(`⚠️ <b>Testnet emir açılamadı</b>\n${symbol}\n${err.message}`);
    }
  }

  if (isNewSignal && process.env.OPENAI_SIGNAL_REVIEW === "true") {
    askOpenAIWithGuard({ symbol, signal, tradePlan }).catch((err) => {
      console.error("OpenAI arka plan hatası:", err.message);
    });
  }

  if (isNewSignal) {
    setEntryLock(symbol, signal.side);
    await sendTelegramWithButtons(buildSignalMessage(symbol, signal, tradePlan), [
      [{ text: "✅ İşleme Girdim / Takibe Al", callback_data: `TRACK:${symbol}:${approval.id}` }],
      [{ text: "❌ Girmedim", callback_data: `IGNORE:${symbol}:${approval.id}` }],
    ]);
    console.log("✅ Sinyal adayı gönderildi:", symbol, signal.side, signal.score);
  }
  return candidate;
}

async function executeBestMexcCandidate(candidates) {
  if (liveExecutionRunning || process.env.EXECUTION_EXCHANGE !== "MEXC" || process.env.MEXC_FUTURES_ENABLED !== "true" || process.env.MEXC_LIVE_TRADING_ENABLED !== "true") return;
  liveExecutionRunning = true;
  let attemptedSymbol = null;
  try {
    const [positions, account] = await Promise.all([getMexcOpenPositions(), getUsdtAccountState()]);
    const threshold = Number(process.env.MEXC_TIER_THRESHOLD_USDT || 50);
    const configuredMax = Math.max(1, Number(process.env.MAX_OPEN_POSITIONS || 2));
    const maxOpen = account.equity >= threshold ? Math.min(2, configuredMax) : 1;
    if (positions.length >= maxOpen) {
      console.log(`🛡️ Açık pozisyon limiti dolu: ${positions.length}/${maxOpen}`);
      return;
    }
    const allocation = calculateTieredMargin(account);
    const leverage = Math.min(10, Math.max(1, Number(process.env.MEXC_LEVERAGE || 3)));
    const affordableNotional = allocation.marginUsdt * leverage;
    const failureCooldownMs = Math.max(5, Number(process.env.LIVE_FAILURE_COOLDOWN_MINUTES || 30)) * 60 * 1000;
    const rotationBlocked = getRotationBlockedSymbols();
    const gatePassed = candidates.filter((candidate) => !rotationBlocked.has(candidate.symbol))
      .filter((candidate) => !liveFailureLocks[candidate.symbol] || Date.now() - liveFailureLocks[candidate.symbol] > failureCooldownMs)
      .map((candidate) => ({
        ...candidate,
        gate: evaluateLiveCandidate(candidate.symbol, candidate.signal, candidate.tradePlan, currentMarketMeta[candidate.symbol]),
      })).filter((candidate) => candidate.gate.allowed);

    const evaluated = gatePassed.filter((candidate) => {
      const meta = currentMarketMeta[candidate.symbol];
      if (!meta?.contractSize || !meta?.minVol) return true;
      const minNotional = Number(meta.contractSize) * Number(meta.minVol) * Number(candidate.currentPrice);
      candidate.minNotional = Number(minNotional.toFixed(4));
      return minNotional <= affordableNotional;
    }).sort((a, b) => b.gate.selectionScore - a.gate.selectionScore);

    if (!evaluated.length) {
      if (gatePassed.length) {
        console.log(`💰 Sinyal var ancak minimum kontrat ${affordableNotional} USDT pozisyona uymuyor.`);
        const noticeMs = Math.max(5, Number(process.env.INSUFFICIENT_NOTICE_MINUTES || 30)) * 60 * 1000;
        if (Date.now() - lastInsufficientNoticeAt > noticeMs) {
          lastInsufficientNoticeAt = Date.now();
          await sendTelegram(`💰 <b>MEXC BAKİYE/KONTRAT UYUMSUZ</b>\nUygun sinyal bulundu ancak minimum kontrat, mevcut <b>${affordableNotional} USDT</b> pozisyon sınırından büyük. Bot daha küçük kontratlı coin aramaya devam ediyor.`);
        }
      } else {
        console.log("🛡️ Sıkı canlı filtrelerden geçen aday yok.");
      }
      return;
    }
    const best = evaluated[0];
    attemptedSymbol = best.symbol;
    const riskCheck = canOpenTrade();
    if (!riskCheck.allowed) throw new Error(riskCheck.reason);
    const latestPrice = Number((await getPrice(best.symbol)).price);
    const signalPrice = Number(best.currentPrice);
    const slippagePercent = signalPrice ? Math.abs((latestPrice - signalPrice) / signalPrice) * 100 : 999;
    const maxSlippage = Math.max(0.05, Number(process.env.LIVE_MAX_SIGNAL_SLIPPAGE_PERCENT || 0.25));
    if (slippagePercent > maxSlippage) {
      throw new Error(`${best.symbol} fiyatı sinyalden %${slippagePercent.toFixed(2)} uzaklaştı; geç giriş yapılmadı`);
    }
    const liveOrder = await openMexcLiveTrade({
      symbol: best.symbol,
      side: best.signal.side,
      currentPrice: latestPrice,
      stopLossPrice: best.tradePlan.stopLossPrice,
      takeProfitPrice: best.tradePlan.tp3Price,
    });
    registerTradeOpen();
    registerManagedPosition({
      symbol: best.symbol,
      side: best.signal.side,
      tradePlan: {
        ...best.tradePlan,
        entry: liveOrder.entryPrice || latestPrice,
        stopLossPrice: liveOrder.stopLossPrice,
      },
      vol: liveOrder.vol,
      marginUsdt: liveOrder.marginUsdt,
      equityUsdt: liveOrder.equityUsdt,
      leverage: liveOrder.leverage,
    });
    await sendTelegram(`🔴 <b>MEXC GERÇEK EMİR AÇILDI</b>\n${liveOrder.symbol} ${best.signal.side}\nSeçim puanı: <b>${best.gate.selectionScore}</b>\nGerçek giriş: <b>${liveOrder.entryPrice}</b>\nBorsa stopu: <b>${liveOrder.stopLossPrice}</b> ✅\nHesap değeri: <b>${liveOrder.equityUsdt} USDT</b>\nMarj: <b>${liveOrder.marginUsdt} USDT</b>\nKorunan rezerv: <b>${liveOrder.reserveUsdt} USDT</b>\nKontrat: <b>${liveOrder.vol}</b>\nKaldıraç: <b>${liveOrder.leverage}x</b>`);
  } catch (err) {
    if (attemptedSymbol) liveFailureLocks[attemptedSymbol] = Date.now();
    console.error("MEXC en iyi aday emir hatası:", err.message);
    await sendTelegram(`⚠️ <b>MEXC canlı emir açılamadı</b>\n${err.message}`);
  } finally {
    liveExecutionRunning = false;
  }
}

async function runScanCycle() {
  if (scanRunning) return;
  scanRunning = true;
  try {
    if (!isBotActive()) {
      console.log("⏸️ Bot durduruldu. Tarama yapılmadı.");
      return;
    }
    console.log("Piyasa taranıyor...");
    const symbols = await getScanUniverse();
    const candidates = [];
    for (const symbol of symbols) {
      try {
        const candidate = await scanSymbol(symbol);
        if (candidate) candidates.push(candidate);
      } catch (err) { console.error(`${symbol} tarama hatası:`, err.message); }
    }
    await executeBestMexcCandidate(candidates);
    await sendMarketSummaryIfNeeded();
  } finally {
    scanRunning = false;
  }
}

function startScanner() {
  console.log("📡 Scanner başlatıldı.");
  runScanCycle().catch((err) => console.error("İlk tarama hatası:", err.message));
  const seconds = Math.max(60, Number(process.env.SCAN_EVERY_SECONDS || 90));
  setInterval(() => runScanCycle().catch((err) => console.error("Tarama döngüsü hatası:", err.message)), seconds * 1000);
}

function getLatestSignals() { return latestSignals; }
function getOpportunityRadar() { return buildOpportunityList(latestSignals); }
function getOpportunityRadarText() { return formatOpportunityTable(latestSignals); }

module.exports = { startScanner, runScanCycle, getLatestSignals, getOpportunityRadar, getOpportunityRadarText, executeBestMexcCandidate };
