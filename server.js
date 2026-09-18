require("dotenv").config();

const express = require("express");
const { sendTelegram, sendTelegramWithButtons, answerCallbackQuery, setTelegramWebhook } = require("./telegram");
const { askOpenAIWithGuard, getOpenAIStats } = require("./openaiGuard");
const { getKlines, getPrice, getMarketDataSource } = require("./marketData");
const { analyzeMarket, analyzeMultiTimeframe } = require("./strategy");
const { startScanner, runScanCycle, getLatestSignals, getOpportunityRadar, getOpportunityRadarText } = require("./scanner");
const { getSpotAccount } = require("./binancePrivate");
const { loadOpenTrades, getOpenTrades, getAllTrades, createPaperTrade } = require("./paperTrade");
const { buildWeeklyReport, formatWeeklyReport, exportTradesCsv } = require("./paperReport");
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
const {
  BASE_URL: FUTURES_TESTNET_URL,
  syncTime: syncFuturesTestnetTime,
  getAccount: getFuturesTestnetAccount,
  getOpenPosition: getFuturesTestnetPosition,
  cancelOpenOrders: cancelFuturesTestnetOrders,
  closePositionAtMarket: closeFuturesTestnetPosition,
} = require("./binanceFuturesTestnet");
const {
  BASE_URL: MEXC_URL,
  syncTime: syncMexcTime,
  getAssets: getMexcAssets,
  getOpenPositions: getMexcOpenPositions,
  closeLivePosition: closeMexcLivePosition,
  getConfigDiagnostics: getMexcConfigDiagnostics,
} = require("./mexcFutures");
const { startMexcPositionManager, getManagedPositionsSummary } = require("./mexcPositionManager");
const { buildPerformanceAudit } = require("./performanceAudit");

const app = express();
app.use(express.json());

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  const supplied = req.get("X-Admin-Token");
  if (!expected || supplied !== expected) {
    return res.status(401).json({ ok: false, error: "Geçerli X-Admin-Token gerekli" });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    name: "Falix Trade Bot Backend",
    tradingEnabled: process.env.TRADING_ENABLED === "true",
    openai: getOpenAIStats(),
  });
});

