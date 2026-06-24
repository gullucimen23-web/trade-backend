const cron = require("node-cron");
const { getKlines } = require("./binance");
const { analyzeMarket } = require("./strategy");
const { askOpenAIWithGuard } = require("./openaiGuard");
const { sendTelegram } = require("./telegram");
const { buildTradePlan } = require("./risk");
const { createPaperTrade, updatePaperTrades, getOpenTrades } = require("./paperTrade");
const { canOpenTrade, registerTradeOpen } = require("./riskGuard");
const { createApproval } = require("./approvalStore");
const { isBotActive } = require("./botState");

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
let lastSignals = {};
let lastFollowReportAt = {};

function calculatePnlPercent(trade, currentPrice) {
  const isLong = trade.side === "LONG";
  const rawPnl = isLong
    ? ((currentPrice - trade.entry) / trade.entry) * 100
    : ((trade.entry - currentPrice) / trade.entry) * 100;
  return Number((rawPnl * Number(trade.leverage || 1)).toFixed(2));
}

function distanceToPricePercent(currentPrice, targetPrice) {
  return Number(((Math.abs(targetPrice - currentPrice) / currentPrice) * 100).toFixed(2));
}

function getFollowDecision(trade, signal, pnlPercent) {
  const sameSideScore = trade.side === "LONG" ? Number(signal.longScore || 0) : Number(signal.shortScore || 0);
  const oppositeScore = trade.side === "LONG" ? Number(signal.shortScore || 0) : Number(signal.longScore || 0);

  if (oppositeScore >= 80 && oppositeScore >= sameSideScore + 15) {
    return { icon: "🔴", title: "ÇIKMAYI DEĞERLENDİR", reason: "Ters sinyal güçlendi. Pozisyon yönü zayıflıyor.", sameSideScore, oppositeScore };
  }
  if (pnlPercent > 0.8 && oppositeScore >= 70 && oppositeScore > sameSideScore) {
    return { icon: "🟡", title: "KÂRI KORU", reason: "İşlem kârda ama ters taraf güçlenmeye başladı.", sameSideScore, oppositeScore };
  }
  if (sameSideScore >= 70 && sameSideScore >= oppositeScore) {
    return { icon: "🟢", title: "DEVAM ET", reason: "Pozisyon yönü hâlâ daha güçlü görünüyor.", sameSideScore, oppositeScore };
  }
  return { icon: "🟡", title: "DİKKATLİ OL", reason: "Net yön zayıf. Pozisyonu yakından takip et.", sameSideScore, oppositeScore };
}

async function sendOpenTradeFollowReport(symbol, signal, currentPrice) {
  const openTrades = getOpenTrades().filter((t) => t.symbol === symbol);
  for (const trade of openTrades) {
    const now = Date.now();
    const lastAt = lastFollowReportAt[trade.id] || 0;
    const intervalMs = Number(process.env.FOLLOW_REPORT_MINUTES || 10) * 60 * 1000;
    if (now - lastAt < intervalMs) continue;
    lastFollowReportAt[trade.id] = now;

    const pnlPercent = calculatePnlPercent(trade, currentPrice);
    const decision = getFollowDecision(trade, signal, pnlPercent);
    const tpDistance = distanceToPricePercent(currentPrice, trade.takeProfitPrice);
    const slDistance = distanceToPricePercent(currentPrice, trade.stopLossPrice);

    await sendTelegram(`
📊 <b>Açık İşlem Takibi</b>

Parite: <b>${trade.symbol}</b>
Yön: <b>${trade.side}</b>

Giriş: <b>${trade.entry}</b>
Şu An: <b>${currentPrice}</b>
TP: <b>${trade.takeProfitPrice}</b> — Uzaklık: <b>%${tpDistance}</b>
SL: <b>${trade.stopLossPrice}</b> — Uzaklık: <b>%${slDistance}</b>

Anlık PnL: <b>%${pnlPercent}</b>

Pozisyon Gücü: <b>${decision.sameSideScore}/100</b>
Ters Güç: <b>${decision.oppositeScore}/100</b>

${decision.icon} <b>${decision.title}</b>
${decision.reason}
`);
  }
}

