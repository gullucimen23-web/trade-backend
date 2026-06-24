let dailyStats = {
  date: new Date().toISOString().slice(0, 10),
  tradesToday: 0,
  lossPercentToday: 0,
};

function resetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);

  if (dailyStats.date !== today) {
    dailyStats = {
      date: today,
      tradesToday: 0,
      lossPercentToday: 0,
    };
  }
}

function canOpenTrade() {
  resetIfNewDay();

  const maxLoss = Number(process.env.MAX_DAILY_LOSS_PERCENT || 3);

  if (dailyStats.lossPercentToday >= maxLoss) {
    return {
      allowed: false,
      reason: "Günlük zarar limiti doldu",
    };
  }

  return {
    allowed: true,
  };
}

function registerTradeOpen() {
  resetIfNewDay();
  dailyStats.tradesToday += 1;
}

function registerTradeClose(pnlPercent) {
  resetIfNewDay();

  if (pnlPercent < 0) {
    dailyStats.lossPercentToday += Math.abs(pnlPercent);
  }
}

function getRiskStats() {
  resetIfNewDay();
  return dailyStats;
}

module.exports = {
  canOpenTrade,
  registerTradeOpen,
  registerTradeClose,
  getRiskStats,
};
