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
let BOT_ACTIVE = true;

function setBotActive(active) {
  BOT_ACTIVE = active;
}

function isBotActive() {
  return BOT_ACTIVE;
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
    let paperTrade = null;
    let autoText = "Manuel onay bekliyor.";

    if (autoMode && signal.score >= autoMinScore) {
      paperTrade = await createPaperTrade(symbol, signal, tradePlan);

      if (paperTrade) {
        registerTradeOpen();
        autoText = "AUTO_MODE ile otomatik paper trade açıldı.";
      } else {
        autoText = "AUTO_MODE aktif ama açık işlem zaten var.";
      }
    }

    const baseUrl = process.env.PUBLIC_URL || "https://trade-backend-0fz1.onrender.com";

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

✅ Onay Linki:
${baseUrl}/approve/${symbol}

❌ Red Linki:
${baseUrl}/reject/${symbol}

Onay ID: <b>${approval.id}</b>
Geçerlilik: <b>3 dakika</b>

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
    if (!BOT_ACTIVE) {
      console.log("⏸️ Bot STOP modunda. Piyasa taraması durdu.");
      return;
    }

    console.log("Piyasa taranıyor...");

    for (const symbol of SYMBOLS) {
      await scanSymbol(symbol);
    }
  });
}

module.exports = { startScanner, setBotActive, isBotActive };