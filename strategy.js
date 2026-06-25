const { RSI, EMA, MACD, ADX, ATR } = require("technicalindicators");

function safeLast(arr) {
  return arr && arr.length ? arr[arr.length - 1] : null;
}

function pct(a, b) {
  if (!b) return 0;
  return ((a - b) / b) * 100;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round(n, d = 2) {
  return Number(Number(n || 0).toFixed(d));
}

function scoreToAction(side, score, entryApproved) {
  if (!side || side === "NONE" || score < 55) return { action: "WAIT", side: "NONE" };
  if (!entryApproved) {
    if (score >= 75) return { action: `WATCH_${side}`, side };
    if (score >= 55) return { action: `OBSERVE_${side}`, side };
    return { action: "WAIT", side: "NONE" };
  }
  if (score >= 92) return { action: `PRO_${side}`, side };
  if (score >= 85) return { action: `STRONG_${side}`, side };
  if (score >= 70) return { action: `WATCH_${side}`, side };
  return { action: "WAIT", side: "NONE" };
}

function analyzeMarket(candles, options = {}) {
  const timeframe = options.timeframe || "5m";
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
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

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
  const lastAtr = safeLast(atr) || 0;

  // Direnç/destek mevcut mumu dahil etmeden hesaplanır. Bu sayede "direnç kırılmadan PRO_LONG" hatası azalır.
  const lookbackHighs = highs.slice(-31, -1);
  const lookbackLows = lows.slice(-31, -1);
  const recentHigh = lookbackHighs.length ? Math.max(...lookbackHighs) : Math.max(...highs.slice(-30));
  const recentLow = lookbackLows.length ? Math.min(...lookbackLows) : Math.min(...lows.slice(-30));
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
  const atrPercent = lastClose ? (lastAtr / lastClose) * 100 : 0;

  let longScore = 0;
  let shortScore = 0;
  const longReasons = [];
  const shortReasons = [];
  const filters = [];

  function addLong(points, reason) { longScore += points; longReasons.push(reason); }
  function addShort(points, reason) { shortScore += points; shortReasons.push(reason); }
  function filter(reason) { filters.push(reason); }

  if (lastClose > lastEma50) addLong(10, "Fiyat EMA50 üstünde");
  if (lastClose > lastEma200) addLong(8, "Fiyat EMA200 üstünde");
  if (emaBull) addLong(14, "EMA9 EMA21 üstünde");
  if (emaSlopeUp) addLong(8, "EMA eğimi yukarı");
  if (lastRsi > 45 && lastRsi < 67) addLong(10, "RSI long için sağlıklı");
  if (lastRsi >= 52 && lastRsi <= 62) addLong(5, "RSI momentum long tarafında");
  if (macdSide === "BULL") addLong(12, "MACD long pozitif");
  if (macdImproving) addLong(5, "MACD histogram iyileşiyor");
  if (lastAdx.adx > 20 && lastAdx.pdi > lastAdx.mdi) addLong(12, `ADX long trend destekli: ${lastAdx.adx.toFixed(2)}`);
  if (volumeRatio > 1.05 && priceMomentum > 0) addLong(8, "Hacimli yukarı hareket");
  if (volumeRatio > 1.35 && priceMomentum > 0) addLong(5, "Güçlü hacim onayı");

  const breakoutDistance = ((recentHigh - lastClose) / lastClose) * 100;
  const breakoutConfirmed = lastClose > recentHigh && volumeRatio >= 0.9;
  if (breakoutDistance > 0 && breakoutDistance < 0.5) addLong(4, "Dirence yakın, kırılım bekleniyor");
  if (breakoutConfirmed) addLong(12, "Direnç üstü kapanış / kırılım onayı");

  if (lastClose < lastEma50) addShort(10, "Fiyat EMA50 altında");
  if (lastClose < lastEma200) addShort(8, "Fiyat EMA200 altında");
  if (emaBear) addShort(14, "EMA9 EMA21 altında");
  if (emaSlopeDown) addShort(8, "EMA eğimi aşağı");
  if (lastRsi > 33 && lastRsi < 55) addShort(10, "RSI short için uygun");
  if (lastRsi <= 48 && lastRsi >= 38) addShort(5, "RSI momentum short tarafında");
  if (macdSide === "BEAR") addShort(12, "MACD short negatif");
  if (!macdImproving) addShort(5, "MACD histogram zayıflıyor");
  if (lastAdx.adx > 20 && lastAdx.mdi > lastAdx.pdi) addShort(12, `ADX short trend destekli: ${lastAdx.adx.toFixed(2)}`);
  if (volumeRatio > 1.05 && priceMomentum < 0) addShort(8, "Hacimli aşağı hareket");
  if (volumeRatio > 1.35 && priceMomentum < 0) addShort(5, "Güçlü satış hacmi onayı");

  const breakdownDistance = ((lastClose - recentLow) / lastClose) * 100;
  const breakdownConfirmed = lastClose < recentLow && volumeRatio >= 0.9;
  if (breakdownDistance > 0 && breakdownDistance < 0.5) addShort(4, "Desteğe yakın, kırılım bekleniyor");
  if (breakdownConfirmed) addShort(12, "Destek altı kapanış / kırılım onayı");

  // Aşırı zayıf hacim aktif girişe engeldir. Piyasa doğru yönde görünse bile sinyali WATCH'a düşürür.
  const weakVolume = volumeRatio < Number(process.env.MIN_ENTRY_VOLUME_RATIO || 0.85);
  const veryWeakVolume = volumeRatio < 0.7;
  if (weakVolume) filter(`Hacim zayıf x${volumeRatio.toFixed(2)} — aktif giriş engellendi`);
  if (veryWeakVolume) {
    longScore -= 12;
    shortScore -= 12;
  }

  // Direnç/destek tam dibinde kırılım yoksa agresif PRO sinyal verme.
  const longBlockedByResistance = breakoutDistance > 0 && breakoutDistance < 0.75 && !breakoutConfirmed;
  const shortBlockedBySupport = breakdownDistance > 0 && breakdownDistance < 0.75 && !breakdownConfirmed;
  if (longBlockedByResistance) filter(`LONG için direnç ${recentHigh.toFixed(4)} üstü kapanış bekleniyor`);
  if (shortBlockedBySupport) filter(`SHORT için destek ${recentLow.toFixed(4)} altı kapanış bekleniyor`);

  longScore = clamp(Math.round(longScore), 0, 100);
  shortScore = clamp(Math.round(shortScore), 0, 100);

  let side = longScore >= shortScore ? "LONG" : "SHORT";
  let rawScore = side === "LONG" ? longScore : shortScore;
  let reasons = side === "LONG" ? longReasons : shortReasons;
  let entryApproved = rawScore >= Number(process.env.ENTRY_APPROVAL_SCORE || 85);

  if (weakVolume) entryApproved = false;
  if (side === "LONG" && longBlockedByResistance) entryApproved = false;
  if (side === "SHORT" && shortBlockedBySupport) entryApproved = false;
  if (side === "LONG" && macdSide === "BEAR" && !macdImproving) entryApproved = false;
  if (side === "SHORT" && macdSide === "BULL" && macdImproving) entryApproved = false;

  // Filtreye takılan yüksek skorlar kullanıcıyı yanıltmasın diye görünür skoru da kırpıyoruz.
  let score = rawScore;
  if (!entryApproved && rawScore >= 85) score = Math.min(rawScore, 78);
  if (!entryApproved && weakVolume) score = Math.min(score, 72);
  if (!entryApproved && veryWeakVolume) score = Math.min(score, 66);

  if (score < 55) {
    side = "NONE";
    reasons = ["Net yön yok, işlem için bekle"];
    entryApproved = false;
  }

  const actionData = scoreToAction(side, score, entryApproved);

  return {
    action: actionData.action,
    side: actionData.side,
    score,
    rawScore,
    entryApproved,
    entryBlocked: !entryApproved && side !== "NONE",
    filters,
    timeframe,
    longScore,
    shortScore,
    lastClose: round(lastClose, 4),
    rsi: round(lastRsi, 2),
    ema9: round(lastEma9, 4),
    ema21: round(lastEma21, 4),
    trendEma: round(lastEma50, 4),
    ema200: round(lastEma200, 4),
    macdSide,
    macdHistogram: round(macdHistogram, 4),
    adx: round(lastAdx.adx || 0, 2),
    pdi: round(lastAdx.pdi || 0, 2),
    mdi: round(lastAdx.mdi || 0, 2),
    volume: round(lastVolume, 2),
    avgVolume: round(avgVolume, 2),
    volumeRatio: round(volumeRatio, 2),
    atr: round(lastAtr, 4),
    atrPercent: round(atrPercent, 2),
    resistance: round(recentHigh, 4),
    support: round(recentLow, 4),
    breakoutDistance: round(breakoutDistance, 2),
    breakdownDistance: round(breakdownDistance, 2),
    breakoutConfirmed,
    breakdownConfirmed,
    reasons,
  };
}

function sameDirectionScore(signal, side) {
  if (!signal || !side || side === "NONE") return 0;
  return side === "LONG" ? Number(signal.longScore || 0) : Number(signal.shortScore || 0);
}

function oppositeDirectionScore(signal, side) {
  if (!signal || !side || side === "NONE") return 0;
  return side === "LONG" ? Number(signal.shortScore || 0) : Number(signal.longScore || 0);
}

function applyMultiTimeframeFilter(primary, mid, high) {
  const result = { ...primary, mtf: { mid, high }, mtfFilters: [] };
  if (!primary || primary.side === "NONE") return result;

  const side = primary.side;
  const midSame = sameDirectionScore(mid, side);
  const highSame = sameDirectionScore(high, side);
  const midOpp = oppositeDirectionScore(mid, side);
  const highOpp = oppositeDirectionScore(high, side);

  const midRejects = midOpp >= 65 && midOpp > midSame + 8;
  const highRejects = highOpp >= 60 && highOpp > highSame + 8;
  const midConfirms = midSame >= Number(process.env.MTF_MID_CONFIRM_SCORE || 55) && midSame >= midOpp;
  const highNotAgainst = !highRejects;

  result.mtfSummary = {
    midSame, highSame, midOpp, highOpp, midConfirms, highNotAgainst,
  };

  if (!midConfirms) result.mtfFilters.push(`15m aynı yön teyidi zayıf (${midSame}/${midOpp})`);
  if (midRejects) result.mtfFilters.push(`15m ters yön baskısı güçlü (${midOpp})`);
  if (highRejects) result.mtfFilters.push(`1h ters yön baskısı var (${highOpp})`);

  if (result.mtfFilters.length) {
    result.entryApproved = false;
    result.entryBlocked = true;
    result.score = Math.min(Number(result.score || 0), 74);
    result.action = result.score >= 55 ? `WATCH_${side}` : "WAIT";
    result.filters = [...(result.filters || []), ...result.mtfFilters];
  } else if (result.entryApproved && result.score >= 85) {
    result.filters = [...(result.filters || []), "5m + 15m uyumlu, 1h ters baskı yok"];
  }

  return result;
}

function analyzeMultiTimeframe({ candles5m, candles15m, candles1h }) {
  const primary = analyzeMarket(candles5m, { timeframe: "5m" });
  const mid = analyzeMarket(candles15m, { timeframe: "15m" });
  const high = analyzeMarket(candles1h, { timeframe: "1h" });
  return applyMultiTimeframeFilter(primary, mid, high);
}

module.exports = { analyzeMarket, analyzeMultiTimeframe };
