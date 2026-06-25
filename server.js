require("dotenv").config();

const express = require("express");
const { sendTelegram, answerCallbackQuery, setTelegramWebhook } = require("./telegram");
const { askOpenAIWithGuard, getOpenAIStats } = require("./openaiGuard");
const { getKlines, getPrice } = require("./binance");
const { analyzeMarket } = require("./strategy");
const { startScanner } = require("./scanner");
const { getSpotAccount } = require("./binancePrivate");
const { loadOpenTrades, getOpenTrades, getAllTrades, createPaperTrade } = require("./paperTrade");
const { getRiskStats, registerTradeOpen } = require("./riskGuard");
const { isBotActive, startBot, stopBot, getBotState } = require("./botState");
const { getApproval, approveTrade, rejectTrade, getAllApprovals } = require("./approvalStore");
const {
  createTrackedTradeFromApproval,
  createManualTrackedTrade,
  stopTrackedTrade,
  getTrackedTrades,
  getActiveTrackedTrades,
} = require("./trackStore");

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

app.get("/set-telegram-webhook", async (req, res) => {
  try {
    const result = await setTelegramWebhook();
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;

    if (update.callback_query) {
      const callback = update.callback_query;
      const data = callback.data || "";
      const user = callback.from || {};
      const parts = data.split(":");
      const command = parts[0];
      const symbol = parts[1];
      const approvalId = parts[2];

      if (command === "TRACK") {
        const approval = getApproval(symbol);

        if (!approval || approval.id !== approvalId) {
          await answerCallbackQuery(callback.id, "Bu sinyal artık bulunamadı.");
          return res.json({ ok: true });
        }

        const tracked = createTrackedTradeFromApproval(approval, user);

        await answerCallbackQuery(callback.id, "Takibe alındı. Raporlar özelden gelecek.");

        await sendTelegram(
          `
✅ <b>İşlem Takibe Alındı</b>

Parite: <b>${tracked.symbol}</b>
Yön: <b>${tracked.side}</b>
Giriş: <b>${tracked.entry}</b>
TP1: <b>${tracked.tp1Price || tracked.takeProfitPrice}</b>
TP2: <b>${tracked.tp2Price || tracked.takeProfitPrice}</b>
TP3: <b>${tracked.tp3Price || tracked.takeProfitPrice}</b>
SL: <b>${tracked.stopLossPrice}</b>

Not: Özel mesajların gelmesi için botu özelden /start yapmış olman gerekebilir.
`,
          tracked.userId
        );

        return res.json({ ok: true });
      }

      if (command === "IGNORE") {
        await answerCallbackQuery(callback.id, "Tamam, takip edilmeyecek.");
        return res.json({ ok: true });
      }

      if (command === "STOPTRACK") {
        const stopped = stopTrackedTrade(symbol, user.id);

        await answerCallbackQuery(
          callback.id,
          stopped ? "Takip durduruldu." : "Takip bulunamadı."
        );

        return res.json({ ok: true });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook hata:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.get("/start-bot", async (req, res) => {
  startBot();
  await sendTelegram("🟢 Bot başlatıldı. Piyasa taraması aktif.");
  res.json({ ok: true, botActive: isBotActive(), state: getBotState() });
});

app.get("/stop-bot", async (req, res) => {
  stopBot();
  await sendTelegram("🔴 Bot durduruldu. Piyasa taraması pasif.");
  res.json({ ok: true, botActive: isBotActive(), state: getBotState() });
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
    res.json({ symbol, interval: "5m", signal });
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
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

app.get("/paper/open", (req, res) => res.json({ ok: true, trades: getOpenTrades() }));
app.get("/paper/all", (req, res) => res.json({ ok: true, trades: getAllTrades() }));
app.get("/risk", (req, res) => res.json({ ok: true, stats: getRiskStats() }));


app.get("/track-now/:symbol/:side", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const side = req.params.side.toUpperCase();
    const entry = Number(req.query.entry);
    const leverage = Number(req.query.leverage || process.env.DEFAULT_LEVERAGE || 10);
    const userId = String(req.query.userId || process.env.TELEGRAM_CHAT_ID || "");

    if (!["LONG", "SHORT"].includes(side)) {
      return res.status(400).json({ ok: false, error: "side LONG veya SHORT olmalı" });
    }

    if (!entry || Number.isNaN(entry)) {
      return res.status(400).json({ ok: false, error: "entry gerekli. Örnek: /track-now/BTCUSDT/SHORT?entry=59300&leverage=15" });
    }

    if (!userId) {
      return res.status(400).json({ ok: false, error: "TELEGRAM_CHAT_ID yok veya userId query olarak verilmedi" });
    }

    const tracked = createManualTrackedTrade({ symbol, side, entry, leverage, userId });

    await sendTelegram(`
✅ <b>Manuel İşlem Canlı Takibe Alındı</b>

Parite: <b>${tracked.symbol}</b>
Yön: <b>${tracked.side}</b>
Giriş: <b>${tracked.entry}</b>
Kaldıraç: <b>${tracked.leverage}x</b>

🎯 TP1: <b>${tracked.tp1Price}</b>
🎯 TP2: <b>${tracked.tp2Price}</b>
🎯 TP3: <b>${tracked.tp3Price}</b>
🛑 SL: <b>${tracked.stopLossPrice}</b>

Bot artık bu işlemi canlı takip edecek.
`, userId);

    res.json({ ok: true, tracked });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/tracked", (req, res) => {
  res.json({
    ok: true,
    active: getActiveTrackedTrades(),
    all: getTrackedTrades(),
  });
});

app.get("/status", (req, res) => {
  const openTrades = getOpenTrades();
  const allTrades = getAllTrades();

  res.json({
    ok: true,
    bot: "RUNNING",
    botActive: isBotActive(),
    botState: getBotState(),
    tradingEnabled: process.env.TRADING_ENABLED === "true",
    tradeMode: process.env.TRADE_MODE || "SPOT",
    autoMode: process.env.AUTO_MODE === "true",
    autoMinScore: Number(process.env.AUTO_MIN_SCORE || 95),
    followReportMinutes: Number(process.env.FOLLOW_REPORT_MINUTES || 10),
    openai: getOpenAIStats(),
    risk: getRiskStats(),
    approvals: getAllApprovals(),
    tracked: {
      active: getActiveTrackedTrades().length,
      total: getTrackedTrades().length,
    },
    paper: {
      openTrades: openTrades.length,
      totalTrades: allTrades.length,
      trades: openTrades,
    },
  });
});

app.get("/approvals", (req, res) => res.json({ ok: true, approvals: getAllApprovals() }));

app.get("/approve/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const approval = getApproval(symbol);

    if (!approval) return res.status(404).json({ ok: false, message: "Bekleyen işlem bulunamadı" });
    if (approval.status !== "PENDING") return res.status(400).json({ ok: false, message: `İşlem zaten ${approval.status}`, approval });

    const ageMs = Date.now() - new Date(approval.createdAt).getTime();
    if (ageMs > 3 * 60 * 1000) {
      approval.status = "EXPIRED";
      await sendTelegram(`⏰ Onay süresi geçti: ${symbol}`);
      return res.status(400).json({ ok: false, message: "Onay süresi geçti", approval });
    }

    const priceData = await getPrice(symbol);
    const currentPrice = Number(priceData.price);
    const entry = Number(approval.entry);
    const maxSlipPercent = Number(process.env.MAX_APPROVAL_SLIPPAGE_PERCENT || 0.25);

    const diffPercent =
      approval.side === "LONG"
        ? ((currentPrice - entry) / entry) * 100
        : ((entry - currentPrice) / entry) * 100;

    if (diffPercent > maxSlipPercent) {
      approval.status = "PRICE_MOVED";
      await sendTelegram(`⚠️ Fiyat kaçtı, işlem açılmadı.\n${symbol}\nEntry: ${entry}\nŞu an: ${currentPrice}`);
      return res.status(400).json({ ok: false, message: "Fiyat kaçtı, işlem açılmadı", currentPrice, approval });
    }

    approveTrade(symbol);
    const paperTrade = await createPaperTrade(symbol, approval.signal, approval.tradePlan);
    if (paperTrade) registerTradeOpen();

    await sendTelegram(`✅ ONAYLANDI VE PAPER TRADE AÇILDI\n${symbol}\n${approval.side}\nSkor: ${approval.score}`);
    res.json({ ok: true, message: "Onaylandı ve paper trade açıldı", paperTrade, approval });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/reject/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const approval = rejectTrade(symbol);
  if (!approval) return res.status(404).json({ ok: false, message: "Bekleyen işlem bulunamadı" });
  await sendTelegram(`❌ REDDEDİLDİ\n${symbol}`);
  res.json({ ok: true, approval });
});

const PORT = process.env.PORT || 3000;

async function startApp() {
  app.listen(PORT, () => {
    console.log(`✅ Bot backend çalışıyor: http://localhost:${PORT}`);
  });

  try {
    await loadOpenTrades();
  } catch (err) {
    console.error("Açık işlem yükleme hatası, bot yine de çalışacak:", err.message);
  }

  startScanner();
}

startApp();
