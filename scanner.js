const cron = require("node-cron");
const { getKlines } = require("./binance");
const { analyzeMarket } = require("./strategy");
const { askOpenAIWithGuard } = require("./openaiGuard");
const { sendTelegram } = require("./telegram");
const { buildTradePlan } = require("./risk");
const {
  createPaperTrade,
  updatePaperTrades,
} = require("./paperTrade");
const {
  canOpenTrade,
  registerTradeOpen,
} = require("./riskGuard");
const { createApproval } = require("./approvalStore");

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
let lastSignals = {};

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
Durum: <b>${closed.status}</b>
Giriş: <b>${closed.entry}</b>
Çıkış: <b>${closed.exit}</b>
PnL: <b>%${closed.pnlPercent}</b>
`);
    }

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

    const paperTrade = await createPaperTrade(symbol, signal, tradePlan);

    if (paperTrade) {
      registerTradeOpen();
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

Onay Komutu:
<b>ONAYLA ${symbol}</b>

Red Komutu:
<b>RED ${symbol}</b>

Onay ID: <b>${approval.id}</b>

Paper Trade: <b>${paperTrade ? "AÇILDI" : "Açık işlem zaten var"}</b>

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
    console.log("✅ Onaylı trade kartı gönderildi:", symbol, signal.action, signal.score);
  } catch (err) {
    console.error(`${symbol} tarama hatası:`, err.message);
  }
}

function startScanner() {
  console.log("📡 Scanner başlatıldı.");

  cron.schedule("*/1 * * * *", async () => {
    console.log("Piyasa taranıyor...");

    for (const symbol of SYMBOLS) {
      await scanSymbol(symbol);
    }
  });
}

module.exports = { startScanner };