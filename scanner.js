const { getKlines } = require("./binance");
const { analyzeMarket, analyzeMultiTimeframe, analyzeSwingPlan } = require("./strategy");
const { askOpenAIWithGuard } = require("./openaiGuard");
const { sendTelegram, sendTelegramWithButtons } = require("./telegram");
const { buildTradePlan } = require("./risk");
const { updatePaperTrades, createPaperTrade } = require("./paperTrade");
const { canOpenTrade } = require("./riskGuard");
const { createApproval } = require("./approvalStore");
const { isBotActive } = require("./botState");
const { getActiveTrackedTradesBySymbol, closeTrackedTrade, saveTrackedTrade } = require("./trackStore");
const { calculatePnlPercent, getPositionAdvice, formatTradeReport } = require("./positionAdvisor");
const { buildOpportunityList, formatOpportunityTable } = require("./opportunityEngine");

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

function getSignalLevel(score) {
  if (score >= 85) return "🟢 İŞLEM AÇ ADAYI";
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
      await sendTelegram(formatTradeReport(trade, signal, currentPrice, advice, pnlPercent), trade.userId);
      if (["EXIT_NOW", "PROFIT_EXIT"].includes(advice.status) && process.env.AUTO_CLOSE_ON_EXIT_SIGNAL === "true") {
        closeTrackedTrade(trade, advice.status, currentPrice, pnlPercent);
      }
      continue;
    }

    if (now - lastAt >= intervalMs) {
      lastFollowReportAt[trade.id] = now;
      await sendTelegram(formatTradeReport(trade, signal, currentPrice, advice, pnlPercent), trade.userId);
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
    const rows = SYMBOLS.map((symbol) => {
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
    signal.side === "NONE" ||
    signal.entryApproved === false
  ) {
    if (shouldSendWatchAlert(symbol, signal)) {
      await sendTelegram(buildWatchMessage(symbol, signal));
      console.log("👀 Hazırlık uyarısı gönderildi:", symbol, signal.side, signal.score);
    }
    if (signal.entryBlocked) {
      console.log(`⏳ ${symbol} izleniyor ama giriş yok: ${signal.filters?.join(" | ")}`);
    }
    return;
  }

  const signalKey = `${symbol}_${signal.side}_${Math.round(signal.lastClose)}_${Math.floor(signal.score / 5)}`;
  if (lastSignals[symbol] === signalKey) return;
  lastSignals[symbol] = signalKey;

  const riskCheck = canOpenTrade();
  if (!riskCheck.allowed) {
    console.log(`⛔ İşlem açılmadı: ${riskCheck.reason}`);
    return;
  }

  const tradePlan = buildTradePlan(symbol, signal);
  const approval = createApproval(symbol, signal, tradePlan);

  if (process.env.AUTO_PAPER_TRADING !== "false") {
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

  if (process.env.OPENAI_SIGNAL_REVIEW === "true") {
    askOpenAIWithGuard({ symbol, signal, tradePlan }).catch((err) => {
      console.error("OpenAI arka plan hatası:", err.message);
    });
  }

  setEntryLock(symbol, signal.side);

  await sendTelegramWithButtons(buildSignalMessage(symbol, signal, tradePlan), [
    [{ text: "📊 Açtım / Pozisyonu Takibe Al", callback_data: `TRACK:${symbol}:${approval.id}` }],
    [{ text: "❌ Açmadım", callback_data: `IGNORE:${symbol}:${approval.id}` }],
  ]);

  console.log("✅ Sinyal adayı gönderildi:", symbol, signal.side, signal.score);
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
    for (const symbol of SYMBOLS) {
      try { await scanSymbol(symbol); } catch (err) { console.error(`${symbol} tarama hatası:`, err.message); }
    }
    await sendMarketSummaryIfNeeded();
  } finally {
    scanRunning = false;
  }
}

function startScanner() {
  console.log("📡 Scanner başlatıldı.");
  runScanCycle().catch((err) => console.error("İlk tarama hatası:", err.message));
  const seconds = Math.max(15, Number(process.env.SCAN_EVERY_SECONDS || 30));
  setInterval(() => runScanCycle().catch((err) => console.error("Tarama döngüsü hatası:", err.message)), seconds * 1000);
}

function getLatestSignals() { return latestSignals; }
function getOpportunityRadar() { return buildOpportunityList(latestSignals); }
function getOpportunityRadarText() { return formatOpportunityTable(latestSignals); }

module.exports = { startScanner, runScanCycle, getLatestSignals, getOpportunityRadar, getOpportunityRadarText };