app.get("/set-telegram-webhook", requireAdmin, async (req, res) => {
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

        await sendTelegramWithButtons(
          `
✅ <b>İşlem Canlı Takibe Alındı</b>

Parite: <b>${tracked.symbol}</b>
Yön: <b>${tracked.side}</b>
Giriş: <b>${tracked.entry}</b>
Kaldıraç: <b>${tracked.leverage}x</b>

Bot artık bu açık pozisyonu izleyecek.
Aksiyon dili: <b>POZİSYONU KORU / ÇIK</b>

İşlemden manuel çıktıysan aşağıdaki butona bas; bot bu işlemi takip etmeyi bırakır.
`,
          [[{ text: "🛑 İşlemden Çıktım / Takibi Bırak", callback_data: `STOPTRACK:${tracked.symbol}:${tracked.id}` }]],
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

        if (stopped) {
          await sendTelegram(
            `✅ <b>Takip Sonlandırıldı</b>

${stopped.symbol} ${stopped.side} takibi bırakıldı.
Yeni sinyal bekleniyor.`,
            String(user.id)
          );
        }

        return res.json({ ok: true });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook hata:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

app.get("/start-bot", requireAdmin, async (req, res) => {
  startBot();
  await sendTelegram("🟢 Bot başlatıldı. Piyasa taraması aktif.");
  res.json({ ok: true, botActive: isBotActive(), state: getBotState() });
});

app.get("/stop-bot", requireAdmin, async (req, res) => {
  stopBot();
  await sendTelegram("🔴 Bot durduruldu. Piyasa taraması pasif.");
  res.json({ ok: true, botActive: isBotActive(), state: getBotState() });
});

app.get("/test-telegram", requireAdmin, async (req, res) => {
  const sent = await sendTelegram("✅ Falix Trade Bot çalışıyor kanka.");
  res.json({ ok: true, telegramSent: sent });
});

app.get("/test-openai", requireAdmin, async (req, res) => {
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
    const [candles5m, candles15m, candles1h] = await Promise.all([
      getKlines(symbol, "5m", 220),
      getKlines(symbol, "15m", 220),
      getKlines(symbol, "1h", 220),
    ]);
    const signal = analyzeMultiTimeframe({ candles5m, candles15m, candles1h });
    res.json({ symbol, interval: "5m+15m+1h", signal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/test-binance", requireAdmin, async (req, res) => {
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

app.get("/test-futures-testnet", async (req, res) => {
  try {
    await syncFuturesTestnetTime();
    const account = await getFuturesTestnetAccount();
    res.json({
      ok: true,
      environment: "BINANCE_FUTURES_TESTNET",
      baseUrl: FUTURES_TESTNET_URL,
      canTrade: account.canTrade,
      availableBalance: account.availableBalance,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/test-mexc", requireAdmin, async (req, res) => {
  try {
    await syncMexcTime();
    const assets = await getMexcAssets();
    const usdt = assets.find((a) => a.currency === "USDT");
    res.json({
      ok: true,
      environment: "MEXC_LIVE",
      baseUrl: MEXC_URL,
      liveTradingEnabled: process.env.MEXC_LIVE_TRADING_ENABLED === "true",
      availableBalance: usdt?.availableBalance,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, config: getMexcConfigDiagnostics() });
  }
});

app.post("/mexc/close/:symbol", requireAdmin, async (req, res) => {
  try {
    const result = await closeMexcLivePosition(req.params.symbol);
    res.json({ ok: true, environment: "MEXC_LIVE", result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/mexc/positions", requireAdmin, async (req, res) => {
  try {
    const positions = await getMexcOpenPositions(req.query.symbol);
    res.json({ ok: true, environment: "MEXC_LIVE", positions });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/testnet/close/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const position = await getFuturesTestnetPosition(symbol);
    if (!position) return res.status(404).json({ ok: false, error: "Açık testnet pozisyonu yok" });
    const side = Number(position.positionAmt) > 0 ? "LONG" : "SHORT";
    await cancelFuturesTestnetOrders(symbol).catch(() => {});
    const result = await closeFuturesTestnetPosition(symbol, side);
    res.json({ ok: true, environment: "BINANCE_FUTURES_TESTNET", result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/paper/open", (req, res) => res.json({ ok: true, trades: getOpenTrades() }));
app.get("/paper/all", (req, res) => res.json({ ok: true, trades: getAllTrades() }));
app.get("/paper/report", (req, res) => {
  const report = buildWeeklyReport(getAllTrades(), { days: Number(req.query.days || process.env.REPORT_DAYS || 7) });
  res.json({ ok: true, report, text: formatWeeklyReport(report) });
});
app.get("/paper/report/send", requireAdmin, async (req, res) => {
  const report = buildWeeklyReport(getAllTrades(), { days: Number(req.query.days || process.env.REPORT_DAYS || 7) });
  await sendTelegram(formatWeeklyReport(report));
  res.json({ ok: true, sent: true, report });
});
app.get("/paper/export", (req, res) => {
  const fp = exportTradesCsv(getAllTrades());
  res.download(fp, "paper_trades.csv");
});
app.get("/risk", (req, res) => res.json({ ok: true, stats: getRiskStats() }));


app.get("/track-now/:symbol/:side", requireAdmin, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const side = req.params.side.toUpperCase();
    const entry = Number(req.query.entry);
    const leverage = Number(req.query.leverage || process.env.DEFAULT_LEVERAGE || 10);
    const amount = Number(req.query.amount || req.query.usdt || 0);
    const userId = String(req.query.userId || process.env.TELEGRAM_CHAT_ID || "");

    if (!["LONG", "SHORT"].includes(side)) {
      return res.status(400).json({ ok: false, error: "side LONG veya SHORT olmalı" });
    }

    if (!entry || Number.isNaN(entry)) {
      return res.status(400).json({ ok: false, error: "entry gerekli. Örnek: /track-now/BTCUSDT/SHORT?entry=59300&leverage=15&amount=100" });
    }

    if (!userId) {
      return res.status(400).json({ ok: false, error: "TELEGRAM_CHAT_ID yok veya userId query olarak verilmedi" });
    }

    const tracked = createManualTrackedTrade({ symbol, side, entry, leverage, amount, userId });

    await sendTelegram(`
✅ <b>Manuel İşlem Canlı Takibe Alındı</b>

Parite: <b>${tracked.symbol}</b>
Yön: <b>${tracked.side}</b>
Giriş: <b>${tracked.entry}</b>
Kaldıraç: <b>${tracked.leverage}x</b>
Pozisyon: <b>${tracked.amount || "belirtilmedi"} USDT</b>

Bot SL/TP dayatmayacak. Pozisyonu gittiği yere kadar izleyecek ve yön bozulursa uyaracak:
<b>DEVAM / KÂRI KORU / ÇIKIŞA HAZIRLAN / ŞİMDİ ÇIK</b>
`, userId);

    res.json({ ok: true, tracked });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get("/track-stop/:symbol", requireAdmin, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const userId = String(req.query.userId || process.env.TELEGRAM_CHAT_ID || "");
    if (!userId) return res.status(400).json({ ok: false, error: "TELEGRAM_CHAT_ID yok veya userId verilmedi" });
    const stopped = stopTrackedTrade(symbol, userId);
    if (!stopped) return res.status(404).json({ ok: false, error: "Takip edilen işlem bulunamadı" });
    await sendTelegram(`🛑 <b>${symbol}</b> canlı takip durduruldu.`, userId);
    res.json({ ok: true, stopped });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/market-status", (req, res) => {
  res.json({ ok: true, signals: getLatestSignals(), opportunities: getOpportunityRadar() });
});

app.get("/opportunities", (req, res) => {
  res.json({ ok: true, opportunities: getOpportunityRadar() });
});

app.get("/radar", async (req, res) => {
  try {
    const text = getOpportunityRadarText();
    if (req.query.send === "1" || req.query.telegram === "1") {
      await sendTelegram(text);
    }
    res.type("text/plain").send(text.replace(/<[^>]+>/g, ""));
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/scan-now", requireAdmin, async (req, res) => {
  try {
    await runScanCycle();
    res.json({ ok: true, message: "Tarama tamamlandı", signals: getLatestSignals() });
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
    futuresTestnet: {
      enabled: process.env.FUTURES_TESTNET_ENABLED === "true",
      autoTrading: process.env.AUTO_TESTNET_TRADING === "true",
      minScore: Number(process.env.AUTO_TESTNET_MIN_SCORE || 88),
      marginUsdt: Number(process.env.TESTNET_MARGIN_USDT || 10),
      leverage: Number(process.env.TESTNET_LEVERAGE || 3),
    },
    mexcLive: {
      selected: process.env.EXECUTION_EXCHANGE === "MEXC",
      enabled: process.env.MEXC_FUTURES_ENABLED === "true",
      liveTrading: process.env.MEXC_LIVE_TRADING_ENABLED === "true",
      entryMode: String(process.env.LIVE_ENTRY_MODE || "EDGE_V9").trim().toUpperCase(),
      minScore: Number(process.env.MEXC_AUTO_MIN_SCORE || 78),
      tierThresholdUsdt: Number(process.env.MEXC_TIER_THRESHOLD_USDT || 50),
      smallMarginUsdt: Number(process.env.MEXC_SMALL_MARGIN_USDT || 10),
      growthMarginUsdt: Number(process.env.MEXC_GROWTH_MARGIN_USDT || 20),
      reserveUsdt: Number(process.env.MEXC_MIN_RESERVE_USDT || 10),
      maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS || 1),
      leverage: Math.min(10, Number(process.env.MEXC_LEVERAGE || 3)),
    },
    profitPolicy: {
      cryptoOnly: process.env.CRYPTO_ONLY_UNIVERSE !== "false",
      universeSize: Number(process.env.UNIVERSE_SIZE || 10),
      minVolumeRatio: Number(process.env.EDGE_MIN_15M_VOLUME_RATIO || 0.80),
      minAdx: Number(process.env.EDGE_MIN_1H_ADX || 20),
      mtfAlignment: true,
      guardArmUsdt: Number(process.env.PROFIT_GUARD_ARM_USDT || 0.15),
      guardGivebackPercent: Number(process.env.PROFIT_GUARD_GIVEBACK_PERCENT || 10),
      tp1Usdt: Number(process.env.TP1_TRIGGER_USDT || 0.30),
      tp2Usdt: Number(process.env.TP2_TRIGGER_USDT || 0.60),
      finalTargetUsdt: Number(process.env.FINAL_TARGET_USDT || 1.00),
      maxPositionMinutes: Number(process.env.MAX_POSITION_MINUTES || 180),
      dollarExitMode: process.env.DOLLAR_EXIT_MODE === "true",
      riskPerTradePercent: Number(process.env.RISK_PER_TRADE_PERCENT || 0.75),
      estimatedAllInCostPercent: Number(process.env.EDGE_ALL_IN_COST_PERCENT || 0.20),
      minCostMultiple: Number(process.env.EDGE_MIN_COST_MULTIPLE || 3),
      timeframeLogic: "1h_direction_15m_setup_5m_trigger",
    },
    mexcManagedPositions: getManagedPositionsSummary(),
    marketDataSource: getMarketDataSource(),
    followReportMinutes: Number(process.env.FOLLOW_REPORT_MINUTES || 10),
    openai: getOpenAIStats(),
    risk: getRiskStats(),
    edgeValidation: buildPerformanceAudit(allTrades),
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

app.get("/approve/:symbol", requireAdmin, async (req, res) => {
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
    await sendTelegram(`✅ ONAYLANDI VE PAPER TRADE AÇILDI\n${symbol}\n${approval.side}\nSkor: ${approval.score}`);
    res.json({ ok: true, message: "Onaylandı ve paper trade açıldı", paperTrade, approval });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/reject/:symbol", requireAdmin, async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const approval = rejectTrade(symbol);
  if (!approval) return res.status(404).json({ ok: false, message: "Bekleyen işlem bulunamadı" });
  await sendTelegram(`❌ REDDEDİLDİ\n${symbol}`);
  res.json({ ok: true, approval });
});

const PORT = process.env.PORT || 3000;

function startPaperReportScheduler() {
  if (process.env.WEEKLY_REPORT_ENABLED === "false") return;
  const hours = Math.max(1, Number(process.env.REPORT_EVERY_HOURS || 24));
  const send = async () => {
    try {
      const report = buildWeeklyReport(getAllTrades(), { days: Number(process.env.REPORT_DAYS || 7) });
      if (process.env.REPORT_SEND_EMPTY !== "true" && report.total === 0) return;
      await sendTelegram(formatWeeklyReport(report));
    } catch (err) {
      console.error("Paper rapor gönderim hatası:", err.message);
    }
  };
  setInterval(send, hours * 60 * 60 * 1000);
  console.log(`📊 Paper rapor zamanlayıcı aktif: ${hours} saatte bir`);
}

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
  startMexcPositionManager();
  startPaperReportScheduler();
}

startApp();
