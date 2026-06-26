const { readJson, writeJson } = require("./dataStore");

let trackedTrades = readJson("tracked.json", {});

function keyOf(symbol, userId) {
  return `${symbol}_${userId}`;
}

function persist() {
  writeJson("tracked.json", trackedTrades);
}

function createTrackedTradeFromApproval(approval, user, extra = {}) {
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
    entry: Number(extra.entry || approval.entry),
    plan: approval.tradePlan || {},
    tp1Done: false,
    tp2Done: false,
    tp3Done: false,
    stopMovedToEntry: false,
    leverage: Number(extra.leverage || approval.tradePlan?.leverage || process.env.DEFAULT_LEVERAGE || 10),
    amount: Number(extra.amount || 0),
    status: "TRACKING",
    createdAt: new Date().toISOString(),
    lastReportAt: null,
    lastUrgentStatus: null,
    lastUrgentAt: null,
    bestPrice: Number(approval.entry),
    highestPnlPercent: 0,
    lastPnlPercent: 0,
    lastPrice: Number(approval.entry),
    notes: [],
  };
  trackedTrades[key] = tracked;
  persist();
  return tracked;
}

function createManualTrackedTrade({ symbol, side, entry, leverage, userId, username = "manual", amount = 0 }) {
  const now = Date.now().toString();
  const normalizedSymbol = String(symbol).toUpperCase();
  const normalizedSide = String(side).toUpperCase();
  const key = keyOf(normalizedSymbol, userId);
  const entryPrice = Number(entry);
  const tracked = {
    id: `${now}_${userId}`,
    approvalId: `manual_${now}`,
    userId: String(userId),
    username,
    firstName: username,
    symbol: normalizedSymbol,
    side: normalizedSide,
    action: normalizedSide === "LONG" ? "MANUAL_LONG" : "MANUAL_SHORT",
    score: 0,
    entry: entryPrice,
    plan: {},
    tp1Done: false,
    tp2Done: false,
    tp3Done: false,
    stopMovedToEntry: false,
    leverage: Number(leverage || process.env.DEFAULT_LEVERAGE || 10),
    amount: Number(amount || 0),
    status: "TRACKING",
    createdAt: new Date().toISOString(),
    lastReportAt: null,
    lastUrgentStatus: null,
    lastUrgentAt: null,
    bestPrice: entryPrice,
    highestPnlPercent: 0,
    lastPnlPercent: 0,
    lastPrice: entryPrice,
    notes: [],
  };
  trackedTrades[key] = tracked;
  persist();
  return tracked;
}

function stopTrackedTrade(symbol, userId) {
  const key = keyOf(String(symbol).toUpperCase(), userId);
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

function getTrackedTrades() { return Object.values(trackedTrades); }
function getActiveTrackedTrades() { return Object.values(trackedTrades).filter((t) => t.status === "TRACKING"); }
function getActiveTrackedTradesBySymbol(symbol) { return getActiveTrackedTrades().filter((t) => t.symbol === symbol); }

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
