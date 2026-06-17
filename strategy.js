const { RSI, EMA, MACD } = require("technicalindicators");

function analyzeMarket(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const rsiValues = RSI.calculate({
    values: closes,
    period: 14,
  });

  const ema9 = EMA.calculate({
    values: closes,
    period: 9,
  });

  const ema21 = EMA.calculate({
    values: closes,
    period: 21,
  });

  const ema200 = EMA.calculate({
    values: closes,
    period: 50, // şimdilik 50 kullanıyoruz, sonra 200 yaparız
  });

  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const lastClose = closes[closes.length - 1];
  const lastRsi = rsiValues[rsiValues.length - 1];
  const lastEma9 = ema9[ema9.length - 1];
  const lastEma21 = ema21[ema21.length - 1];
  const lastEmaTrend = ema200[ema200.length - 1];
  const lastMacd = macdValues[macdValues.length - 1];

  const avgVolume =
    volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20;

  const lastVolume = volumes[volumes.length - 1];

  let score = 0;
  const reasons = [];

  if (lastClose > lastEmaTrend) {
    score += 20;
    reasons.push("Fiyat trend EMA üstünde");
  }

  if (lastEma9 > lastEma21) {
    score += 20;
    reasons.push("EMA9 EMA21 üstünde");
  }

  if (lastRsi > 35 && lastRsi < 68) {
    score += 20;
    reasons.push("RSI sağlıklı bölgede");
  }

  if (lastMacd && lastMacd.MACD > lastMacd.signal) {
    score += 20;
    reasons.push("MACD pozitif");
  }

  if (lastVolume > avgVolume) {
    score += 20;
    reasons.push("Hacim ortalamanın üstünde");
  }

  let action = "WAIT";

  if (score >= 80) action = "STRONG_LONG";
  else if (score >= 60) action = "WEAK_LONG";

  return {
    action,
    score,
    lastClose,
    rsi: Number(lastRsi?.toFixed(2)),
    ema9: Number(lastEma9?.toFixed(2)),
    ema21: Number(lastEma21?.toFixed(2)),
    trendEma: Number(lastEmaTrend?.toFixed(2)),
    volume: Number(lastVolume?.toFixed(2)),
    avgVolume: Number(avgVolume?.toFixed(2)),
    reasons,
  };
}

module.exports = {
  analyzeMarket,
};