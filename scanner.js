const { getKlines } = require("./binance");
const { analyzeMarket, analyzeMultiTimeframe } = require("./strategy");
const { askOpenAIWithGuard } = require("./openaiGuard");
const { sendTelegram, sendTelegramWithButtons } = require("./telegram");
const { buildTradePlan } = require("./risk");
const { updatePaperTrades } = require("./paperTrade");
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

function getSignalLevel(score) {
  if (score >= 92) return "🔥 ÇOK GÜÇLÜ";
  if (score >= 85) return "🚀 İŞLEM ADAYI";
  if (score >= 70) return "⚠️ HAZIRLIK";
  if (score >= 55) return "👀 İZLEME";
  return "⏳ BEKLE";
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
  const trigger = side === "LONG" ? signal.resistance : signal.support;
  const triggerText = side === "LONG"
    ? `LONG için <b>${trigger}</b> üstü hacimli 5m kapanış bekleniyor.`
    : side === "SHORT"
      ? `SHORT için <b>${trigger}</b> altı hacimli 5m kapanış bekleniyor.`
      : `Net yön yok; kırılım bekleniyor.`;

  return `
👀 <b>${symbol} HAZIRLIK / İZLEME</b>

Yön Adayı: <b>${side}</b>
Skor: <b>${signal.score}/100</b>
Güven: <b>${signal.confidence || signal.score}%</b>
Piyasa: <b>${signal.marketRegime?.label || "-"}</b>
Fiyat: <b>${signal.lastClose}</b>
Hacim: <b>x${signal.volumeRatio}</b>

Karar: <b>ŞİMDİ GİRME — ONAY BEKLE</b>
${triggerText}

📌 <b>Neyi bekliyoruz?</b>
${signal.guide?.next?.map((r) => `• ${r}`).join("\n") || "• Hacimli kırılım / net yön teyidi"}

${signal.filters?.length ? `⛔ <b>Engeller:</b>\n${signal.filters.slice(0, 4).map((r) => `• ${r}`).join("\n")}` : ""}

Sebep:
${signal.reasons.slice(0, 5).map((r) => `✅ ${r}`).join("\n")}

Bot onay gelirse ayrıca <b>giriş onayı</b> gönderecek.`;
}

function buildSignalMessage(symbol, signal, tradePlan) {
  return `
🚀 <b>FALIX SİNYAL ADAYI</b>

Parite: <b>${symbol}</b>
Yön: <b>${signal.side}</b>
Skor: <b>${signal.score}/100</b>
Seviye: <b>${getSignalLevel(signal.score)}</b>
Güven: <b>${signal.confidence || signal.score}%</b>
Piyasa: <b>${signal.marketRegime?.label || "-"}</b>
Fiyat: <b>${signal.lastClose}</b>

📌 <b>Not:</b> Bot SL/TP dayatmaz. İşlemi açarsan canlı takip eder; yön bozulunca “çık / kârı koru / ters yöne hazırlan” diye uyarır.

Long Güç: <b>${signal.longScore}</b>
Short Güç: <b>${signal.shortScore}</b>
RSI: ${signal.rsi}
EMA9/21: ${signal.ema9} / ${signal.ema21}
MACD: ${signal.macdSide}
ADX: ${signal.adx}
Hacim: x${signal.volumeRatio}
Karar: <b>${signal.guide?.decision || (signal.entryApproved ? "GİRİŞ ONAYI" : "BEKLE")}</b>
Giriş Onayı: <b>${signal.entryApproved ? "VAR" : "YOK / BEKLE"}</b>

🎯 <b>Beklenen şartlar:</b>
${signal.guide?.next?.map((r) => `• ${r}`).join("\n") || "Bekle"}
${signal.filters?.length ? `
Filtre:
${signal.filters.slice(0, 4).map((r) => `⛔ ${r}`).join("\n")}` : ""}

Sebep:
${signal.reasons.slice(0, 6).map((r) => `✅ ${r}`).join("\n")}

İşlem açtıysan butona bas, canlı takip başlayacak.
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

Açık pozisyon varsa bot her ${process.env.FOLLOW_REPORT_SECONDS || 60} saniyede takip eder; riskte anında uyarır.
`);
  }

  if (process.env.OPPORTUNITY_RADAR_ENABLED !== "false" && now - lastOpportunityRadarAt >= radarMs) {
    lastOpportunityRadarAt = now;
    await sendTelegram(formatOpportunityTable(latestSignals));
  }
}

async function scanSymbol(symbol) {
  const [candles5m, candles15m, candles1h] = await Promise.all([
    getKlines(symbol, process.env.SCAN_INTERVAL || "5m", 220),
    getKlines(symbol, "15m", 220),
    getKlines(symbol, "1h", 220),
  ]);

  const signal = analyzeMultiTimeframe({ candles5m, candles15m, candles1h });
  const currentPrice = signal.lastClose;
  latestSignals[symbol] = signal;

  const closedTrades = await updatePaperTrades(symbol, currentPrice);
  for (const closed of closedTrades) {
    await sendTelegram(`✅ <b>Paper Trade Kapandı</b>\n${closed.symbol} ${closed.side}\nPnL: <b>%${closed.pnlPercent}</b>`);
  }

  await sendUserTrackedReports(symbol, signal, currentPrice);

  const signalThreshold = Number(process.env.SIGNAL_THRESHOLD || 85);
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

  askOpenAIWithGuard({ symbol, signal, tradePlan }).catch((err) => {
    console.error("OpenAI arka plan hatası:", err.message);
  });

  await sendTelegramWithButtons(buildSignalMessage(symbol, signal, tradePlan), [
    [{ text: "✅ Açtım / Canlı Takibe Al", callback_data: `TRACK:${symbol}:${approval.id}` }],
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
