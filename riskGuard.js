const { readJson, writeJson } = require("./dataStore");

const KINDS = ["LIVE", "PAPER", "TESTNET"];
const files = { LIVE: "live_stats.json", PAPER: "paper_stats.json", TESTNET: "testnet_stats.json" };
const stats = {};

function fresh() {
  return { date: new Date().toISOString().slice(0, 10), tradesToday: 0, lossPercentToday: 0 };
}

for (const kind of KINDS) stats[kind] = readJson(files[kind], fresh());

function normalizeKind(kind) {
  const value = String(kind || "LIVE").toUpperCase();
  return KINDS.includes(value) ? value : "LIVE";
}

function resetIfNewDay(kind) {
  const key = normalizeKind(kind);
  const today = new Date().toISOString().slice(0, 10);
  if (stats[key].date !== today) {
    stats[key] = fresh();
    writeJson(files[key], stats[key]);
  }
  return key;
}

function persist(kind) {
  const key = normalizeKind(kind);
  writeJson(files[key], stats[key]);
}

function canOpenTrade(kind = "LIVE") {
  const key = resetIfNewDay(kind);
  const prefix = key === "LIVE" ? "" : `${key}_`;
  const maxTrades = Number(process.env[`${prefix}MAX_TRADES_PER_DAY`] || process.env.MAX_TRADES_PER_DAY || 20);
  const maxLoss = Number(process.env[`${prefix}MAX_DAILY_LOSS_PERCENT`] || process.env.MAX_DAILY_LOSS_PERCENT || 5);
  if (stats[key].tradesToday >= maxTrades) return { allowed: false, reason: `${key} günlük işlem limiti doldu (${maxTrades})` };
  if (stats[key].lossPercentToday >= maxLoss) return { allowed: false, reason: `${key} günlük zarar limiti doldu (%${maxLoss})` };
  return { allowed: true };
}

function registerTradeOpen(kind = "LIVE") {
  const key = resetIfNewDay(kind);
  stats[key].tradesToday += 1;
  persist(key);
}

function registerTradeClose(pnlPercent, kind = "LIVE") {
  const key = resetIfNewDay(kind);
  if (Number(pnlPercent) < 0) stats[key].lossPercentToday += Math.abs(Number(pnlPercent));
  persist(key);
}

function getRiskStats() {
  for (const kind of KINDS) resetIfNewDay(kind);
  return { live: stats.LIVE, paper: stats.PAPER, testnet: stats.TESTNET };
}

module.exports = { canOpenTrade, registerTradeOpen, registerTradeClose, getRiskStats };
