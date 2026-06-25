const { readJson, writeJson } = require("./dataStore");

let trackedTrades = readJson("tracked.json", {});

function keyOf(symbol, userId) {
  return `${symbol}_${userId}`;
}

function persist() {
  writeJson("tracked.json", trackedTrades);
}

function createTrackedTradeFromApproval(approval, user) {
  const key = keyOf(approval.symbol, user.id);

  const tracked = {
    id: `${approval.id}_${user.id}`,
    approvalId: approval.id,
    userId: String(user.id),
    username: user.username || "",
    firstName: user.first_name || "",
    symbol: approval.symbol,
    side: approval.side,
    action: approval.action,
    score: approval.score,
    entry: Number(approval.entry),
    takeProfitPrice: Number(approval.takeProfitPrice),
    tp1Price: Number(approval.tradePlan?.tp1Price || approval.takeProfitPrice),
    tp2Price: Number(approval.tradePlan?.tp2Price || approval.takeProfitPrice),
    tp3Price: Number(approval.tradePlan?.tp3Price || approval.takeProfitPrice),
    originalStopLossPrice: Number(approval.stopLossPrice),
    stopLossPrice: Number(approval.stopLossPrice),
    activeStopLossPrice: Number(approval.stopLossPrice),
    takeProfitPercent: approval.tradePlan?.takeProfitPercent,
    stopLossPercent: approval.tradePlan?.stopLossPercent,
    leverage: approval.tradePlan?.leverage || 1,
    status: "TRACKING",
    createdAt: new Date().toISOString(),
    lastReportAt: null,
    lastRiskMoveAt: null,
    bestPrice: Number(approval.entry),
    highestPnlPercent: 0,
    riskLevel: "INITIAL_RISK",
    trailStep: 0,
    notes: [],
  };

  trackedTrades[key] = tracked;
  persist();
  return tracked;
}

function createManualTrackedTrade({ symbol, side, entry, leverage, userId, username = "manual" }) {
  const now = Date.now().toString();
  const normalizedSymbol = String(symbol).toUpperCase();
  const normalizedSide = String(side).toUpperCase();
  const key = keyOf(normalizedSymbol, userId);
  const isLong = normalizedSide === "LONG";
  const lev = Number(leverage || process.env.DEFAULT_LEVERAGE || 10);
  const entryPrice = Number(entry);
  const slPercent = lev >= 15 ? 0.6 : 0.8;
  const tp1Percent = lev >= 15 ? 1.0 : 1.2;
  const tp2Percent = lev >= 15 ? 1.8 : 2.2;
  const tp3Percent = lev >= 15 ? 2.6 : 3.2;
  const priceByPercent = (percent) => Number((isLong ? entryPrice * (1 + percent / 100) : entryPrice * (1 - percent / 100)).toFixed(4));
  const stopLossPrice = Number((isLong ? entryPrice * (1 - slPercent / 100) : entryPrice * (1 + slPercent / 100)).toFixed(4));

  const tracked = {
    id: `${now}_${userId}`,
    approvalId: `manual_${now}`,
    userId: String(userId),
    username,
    firstName: username,
    symbol: normalizedSymbol,
    side: normalizedSide,
    action: normalizedSide === "LONG" ? "STRONG_LONG" : "STRONG_SHORT",
    score: 0,
    entry: entryPrice,
    takeProfitPrice: priceByPercent(tp1Percent),
    tp1Price: priceByPercent(tp1Percent),
    tp2Price: priceByPercent(tp2Percent),
    tp3Price: priceByPercent(tp3Percent),
    originalStopLossPrice: stopLossPrice,
    stopLossPrice,
    activeStopLossPrice: stopLossPrice,
    takeProfitPercent: tp1Percent,
    stopLossPercent: slPercent,
    leverage: lev,
    status: "TRACKING",
    createdAt: new Date().toISOString(),
    lastReportAt: null,
    lastRiskMoveAt: null,
    bestPrice: entryPrice,
    highestPnlPercent: 0,
    riskLevel: "MANUAL_TRACK",
    trailStep: 0,
    notes: [],
  };

  trackedTrades[key] = tracked;
  persist();
  return tracked;
}

function stopTrackedTrade(symbol, userId) {
  const key = keyOf(symbol, userId);
  const tracked = trackedTrades[key];

  if (!tracked) return null;

  tracked.status = "STOPPED";
  tracked.stoppedAt = new Date().toISOString();
  persist();
  return tracked;
}

function closeTrackedTrade(tracked, status, currentPrice, pnlPercent) {
  tracked.status = status;
  tracked.exit = Number(currentPrice);
  tracked.pnlPercent = Number(pnlPercent);
  tracked.closedAt = new Date().toISOString();
  persist();
  return tracked;
}

function saveTrackedTrade(tracked) {
  const key = keyOf(tracked.symbol, tracked.userId);
  trackedTrades[key] = tracked;
  persist();
  return tracked;
}

function getTrackedTrades() {
  return Object.values(trackedTrades);
}

function getActiveTrackedTrades() {
  return Object.values(trackedTrades).filter((t) => t.status === "TRACKING");
}

function getActiveTrackedTradesBySymbol(symbol) {
  return getActiveTrackedTrades().filter((t) => t.symbol === symbol);
}

module.exports = {
  createTrackedTradeFromApproval,
  createManualTrackedTrade,
  stopTrackedTrade,
  closeTrackedTrade,
  saveTrackedTrade,
  getTrackedTrades,
  getActiveTrackedTrades,
  getActiveTrackedTradesBySymbol,
};
