const cron = require("node-cron");
const { getKlines } = require("./binance");
const { analyzeMarket } = require("./strategy");
const { askOpenAIWithGuard } = require("./openaiGuard");
const { sendTelegram, sendTelegramWithButtons } = require("./telegram");
const { buildTradePlan } = require("./risk");
const { updatePaperTrades } = require("./paperTrade");
const { canOpenTrade } = require("./riskGuard");
const { createApproval } = require("./approvalStore");
const { isBotActive } = require("./botState");
const {
  getActiveTrackedTradesBySymbol,
  closeTrackedTrade,
  saveTrackedTrade,
} = require("./trackStore");
const {
  calculatePnlPercent,
  improveTrackedRisk,
  getPositionAdvice,
  formatTradeReport,
} = require("./positionAdvisor");

const SYMBOLS = (process.env.SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

let lastSignals = {};
let lastFollowReportAt = {};
let lastMarketSummaryAt = 0;
let latestSignals = {};

function getSignalLevel(score) {
  if (score >= 95) return "🔥 ULTRA";
  if (score >= 85) return "🚀 İŞLEM";
  if (score >= 70) return "⚠️ HAZIRLIK";
  if (score >= 55) return "👀 İZLEME";
  return "⏳ BEKLE";
}

async function sendUserTrackedReports(symbol, signal, currentPrice) {
  const trackedTrades = getActiveTrackedTradesBySymbol(symbol);

  for (const trade of trackedTrades) {
    const pnlPercent = calculatePnlPercent(trade, currentPrice);
    const riskMove = improveTrackedRisk(trade, currentPrice, pnlPercent);
    saveTrackedTrade(trade);

    if (riskMove.changed) {
      await sendTelegram(
        `
🛡️ <b>Risk Azaltıldı</b>

Parite: <b>${trade.symbol}</b>
Yön: <b>${trade.side}</b>
PnL: <b>%${pnlPercent}</b>

Eski SL: <b>${riskMove.oldSl}</b>
Yeni SL: <b>${riskMove.newSl}</b>

${riskMove.message}
`,
        trade.userId
      );
    }

    const advice = getPositionAdvice(trade, signal, currentPrice, pnlPercent);

    if (advice.hitSl || advice.status === "EXIT_NOW") {
      closeTrackedTrade(trade, "CLOSED_SL", currentPrice, pnlPercent);
      await sendTelegram(formatTradeReport(trade, signal, currentPrice, advice, pnlPercent), trade.userId);
      continue;
    }

    if (advice.hitTp3 && advice.oppositeScore >= 70) {
      closeTrackedTrade(trade, "CLOSED_TP3", currentPrice, pnlPercent);
      await sendTelegram(formatTradeReport(trade, signal, currentPrice, advice, pnlPercent), trade.userId);
      continue;
    }

    const now = Date.now();
    const lastAt = lastFollowReportAt[trade.id] || 0;
    const intervalMs = Number(process.env.FOLLOW_REPORT_MINUTES || 5) * 60 * 1000;

    const urgent = ["EXIT_AND_REVERSE_WATCH", "RISK_UP", "DANGER"].includes(advice.status);
    if (!urgent && now - lastAt < intervalMs) continue;

    lastFollowReportAt[trade.id] = now;
    await sendTelegram(formatTradeReport(trade, signal, currentPrice, advice, pnlPercent), trade.userId);
  }
}

function buildSignalMessage(symbol, signal, tradePlan) {
  return `
🚀 <b>FALIX İŞLEM PLANI</b>

Parite: <b>${symbol}</b>
Yön: <b>${signal.side}</b>
Aksiyon: <b>${signal.action}</b>
Skor: <b>${signal.score}/100</b>
Seviye: <b>${getSignalLevel(signal.score)}</b>

⚡ Kaldıraç: <b>${tradePlan.leverage}x</b>
💰 Giriş: <b>${tradePlan.entryLow} - ${tradePlan.entryHigh}</b>

🎯 TP1: <b>${tradePlan.tp1Price}</b> (%${tradePlan.tp1Percent})
🎯 TP2: <b>${tradePlan.tp2Price}</b> (%${tradePlan.tp2Percent})
🎯 TP3: <b>${tradePlan.tp3Price}</b> (%${tradePlan.tp3Percent})
🛑 SL: <b>${tradePlan.stopLossPrice}</b> (%${tradePlan.stopLossPercent})

📌 Yönetim:
TP1 gelirse SL girişe çek.
TP2 gelirse kârı koru.
Ters sinyal güçlenirse bot “çık / ters yöne hazırlan” diyecek.

RSI: ${signal.rsi}
EMA9: ${signal.ema9}
EMA21: ${signal.ema21}
Trend EMA: ${signal.trendEma}
ADX: ${signal.adx}

Sebep:
${signal.reasons.map((r) => `✅ ${r}`).join("\n")}

İşlem açtıysan butona bas, canlı takip başlayacak.
`;
}

async function sendMarketSummaryIfNeeded() {
  const intervalMs = Number(process.env.MARKET_SUMMARY_MINUTES || 10) * 60 * 1000;
  const now = Date.now();
  if (now - lastMarketSummaryAt < intervalMs) return;
  lastMarketSummaryAt = now;

  const rows = SYMBOLS.map((symbol) => {
    const signal = latestSignals[symbol];
    if (!signal) return `${symbol}: veri bekleniyor`;
    const direction = signal.side && signal.side !== "NONE" ? signal.side : signal.action;
    return `${symbol}: ${getSignalLevel(signal.score)} | ${direction} | Skor ${signal.score} | L:${signal.longScore} S:${signal.shortScore}`;
  }).join("\n");

  await sendTelegram(`
📊 <b>Piyasa Durum Raporu</b>

${rows}

Not: 85+ skor gelirse işlem planı atılır. Açtığın işlem varsa bot özelden canlı takip eder.
`);
}

async function scanSymbol(symbol) {
  try {
    const candles = await getKlines(symbol, "5m", 100);
    const signal = analyzeMarket(candles);
    const currentPrice = signal.lastClose;
    latestSignals[symbol] = signal;

    const closedTrades = await updatePaperTrades(symbol, currentPrice);
    for (const closed of closedTrades) {
      await sendTelegram(`
✅ <b>Paper Trade Kapandı</b>

Parite: <b>${closed.symbol}</b>
Yön: <b>${closed.side}</b>
Durum: <b>${closed.status}</b>
Giriş: <b>${closed.entry}</b>
Çıkış: <b>${closed.exit}</b>
PnL: <b>%${closed.pnlPercent}</b>
`);
    }

    await sendUserTrackedReports(symbol, signal, currentPrice);

    const signalThreshold = Number(process.env.SIGNAL_THRESHOLD || 85);
    if (signal.score < signalThreshold || !signal.side || signal.side === "NONE") return;

    const signalKey = `${symbol}_${signal.action}_${Math.round(signal.lastClose)}_${Math.floor(signal.score / 5)}`;
    if (lastSignals[symbol] === signalKey) return;
    lastSignals[symbol] = signalKey;

    const riskCheck = canOpenTrade();
    if (!riskCheck.allowed) {
      console.log(`⛔ İşlem açılmadı: ${riskCheck.reason}`);
      return;
    }

    const tradePlan = buildTradePlan(symbol, signal);
    const approval = createApproval(symbol, signal, tradePlan);

    await askOpenAIWithGuard({
      symbol,
      signalScore: signal.score,
      action: signal.action,
      side: signal.side,
      price: signal.lastClose,
      rsi: signal.rsi,
      ema9: signal.ema9,
      ema21: signal.ema21,
      trendEma: signal.trendEma,
      volume: signal.volume,
      avgVolume: signal.avgVolume,
      reasons: signal.reasons,
      tradePlan,
    });

    await sendTelegramWithButtons(buildSignalMessage(symbol, signal, tradePlan), [
      [{ text: "✅ Açtım / Canlı Takibe Al", callback_data: `TRACK:${symbol}:${approval.id}` }],
      [{ text: "❌ Açmadım", callback_data: `IGNORE:${symbol}:${approval.id}` }],
    ]);

    console.log("✅ Butonlu işlem planı gönderildi:", symbol, signal.action, signal.score);
  } catch (err) {
    console.error(`${symbol} tarama hatası:`, err.message);
  }
}

async function runScanCycle() {
  if (!isBotActive()) {
    console.log("⏸️ Bot durduruldu. Tarama yapılmadı.");
    return;
  }

  console.log("Piyasa taranıyor...");

  for (const symbol of SYMBOLS) {
    await scanSymbol(symbol);
  }

  await sendMarketSummaryIfNeeded();
}

function startScanner() {
  console.log("📡 Scanner başlatıldı.");
  runScanCycle().catch((err) => console.error("İlk tarama hatası:", err.message));
  cron.schedule("*/1 * * * *", async () => {
    await runScanCycle();
  });
}

module.exports = { startScanner };
