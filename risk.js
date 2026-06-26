function roundPrice(value) {
  return Number(Number(value).toFixed(4));
}

function buildTradePlan(symbol, signal, override = {}) {
  // Yeni ana sistem: swing emir planı. Signal içinde plan varsa aynen onu kullanır.
  if (signal && signal.plan) {
    return {
      symbol,
      side: signal.side,
      mode: "SWING_PLAN",
      confidenceLevel: signal.score >= 95 ? "ULTRA" : signal.score >= 90 ? "PRO" : "WATCH",
      entry: roundPrice(signal.plan.entry),
      entryLow: roundPrice(signal.plan.entryLow),
      entryHigh: roundPrice(signal.plan.entryHigh),
      stopLossPrice: roundPrice(signal.plan.stopLossPrice),
      stopLossPercent: signal.plan.stopLossPercent,
      tp1Price: roundPrice(signal.plan.tp1Price),
      tp2Price: roundPrice(signal.plan.tp2Price),
      tp3Price: roundPrice(signal.plan.tp3Price),
      tp1Percent: signal.plan.tp1Percent,
      tp2Percent: signal.plan.tp2Percent,
      tp3Percent: signal.plan.tp3Percent,
      tp1ClosePercent: signal.plan.tp1ClosePercent,
      tp2ClosePercent: signal.plan.tp2ClosePercent,
      tp3ClosePercent: signal.plan.tp3ClosePercent,
      riskReward: signal.plan.riskReward,
      targetProfitUsdt: signal.plan.targetProfitUsdt,
      estimatedMarginUsdt: signal.plan.estimatedMarginUsdt,
      estimatedRiskUsdt: signal.plan.estimatedRiskUsdt,
      requiredNotionalUsdt: signal.plan.requiredNotionalUsdt,
      positionSizePercent: 10,
      leverage: signal.plan.leverage,
      timeWindow: signal.plan.timeWindow,
      tradingEnabled: false,
      manualOnly: true,
    };
  }

  // Eski sistem geriye uyumluluk için duruyor ama otomatik trade kapalı tutulur.
  const entry = Number(override.entry || signal.lastClose);
  const side = override.side || signal.side || "LONG";
  const leverage = Number(override.leverage || process.env.DEFAULT_LEVERAGE || 5);
  const tp1Percent = 1.2;
  const tp2Percent = 2.2;
  const tp3Percent = 3.2;
  const stopLossPercent = 0.8;
  const isLong = side === "LONG";
  const priceByPercent = (percent) => roundPrice(isLong ? entry * (1 + percent / 100) : entry * (1 - percent / 100));
  const stopLossPrice = roundPrice(isLong ? entry * (1 - stopLossPercent / 100) : entry * (1 + stopLossPercent / 100));
  return {
    symbol,
    side,
    confidenceLevel: "LEGACY",
    entry: roundPrice(entry),
    entryLow: roundPrice(entry * 0.999),
    entryHigh: roundPrice(entry * 1.001),
    tp1Price: priceByPercent(tp1Percent),
    tp2Price: priceByPercent(tp2Percent),
    tp3Price: priceByPercent(tp3Percent),
    stopLossPrice,
    tp1Percent,
    tp2Percent,
    tp3Percent,
    stopLossPercent,
    positionSizePercent: 10,
    leverage,
    tradingEnabled: false,
    manualOnly: true,
  };
}

module.exports = { buildTradePlan };
