function buildTradePlan(symbol, signal) {
  const entry = signal.lastClose;
  const side = signal.side || "LONG";

  let positionSizePercent = 10;
  let takeProfitPercent = 1.2;
  let stopLossPercent = 0.7;
  let confidenceLevel = "NORMAL";

  if (signal.score >= 95) {
    positionSizePercent = 20;
    takeProfitPercent = 3;
    stopLossPercent = 1;
    confidenceLevel = "AUTO_PRO";
  } else if (signal.score >= 90) {
    positionSizePercent = 18;
    takeProfitPercent = 2.5;
    stopLossPercent = 0.9;
    confidenceLevel = "PRO";
  } else if (signal.score >= 80) {
    positionSizePercent = 15;
    takeProfitPercent = 2;
    stopLossPercent = 0.8;
    confidenceLevel = "STRONG";
  }

  const isLong = side === "LONG";

  const takeProfitPrice = isLong
    ? entry * (1 + takeProfitPercent / 100)
    : entry * (1 - takeProfitPercent / 100);

  const stopLossPrice = isLong
    ? entry * (1 - stopLossPercent / 100)
    : entry * (1 + stopLossPercent / 100);

  return {
    symbol,
    side,
    confidenceLevel,
    entry: Number(entry.toFixed(4)),
    takeProfitPercent,
    stopLossPercent,
    takeProfitPrice: Number(takeProfitPrice.toFixed(4)),
    stopLossPrice: Number(stopLossPrice.toFixed(4)),
    positionSizePercent,
    leverage: Number(process.env.DEFAULT_LEVERAGE || 2),
    tradingEnabled: process.env.TRADING_ENABLED === "true",
  };
}

module.exports = { buildTradePlan };