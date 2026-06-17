const pendingApprovals = {};

function createApproval(symbol, signal, tradePlan) {
  const approval = {
    id: Date.now().toString(),
    symbol,
    side: signal.side,
    action: signal.action,
    score: signal.score,
    entry: tradePlan.entry,
    takeProfitPrice: tradePlan.takeProfitPrice,
    stopLossPrice: tradePlan.stopLossPrice,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  };

  pendingApprovals[symbol] = approval;
  return approval;
}

function approveTrade(symbol) {
  if (!pendingApprovals[symbol]) return null;
  pendingApprovals[symbol].status = "APPROVED";
  return pendingApprovals[symbol];
}

function rejectTrade(symbol) {
  if (!pendingApprovals[symbol]) return null;
  pendingApprovals[symbol].status = "REJECTED";
  return pendingApprovals[symbol];
}

function getAllApprovals() {
  return Object.values(pendingApprovals);
}

module.exports = {
  createApproval,
  approveTrade,
  rejectTrade,
  getAllApprovals,
};