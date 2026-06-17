require("dotenv").config();

const express = require("express");
const { sendTelegram } = require("./telegram");
const { askOpenAIWithGuard, getOpenAIStats } = require("./openaiGuard");
const { getKlines, getPrice } = require("./binance");
const { analyzeMarket } = require("./strategy");
const { startScanner } = require("./scanner");
const { startTelegramCommands } = require("./telegramCommands");
const { getSpotAccount } = require("./binancePrivate");
const { loadOpenTrades, getOpenTrades, getAllTrades } = require("./paperTrade");
const { getRiskStats } = require("./riskGuard");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Falix Trade Bot Backend",
    tradingEnabled: process.env.TRADING_ENABLED === "true",
    openai: getOpenAIStats(),
  });
});

app.get("/test-telegram", async (req, res) => {
  const sent = await sendTelegram("✅ Falix Trade Bot çalışıyor kanka.");
  res.json({ ok: true, telegramSent: sent });
});

app.get("/test-openai", async (req, res) => {
  const result = await askOpenAIWithGuard({
    symbol: "BTCUSDT",
    signalScore: 88,
    trend: "Yukarı trend",
    rsi: 42,
    ema: "EMA9 > EMA21",
    volume: "Hacim ortalamanın üstünde",
  });

  res.json(result);
});

app.get("/price/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const price = await getPrice(symbol);
    res.json(price);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/signal/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const candles = await getKlines(symbol, "5m", 100);
    const signal = analyzeMarket(candles);

    res.json({
      symbol,
      interval: "5m",
      signal,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/test-binance", async (req, res) => {
  try {
    const account = await getSpotAccount();

    res.json({
      ok: true,
      canReadAccount: true,
      accountType: "SPOT",
      balances: account.balances
        ?.filter((a) => Number(a.free) > 0 || Number(a.locked) > 0)
        ?.map((a) => ({
          asset: a.asset,
          free: a.free,
          locked: a.locked,
        })),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.response?.data || err.message,
    });
  }
});

app.get("/paper/open", (req, res) => {
  res.json({
    ok: true,
    trades: getOpenTrades(),
  });
});

app.get("/paper/all", (req, res) => {
  res.json({
    ok: true,
    trades: getAllTrades(),
  });
});

app.get("/risk", (req, res) => {
  res.json({
    ok: true,
    stats: getRiskStats(),
  });
});

app.get("/status", (req, res) => {
  const openTrades = getOpenTrades();
  const allTrades = getAllTrades();

  res.json({
    ok: true,
    bot: "RUNNING",
    tradingEnabled: process.env.TRADING_ENABLED === "true",
    tradeMode: process.env.TRADE_MODE || "SPOT",
    openai: getOpenAIStats(),
    risk: getRiskStats(),
    paper: {
      openTrades: openTrades.length,
      totalTrades: allTrades.length,
      trades: openTrades,
    },
  });
});

const PORT = process.env.PORT || 3000;

async function startApp() {
  await loadOpenTrades();
  startScanner();
  startTelegramCommands();

  app.listen(PORT, () => {
    console.log(`✅ Bot backend çalışıyor: http://localhost:${PORT}`);
  });
}

startApp();