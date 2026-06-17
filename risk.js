function buildTradePlan(symbol, signal) {
  const entry = signal.lastClose;

  let positionSizePercent = 10;
  let takeProfitPercent = 1.2;
  let stopLossPercent = 0.7;
  let confidenceLevel = "NORMAL";

  if (signal.score >= 90) {
    positionSizePercent = 20;
    takeProfitPercent = 3.0;
    stopLossPercent = 1.0;
    confidenceLevel = "VERY_STRONG";
  } else if (signal.score >= 80) {
    positionSizePercent = 15;
    takeProfitPercent = 2.0;
    stopLossPercent = 0.8;
    confidenceLevel = "STRONG";
  } else if (signal.score >= 60) {
    positionSizePercent = 8;
    takeProfitPercent = 1.0;
    stopLossPercent = 0.6;
    confidenceLevel = "WEAK";
  }

  return {
    symbol,
    side: "LONG",
    confidenceLevel,
    entry: Number(entry.toFixed(4)),
    takeProfitPercent,
    stopLossPercent,
    takeProfitPrice: Number((entry * (1 + takeProfitPercent / 100)).toFixed(4)),
    stopLossPrice: Number((entry * (1 - stopLossPercent / 100)).toFixed(4)),
    positionSizePercent,
    leverage: 2,
    trailingStop: signal.score >= 80,
    tradingEnabled: process.env.TRADING_ENABLED === "true",
  };
}

module.exports = { buildTradePlan };