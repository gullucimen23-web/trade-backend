const { readJson, writeJson } = require("./dataStore");

let dailyStats = readJson("stats.json", {
  date: new Date().toISOString().slice(0, 10),
  tradesToday: 0,
  lossPercentToday: 0,
});

function persist() {
  writeJson("stats.json", dailyStats);
}

function resetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyStats.date !== today) {
    dailyStats = { date: today, tradesToday: 0, lossPercentToday: 0 };
    persist();
  }
}

function canOpenTrade() {
  resetIfNewDay();
  const maxTrades = Number(process.env.MAX_TRADES_PER_DAY || 20);
  const maxLoss = Number(process.env.MAX_DAILY_LOSS_PERCENT || 5);

  if (dailyStats.tradesToday >= maxTrades) {
    return { allowed: false, reason: `Günlük işlem limiti doldu (${maxTrades})` };
  }

  if (dailyStats.lossPercentToday >= maxLoss) {
    return { allowed: false, reason: `Günlük zarar limiti doldu (%${maxLoss})` };
  }

  return { allowed: true };
}

function registerTradeOpen() {
  resetIfNewDay();
  dailyStats.tradesToday += 1;
  persist();
}

function registerTradeClose(pnlPercent) {
  resetIfNewDay();
  if (Number(pnlPercent) < 0) {
    dailyStats.lossPercentToday += Math.abs(Number(pnlPercent));
  }
  persist();
}

function getRiskStats() {
  resetIfNewDay();
  return dailyStats;
}

module.exports = { canOpenTrade, registerTradeOpen, registerTradeClose, getRiskStats };
