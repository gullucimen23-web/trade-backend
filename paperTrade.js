const { readJson, writeJson } = require("./dataStore");
const { registerTradeClose, registerTradeOpen } = require("./riskGuard");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

let trades = asArray(readJson("trades.json", []));

function persist() {
  writeJson("trades.json", trades);
}

async function loadOpenTrades() {
  trades = asArray(readJson("trades.json", []));
  console.log(`♻️ JSON'dan ${getOpenTrades().length} açık paper işlem yüklendi.`);
  return trades;
}

async function createPaperTrade(symbol, signal, tradePlan, options = {}) {
  const allowMultiple = process.env.PAPER_ALLOW_MULTIPLE_PER_SYMBOL === "true";
  const exists = trades.find((t) => t.symbol === symbol && t.status === "OPEN");
  if (exists && !allowMultiple) return null;

  const tradeNo = Number(readJson("paper_counter.json", { value: 0 }).value || 0) + 1;
  writeJson("paper_counter.json", { value: tradeNo });
  const id = `FALIX-${String(tradeNo).padStart(6, "0")}`;

  const trade = {
    id,
    symbol,
    side: tradePlan.side,
    status: "OPEN",
    entry: Number(tradePlan.entry),
    exit: null,
    tp1Price: Number(tradePlan.tp1Price || tradePlan.takeProfitPrice),
    tp2Price: Number(tradePlan.tp2Price || tradePlan.takeProfitPrice),
    tp3Price: Number(tradePlan.tp3Price || tradePlan.takeProfitPrice),
    takeProfitPrice: Number(tradePlan.tp3Price || tradePlan.takeProfitPrice),
    originalStopLossPrice: Number(tradePlan.stopLossPrice),
    stopLossPrice: Number(tradePlan.stopLossPrice),
    activeStopLossPrice: Number(tradePlan.stopLossPrice),
    tp1Done: false,
    tp2Done: false,
    tp3Done: false,
    tp1ClosePercent: Number(tradePlan.tp1ClosePercent || 30),
    tp2ClosePercent: Number(tradePlan.tp2ClosePercent || 40),
    tp3ClosePercent: Number(tradePlan.tp3ClosePercent || 30),
    takeProfitPercent: tradePlan.takeProfitPercent || tradePlan.tp3Percent,
    stopLossPercent: tradePlan.stopLossPercent,
    positionSizePercent: tradePlan.positionSizePercent,
    leverage: tradePlan.leverage,
    score: signal.score,
    confidence: signal.confidence,
    volumeRatio: signal.volumeRatio,
    riskReward: tradePlan.riskReward,
    plan: tradePlan,
    signalSnapshot: {
      score: signal.score,
      confidence: signal.confidence,
      volumeRatio: signal.volumeRatio,
      marketRegime: signal.marketRegime?.label,
      reasons: signal.reasons || [],
      filters: signal.filters || [],
    },
    reason: (signal.reasons || []).slice(0, 4).join(" | "),
    openedAt: new Date().toISOString(),
    bestPrice: Number(tradePlan.entry),
    highestPnlPercent: 0,
    partialRealizedPnlPercent: 0,
    riskLevel: "INITIAL_RISK",
    trailStep: 0,
    source: options.source || "AUTO_PAPER",
  };

  trades.push(trade);
  persist();
  registerTradeOpen();
  return trade;
}

function getOpenTrades() {
  trades = asArray(trades);
  return trades.filter((t) => t.status === "OPEN");
}

function getAllTrades() {
  trades = asArray(trades);
  return trades;
}

function calculatePnlPercent(trade, currentPrice) {
  const isLong = trade.side === "LONG";
  const rawPnl = isLong
    ? ((currentPrice - trade.entry) / trade.entry) * 100
    : ((trade.entry - currentPrice) / trade.entry) * 100;

  return Number((rawPnl * Number(trade.leverage || 1)).toFixed(2));
}

