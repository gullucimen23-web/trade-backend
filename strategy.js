const { RSI, EMA, MACD, ADX } = require("technicalindicators");

function analyzeMarket(candles) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const lastClose = closes[closes.length - 1];

  const rsi = RSI.calculate({ values: closes, period: 14 });
  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const ema21 = EMA.calculate({ values: closes, period: 21 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });

  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const adx = ADX.calculate({
    close: closes,
    high: highs,
    low: lows,
    period: 14,
  });

  const lastRsi = rsi[rsi.length - 1];
  const lastEma9 = ema9[ema9.length - 1];
  const lastEma21 = ema21[ema21.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastMacd = macd[macd.length - 1];
  const lastAdx = adx[adx.length - 1];

  const recentHigh = Math.max(...highs.slice(-30));
  const recentLow = Math.min(...lows.slice(-30));

  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const lastVolume = volumes[volumes.length - 1];

  let longScore = 0;
  let shortScore = 0;
  const longReasons = [];
  const shortReasons = [];

  // LONG şartları
  if (lastClose > lastEma50) {
    longScore += 15;
    longReasons.push("Fiyat EMA50 üstünde");
  }

  if (lastEma9 > lastEma21) {
    longScore += 15;
    longReasons.push("EMA9 EMA21 üstünde");
  }

  if (lastRsi > 38 && lastRsi < 65) {
    longScore += 15;
    longReasons.push("RSI long için sağlıklı");
  }

  if (lastMacd && lastMacd.MACD > lastMacd.signal) {
    longScore += 15;
    longReasons.push("MACD long pozitif");
  }

  if (lastAdx && lastAdx.adx > 20) {
    longScore += 15;
    longReasons.push(`ADX trend güçlü: ${lastAdx.adx.toFixed(2)}`);
  }

  if (lastVolume > avgVolume * 1.2) {
    longScore += 15;
    longReasons.push("Hacim güçlü");
  }

  const breakoutDistance = ((recentHigh - lastClose) / lastClose) * 100;
  if (breakoutDistance < 0.6) {
    longScore += 10;
    longReasons.push("Direnç kırılımına yakın");
  }

  // SHORT şartları
  if (lastClose < lastEma50) {
    shortScore += 15;
    shortReasons.push("Fiyat EMA50 altında");
  }

  if (lastEma9 < lastEma21) {
    shortScore += 15;
    shortReasons.push("EMA9 EMA21 altında");
  }

  if (lastRsi > 35 && lastRsi < 62) {
    shortScore += 15;
    shortReasons.push("RSI short için uygun");
  }

  if (lastMacd && lastMacd.MACD < lastMacd.signal) {
    shortScore += 15;
    shortReasons.push("MACD short negatif");
  }

  if (lastAdx && lastAdx.adx > 20) {
    shortScore += 15;
    shortReasons.push(`ADX düşüş trendi güçlü: ${lastAdx.adx.toFixed(2)}`);
  }

  if (lastVolume > avgVolume * 1.2) {
    shortScore += 15;
    shortReasons.push("Hacim güçlü");
  }

  const breakdownDistance = ((lastClose - recentLow) / lastClose) * 100;
  if (breakdownDistance < 0.6) {
    shortScore += 10;
    shortReasons.push("Destek kırılımına yakın");
  }

  let action = "WAIT";
  let score = 0;
  let side = "NONE";
  let reasons = [];

  if (longScore >= shortScore) {
    score = longScore;
    side = "LONG";
    reasons = longReasons;

    if (score >= 90) action = "PRO_LONG";
    else if (score >= 80) action = "STRONG_LONG";
    else if (score >= 65) action = "WATCH_LONG";
  } else {
    score = shortScore;
    side = "SHORT";
    reasons = shortReasons;

    if (score >= 90) action = "PRO_SHORT";
    else if (score >= 80) action = "STRONG_SHORT";
    else if (score >= 65) action = "WATCH_SHORT";
  }

  if (score < 65) {
    action = "WAIT";
    side = "NONE";
  }

  return {
    action,
    side,
    score,
    longScore,
    shortScore,
    lastClose,
    rsi: Number(lastRsi?.toFixed(2)),
    ema9: Number(lastEma9?.toFixed(2)),
    ema21: Number(lastEma21?.toFixed(2)),
    trendEma: Number(lastEma50?.toFixed(2)),
    adx: Number(lastAdx?.adx?.toFixed(2)),
    volume: Number(lastVolume?.toFixed(2)),
    avgVolume: Number(avgVolume?.toFixed(2)),
    resistance: Number(recentHigh.toFixed(4)),
    support: Number(recentLow.toFixed(4)),
    breakoutDistance: Number(breakoutDistance.toFixed(2)),
    breakdownDistance: Number(breakdownDistance.toFixed(2)),
    reasons,
  };
}

module.exports = { analyzeMarket };