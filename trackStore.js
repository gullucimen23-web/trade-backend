const { applyRiskReduction } = require("./riskManager");

const trackedTrades = {};

function createTrackedTradeFromApproval(approval, user) {
  const key = `${approval.symbol}_${user.id}`;

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
    entry: approval.entry,
    takeProfitPrice: approval.takeProfitPrice,
    stopLossPrice: approval.stopLossPrice,
    initialStopLossPrice: approval.stopLossPrice,
    takeProfitPercent: approval.tradePlan?.takeProfitPercent,
    stopLossPercent: approval.tradePlan?.stopLossPercent,
    leverage: approval.tradePlan?.leverage || 1,
    status: "TRACKING",
    createdAt: new Date().toISOString(),
    lastReportAt: null,
    breakEvenActivated: false,
    lockedProfitPercent: 0,
  };

  trackedTrades[key] = tracked;
  return tracked;
}

function stopTrackedTrade(symbol, userId) {
  const key = `${symbol}_${userId}`;
  const tracked = trackedTrades[key];

  if (!tracked) return null;

  tracked.status = "STOPPED";
  tracked.stoppedAt = new Date().toISOString();

  return tracked;
}

function closeTrackedTrade(tracked, status, currentPrice, pnlPercent) {
  tracked.status = status;
  tracked.exit = currentPrice;
  tracked.pnlPercent = pnlPercent;
  tracked.closedAt = new Date().toISOString();
  return tracked;
}

function reduceTrackedTradeRisk(tracked, currentPrice) {
  return applyRiskReduction(tracked, currentPrice);
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
  reduceTrackedTradeRisk,
  getTrackedTrades,
  getActiveTrackedTrades,
  getActiveTrackedTradesBySymbol,
};