function improvePaperRisk(trade, currentPrice) {
  const pnlPercent = calculatePnlPercent(trade, currentPrice);
  trade.highestPnlPercent = Math.max(Number(trade.highestPnlPercent || 0), pnlPercent);

  const isLong = trade.side === "LONG";
  const bestBefore = Number(trade.bestPrice || trade.entry);
  trade.bestPrice = isLong ? Math.max(bestBefore, currentPrice) : Math.min(bestBefore, currentPrice);

  const oldSl = Number(trade.activeStopLossPrice || trade.stopLossPrice);
  let newSl = oldSl;
  let riskMessage = null;

  const setStopByProfit = (lockedProfitPercent, level, label) => {
    const priceMove = lockedProfitPercent / Number(trade.leverage || 1) / 100;
    const targetSl = isLong
      ? trade.entry * (1 + priceMove)
      : trade.entry * (1 - priceMove);

    const better = isLong ? targetSl > newSl : targetSl < newSl;
    if (better) {
      newSl = Number(targetSl.toFixed(4));
      trade.riskLevel = level;
      riskMessage = label;
    }
  };

  if (pnlPercent >= 0.6) setStopByProfit(0, "BREAK_EVEN", "Risk azaltıldı: SL giriş fiyatına çekildi.");
  if (pnlPercent >= 1.2) setStopByProfit(0.35, "LOCK_035", "Kâr koruma: SL yaklaşık +%0.35 kâra çekildi.");
  if (pnlPercent >= 2.0) setStopByProfit(0.8, "LOCK_080", "Kâr koruma: SL yaklaşık +%0.80 kâra çekildi.");
  if (pnlPercent >= 3.0) setStopByProfit(1.4, "TRAILING", "Trailing koruma aktif: SL kârı koruyacak şekilde taşındı.");

  if (newSl !== oldSl) {
    trade.activeStopLossPrice = newSl;
    trade.stopLossPrice = newSl;
    trade.lastRiskMoveAt = new Date().toISOString();
    return { changed: true, oldSl, newSl, pnlPercent, riskMessage };
  }

  return { changed: false, oldSl, newSl, pnlPercent, riskMessage: null };
}

async function updatePaperTrades(symbol, currentPrice) {
  trades = asArray(trades);
  const price = Number(currentPrice);
  if (!Number.isFinite(price)) return { closed: [], events: [] };

  const closed = [];
  const events = [];
  let changed = false;

  for (const trade of trades) {
    if (trade.symbol !== symbol || trade.status !== "OPEN") continue;

    const riskMove = improvePaperRisk(trade, price);
    if (riskMove.changed) {
      changed = true;
      events.push({ type: "RISK_MOVED", trade, message: riskMove.riskMessage, price, pnlPercent: riskMove.pnlPercent });
    }

    const isLong = trade.side === "LONG";
    const activeStop = Number(trade.activeStopLossPrice || trade.stopLossPrice);
    const hit = (level) => isLong ? price >= Number(level) : price <= Number(level);

    const pnlNow = calculatePnlPercent(trade, price);
    if (!trade.tp1Done && hit(trade.tp1Price)) {
      trade.tp1Done = true;
      trade.tp1At = new Date().toISOString();
      trade.partialRealizedPnlPercent = Number((Number(trade.partialRealizedPnlPercent || 0) + pnlNow * (Number(trade.tp1ClosePercent || 30) / 100)).toFixed(2));
      trade.activeStopLossPrice = trade.entry;
      trade.stopLossPrice = trade.entry;
      trade.riskLevel = "TP1_BREAK_EVEN";
      changed = true;
      events.push({ type: "TP1", trade, price, pnlPercent: pnlNow });
    }

    if (!trade.tp2Done && hit(trade.tp2Price)) {
      trade.tp2Done = true;
      trade.tp2At = new Date().toISOString();
      trade.partialRealizedPnlPercent = Number((Number(trade.partialRealizedPnlPercent || 0) + pnlNow * (Number(trade.tp2ClosePercent || 40) / 100)).toFixed(2));
      changed = true;
      events.push({ type: "TP2", trade, price, pnlPercent: pnlNow });
    }

    const hitTp3 = !trade.tp3Done && hit(trade.tp3Price);
    const hitSl = isLong ? price <= activeStop : price >= activeStop;

    if (hitTp3 || hitSl) {
      if (hitTp3) {
        trade.tp3Done = true;
        trade.tp3At = new Date().toISOString();
      }
      trade.status = hitTp3 ? "CLOSED_TP" : "CLOSED_SL";
      trade.exit = price;
      const finalWeight = trade.tp1Done || trade.tp2Done ? Number(trade.tp3ClosePercent || 30) / 100 : 1;
      const finalPnl = pnlNow * finalWeight;
      trade.pnlPercent = Number((Number(trade.partialRealizedPnlPercent || 0) + finalPnl).toFixed(2));
      trade.closedAt = new Date().toISOString();
      registerTradeClose(trade.pnlPercent);
      closed.push(trade);
      events.push({ type: trade.status, trade, price, pnlPercent: trade.pnlPercent });
      changed = true;
    }
  }

  if (changed) persist();
  return { closed, events };
}

module.exports = {
  loadOpenTrades,
  createPaperTrade,
  getOpenTrades,
  getAllTrades,
  updatePaperTrades,
  calculatePnlPercent,
  improvePaperRisk,
};
