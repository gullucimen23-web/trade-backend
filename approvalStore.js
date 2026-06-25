const { readJson, writeJson } = require("./dataStore");

let approvals = readJson("approvals.json", {});

function persist() {
  writeJson("approvals.json", approvals);
}

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
  persist();
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
  persist();
  return approval;
}

function rejectTrade(symbol) {
  const approval = approvals[symbol];
  if (!approval) return null;
  approval.status = "REJECTED";
  approval.rejectedAt = new Date().toISOString();
  persist();
  return approval;
}

function expireOldApprovals() {
  const now = Date.now();
  let changed = false;
  for (const approval of Object.values(approvals)) {
    if (approval.status === "PENDING" && new Date(approval.expiresAt).getTime() < now) {
      approval.status = "EXPIRED";
      changed = true;
    }
  }
  if (changed) persist();
}

function getAllApprovals() {
  expireOldApprovals();
  return Object.values(approvals);
}

module.exports = {
  createApproval,
  getApproval,
  approveTrade,
  rejectTrade,
  getAllApprovals,
};
