function roundPrice(value) {
  return Number(Number(value).toFixed(4));
}

function buildTradePlan(symbol, signal, override = {}) {
  const entry = Number(override.entry || signal.lastClose);
  const side = override.side || signal.side || "LONG";
  const leverage = Number(override.leverage || process.env.DEFAULT_LEVERAGE || 10);

  let positionSizePercent = leverage >= 15 ? 8 : 10;
  let tp1Percent = leverage >= 15 ? 1.0 : 1.2;
  let tp2Percent = leverage >= 15 ? 1.8 : 2.2;
  let tp3Percent = leverage >= 15 ? 2.6 : 3.2;
  let stopLossPercent = leverage >= 15 ? 0.6 : 0.8;
  let confidenceLevel = "NORMAL";

  if (signal.score >= 95) {
    positionSizePercent = leverage >= 15 ? 10 : 15;
    tp1Percent = leverage >= 15 ? 1.2 : 1.5;
    tp2Percent = leverage >= 15 ? 2.2 : 2.8;
    tp3Percent = leverage >= 15 ? 3.2 : 4.0;
    stopLossPercent = leverage >= 15 ? 0.65 : 0.85;
    confidenceLevel = "ULTRA";
  } else if (signal.score >= 90) {
    positionSizePercent = leverage >= 15 ? 9 : 12;
    tp1Percent = leverage >= 15 ? 1.1 : 1.4;
    tp2Percent = leverage >= 15 ? 2.0 : 2.5;
    tp3Percent = leverage >= 15 ? 3.0 : 3.6;
    stopLossPercent = leverage >= 15 ? 0.6 : 0.8;
    confidenceLevel = "PRO";
  } else if (signal.score >= 80) {
    confidenceLevel = "STRONG";
  }

  const isLong = side === "LONG";
  const priceByPercent = (percent) => {
    return roundPrice(isLong ? entry * (1 + percent / 100) : entry * (1 - percent / 100));
  };

  const stopLossPrice = roundPrice(isLong
    ? entry * (1 - stopLossPercent / 100)
    : entry * (1 + stopLossPercent / 100));

  return {
    symbol,
    side,
    confidenceLevel,
    entry: roundPrice(entry),
    entryLow: roundPrice(entry * 0.999),
    entryHigh: roundPrice(entry * 1.001),
    takeProfitPercent: tp1Percent,
    tp1Percent,
    tp2Percent,
    tp3Percent,
    stopLossPercent,
    takeProfitPrice: priceByPercent(tp1Percent),
    tp1Price: priceByPercent(tp1Percent),
    tp2Price: priceByPercent(tp2Percent),
    tp3Price: priceByPercent(tp3Percent),
    stopLossPrice,
    positionSizePercent,
    leverage,
    tradingEnabled: process.env.TRADING_ENABLED === "true",
  };
}

module.exports = { buildTradePlan };