async function scanSymbol(symbol) {
  try {
    const candles = await getKlines(symbol, "5m", 100);
    const signal = analyzeMarket(candles);
    const currentPrice = signal.lastClose;

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

    await sendOpenTradeFollowReport(symbol, signal, currentPrice);

    if (signal.score < 80) return;

    const signalKey = `${symbol}_${signal.action}_${Math.round(signal.lastClose)}`;
    if (lastSignals[symbol] === signalKey) return;
    lastSignals[symbol] = signalKey;

    const riskCheck = canOpenTrade();
    if (!riskCheck.allowed) {
      console.log(`⛔ İşlem açılmadı: ${riskCheck.reason}`);
      return;
    }

    const tradePlan = buildTradePlan(symbol, signal);
    const approval = createApproval(symbol, signal, tradePlan);

    const ai = await askOpenAIWithGuard({
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

    const openAiText = ai.raw || ai.reason || "OpenAI cevap vermedi.";
    const autoMode = process.env.AUTO_MODE === "true";
    const autoMinScore = Number(process.env.AUTO_MIN_SCORE || 95);
    let autoText = "Manuel takip / grup sinyali.";
    let paperTrade = null;

    if (autoMode && signal.score >= autoMinScore) {
      paperTrade = await createPaperTrade(symbol, signal, tradePlan);
      if (paperTrade) {
        registerTradeOpen();
        autoText = "AUTO_MODE ile otomatik paper trade açıldı.";
      } else {
        autoText = "AUTO_MODE aktif ama açık işlem zaten var.";
      }
    }

    const message = `
🚀 <b>Profesyonel Trade Fırsatı</b>

Parite: <b>${symbol}</b>
Yön: <b>${signal.side}</b>
Aksiyon: <b>${signal.action}</b>
Skor: <b>${signal.score}/100</b>

Giriş: <b>${tradePlan.entry}</b>
TP: <b>${tradePlan.takeProfitPrice}</b> (%${tradePlan.takeProfitPercent})
SL: <b>${tradePlan.stopLossPrice}</b> (%${tradePlan.stopLossPercent})
Pozisyon: <b>%${tradePlan.positionSizePercent}</b>
Kaldıraç: <b>${tradePlan.leverage}x</b>

📊 Analiz Durumu:
<b>Takip Ediliyor</b>

🤖 Falix Kararı:
<b>${signal.score >= 90 ? "GÜÇLÜ SİNYAL" : "İZLEME LİSTESİ"}</b>

Auto Mode:
<b>${autoText}</b>

RSI: ${signal.rsi}
EMA9: ${signal.ema9}
EMA21: ${signal.ema21}
Trend EMA: ${signal.trendEma}
ADX: ${signal.adx}
Hacim: ${signal.volume}
Ortalama Hacim: ${signal.avgVolume}

Sebep:
${signal.reasons.map((r) => `✅ ${r}`).join("\n")}

OpenAI:
${openAiText}

⚠️ Gerçek emir açma: <b>${tradePlan.tradingEnabled ? "AKTİF" : "KAPALI"}</b>
`;

    await sendTelegram(message);
    console.log("✅ Trade kartı gönderildi:", symbol, signal.action, signal.score);
  } catch (err) {
    console.error(`${symbol} tarama hatası:`, err.message);
  }
}

function startScanner() {
  console.log("📡 Scanner başlatıldı.");
  cron.schedule("*/1 * * * *", async () => {
    if (!isBotActive()) {
      console.log("⏸️ Bot durduruldu. Tarama yapılmadı.");
      return;
    }
    console.log("Piyasa taranıyor...");
    for (const symbol of SYMBOLS) await scanSymbol(symbol);
  });
}

module.exports = { startScanner };
