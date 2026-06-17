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

  let score = 0;
  const reasons = [];

  if (lastClose > lastEma50) {
    score += 15;
    reasons.push("Fiyat ana trend EMA50 üstünde");
  }

  if (lastEma9 > lastEma21) {
    score += 15;
    reasons.push("EMA9 EMA21 üstünde");
  }

  if (lastRsi > 38 && lastRsi < 65) {
    score += 15;
    reasons.push("RSI sağlıklı alım bölgesinde");
  }

  if (lastMacd && lastMacd.MACD > lastMacd.signal) {
    score += 15;
    reasons.push("MACD pozitif");
  }

  if (lastAdx && lastAdx.adx > 20) {
    score += 15;
    reasons.push(`ADX trend gücü iyi: ${lastAdx.adx.toFixed(2)}`);
  }

  if (lastVolume > avgVolume * 1.2) {
    score += 15;
    reasons.push("Hacim ortalamanın %20 üstünde");
  }

  const breakoutDistance = ((recentHigh - lastClose) / lastClose) * 100;
  const supportDistance = ((lastClose - recentLow) / lastClose) * 100;

  if (breakoutDistance < 0.6) {
    score += 10;
    reasons.push("Direnç kırılımına yakın");
  }

  let action = "WAIT";

  if (score >= 90) action = "PRO_LONG";
  else if (score >= 80) action = "STRONG_LONG";
  else if (score >= 65) action = "WATCH";

  return {
    action,
    score,
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
    supportDistance: Number(supportDistance.toFixed(2)),
    reasons,
  };
}

module.exports = {
  analyzeMarket,
};