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
  stopTrackedTrade,
  closeTrackedTrade,
  saveTrackedTrade,
  getTrackedTrades,
  getActiveTrackedTrades,
  getActiveTrackedTradesBySymbol,
};
