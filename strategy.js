const { RSI, EMA, MACD, ADX } = require("technicalindicators");

function safeLast(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

function pct(a, b) {
  if (!b) return 0;
  return ((a - b) / b) * 100;
}

function analyzeMarket(candles) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2] || lastClose;

  const rsi = RSI.calculate({ values: closes, period: 14 });
  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const ema21 = EMA.calculate({ values: closes, period: 21 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const ema200 = EMA.calculate({ values: closes, period: 200 });

  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const adx = ADX.calculate({ close: closes, high: highs, low: lows, period: 14 });

  const lastRsi = safeLast(rsi) || 50;
  const lastEma9 = safeLast(ema9) || lastClose;
  const prevEma9 = ema9.length > 1 ? ema9[ema9.length - 2] : lastEma9;
  const lastEma21 = safeLast(ema21) || lastClose;
  const prevEma21 = ema21.length > 1 ? ema21[ema21.length - 2] : lastEma21;
  const lastEma50 = safeLast(ema50) || lastClose;
  const lastEma200 = safeLast(ema200) || lastEma50;
  const lastMacd = safeLast(macd);
  const prevMacd = macd.length > 1 ? macd[macd.length - 2] : lastMacd;
  const lastAdx = safeLast(adx) || { adx: 0, pdi: 0, mdi: 0 };

  const recentHigh = Math.max(...highs.slice(-30));
  const recentLow = Math.min(...lows.slice(-30));
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
  const lastVolume = volumes[volumes.length - 1];
  const volumeRatio = avgVolume ? lastVolume / avgVolume : 1;

  const macdHistogram = lastMacd ? lastMacd.histogram : 0;
  const prevHistogram = prevMacd ? prevMacd.histogram : macdHistogram;
  const macdSide = !lastMacd ? "NEUTRAL" : lastMacd.MACD > lastMacd.signal ? "BULL" : "BEAR";
  const macdImproving = macdHistogram > prevHistogram;
  const emaBull = lastEma9 > lastEma21;
  const emaBear = lastEma9 < lastEma21;
  const emaSlopeUp = lastEma9 > prevEma9 && lastEma21 >= prevEma21;
  const emaSlopeDown = lastEma9 < prevEma9 && lastEma21 <= prevEma21;
  const priceMomentum = pct(lastClose, prevClose);

  let longScore = 0;
  let shortScore = 0;
  const longReasons = [];
  const shortReasons = [];

  function addLong(points, reason) { longScore += points; longReasons.push(reason); }
  function addShort(points, reason) { shortScore += points; shortReasons.push(reason); }

  if (lastClose > lastEma50) addLong(12, "Fiyat EMA50 üstünde");
  if (lastClose > lastEma200) addLong(8, "Fiyat EMA200 üstünde");
  if (emaBull) addLong(16, "EMA9 EMA21 üstünde");
  if (emaSlopeUp) addLong(10, "EMA eğimi yukarı");
  if (lastRsi > 45 && lastRsi < 68) addLong(13, "RSI long için sağlıklı");
  if (lastRsi >= 52 && lastRsi <= 62) addLong(6, "RSI momentum long tarafında");
  if (macdSide === "BULL") addLong(15, "MACD long pozitif");
  if (macdImproving) addLong(6, "MACD histogram iyileşiyor");
  if (lastAdx.adx > 18 && lastAdx.pdi > lastAdx.mdi) addLong(12, `ADX long trend destekli: ${lastAdx.adx.toFixed(2)}`);
  if (volumeRatio > 1.15 && priceMomentum > 0) addLong(10, "Hacimli yukarı hareket");

  const breakoutDistance = ((recentHigh - lastClose) / lastClose) * 100;
  if (breakoutDistance < 0.5) addLong(8, "Direnç kırılımına yakın");
  if (lastClose > recentHigh * 0.998 && volumeRatio > 1.05) addLong(8, "Kırılım baskısı var");

  if (lastClose < lastEma50) addShort(12, "Fiyat EMA50 altında");
  if (lastClose < lastEma200) addShort(8, "Fiyat EMA200 altında");
  if (emaBear) addShort(16, "EMA9 EMA21 altında");
  if (emaSlopeDown) addShort(10, "EMA eğimi aşağı");
  if (lastRsi > 32 && lastRsi < 55) addShort(13, "RSI short için uygun");
  if (lastRsi <= 48 && lastRsi >= 38) addShort(6, "RSI momentum short tarafında");
  if (macdSide === "BEAR") addShort(15, "MACD short negatif");
  if (!macdImproving) addShort(6, "MACD histogram zayıflıyor");
  if (lastAdx.adx > 18 && lastAdx.mdi > lastAdx.pdi) addShort(12, `ADX short trend destekli: ${lastAdx.adx.toFixed(2)}`);
  if (volumeRatio > 1.15 && priceMomentum < 0) addShort(10, "Hacimli aşağı hareket");

  const breakdownDistance = ((lastClose - recentLow) / lastClose) * 100;
  if (breakdownDistance < 0.5) addShort(8, "Destek kırılımına yakın");
  if (lastClose < recentLow * 1.002 && volumeRatio > 1.05) addShort(8, "Aşağı kırılım baskısı var");

  longScore = Math.min(100, Math.round(longScore));
  shortScore = Math.min(100, Math.round(shortScore));

  let action = "WAIT";
  let score = 0;
  let side = "NONE";
  let reasons = [];

  if (longScore >= shortScore) {
    score = longScore;
    side = score >= 55 ? "LONG" : "NONE";
    reasons = longReasons;
    if (score >= 92) action = "PRO_LONG";
    else if (score >= 85) action = "STRONG_LONG";
    else if (score >= 70) action = "WATCH_LONG";
  } else {
    score = shortScore;
    side = score >= 55 ? "SHORT" : "NONE";
    reasons = shortReasons;
    if (score >= 92) action = "PRO_SHORT";
    else if (score >= 85) action = "STRONG_SHORT";
    else if (score >= 70) action = "WATCH_SHORT";
  }

  if (score < 55) {
    action = "WAIT";
    side = "NONE";
    reasons = ["Net yön yok, işlem için bekle"];
  }

  return {
    action,
    side,
    score,
    longScore,
    shortScore,
    lastClose: Number(lastClose.toFixed(4)),
    rsi: Number(Number(lastRsi).toFixed(2)),
    ema9: Number(Number(lastEma9).toFixed(4)),
    ema21: Number(Number(lastEma21).toFixed(4)),
    trendEma: Number(Number(lastEma50).toFixed(4)),
    ema200: Number(Number(lastEma200).toFixed(4)),
    macdSide,
    macdHistogram: Number(Number(macdHistogram).toFixed(4)),
    adx: Number(Number(lastAdx.adx || 0).toFixed(2)),
    pdi: Number(Number(lastAdx.pdi || 0).toFixed(2)),
    mdi: Number(Number(lastAdx.mdi || 0).toFixed(2)),
    volume: Number(Number(lastVolume).toFixed(2)),
    avgVolume: Number(Number(avgVolume).toFixed(2)),
    volumeRatio: Number(Number(volumeRatio).toFixed(2)),
    resistance: Number(recentHigh.toFixed(4)),
    support: Number(recentLow.toFixed(4)),
    breakoutDistance: Number(breakoutDistance.toFixed(2)),
    breakdownDistance: Number(breakdownDistance.toFixed(2)),
    reasons,
  };
}

module.exports = { analyzeMarket };
