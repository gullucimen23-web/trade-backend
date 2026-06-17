const approvals = {};

function createApproval(symbol, signal, tradePlan) {
  const approval = {
    id: Date.now().toString(),
    symbol,
    side: signal.side,
    action: signal.action,
    score: signal.score,
    signal,
    tradePlan,
    entry: tradePlan.entry,
    takeProfitPrice: tradePlan.takeProfitPrice,
    stopLossPrice: tradePlan.stopLossPrice,
    status: "PENDING",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
  };

  approvals[symbol] = approval;
  return approval;
}

function getApproval(symbol) {
  return approvals[symbol];
}

function approveTrade(symbol) {
  const approval = approvals[symbol];
  if (!approval) return null;
  approval.status = "APPROVED";
  approval.approvedAt = new Date().toISOString();
  return approval;
}

function rejectTrade(symbol) {
  const approval = approvals[symbol];
  if (!approval) return null;
  approval.status = "REJECTED";
  approval.rejectedAt = new Date().toISOString();
  return approval;
}

function getAllApprovals() {
  return Object.values(approvals);
}

module.exports = {
  createApproval,
  getApproval,
  approveTrade,
  rejectTrade,
  getAllApprovals,
};