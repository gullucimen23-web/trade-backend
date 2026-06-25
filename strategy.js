const { RSI, EMA, MACD, ADX, ATR, BollingerBands } = require("technicalindicators");

function safeLast(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
function pct(a, b) { if (!b) return 0; return ((a - b) / b) * 100; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function round(n, d = 2) { return Number(Number(n || 0).toFixed(d)); }

function scoreToAction(side, score, entryApproved) {
  if (!side || side === "NONE" || score < 55) return { action: "WAIT", side: "NONE" };
  if (!entryApproved) {
    if (score >= 75) return { action: `WATCH_${side}`, side };
    if (score >= 55) return { action: `OBSERVE_${side}`, side };
    return { action: "WAIT", side: "NONE" };
  }
  if (score >= 94) return { action: `PRO_${side}`, side };
  if (score >= 88) return { action: `STRONG_${side}`, side };
  if (score >= 78) return { action: `WATCH_${side}`, side };
  return { action: "WAIT", side: "NONE" };
}

function detectMarketRegime({ adx, atrPercent, volumeRatio, ema9, ema21, ema50, ema200, lastClose, bbWidthPercent }) {
  if (volumeRatio < 0.45) return { regime: "DEAD_VOLUME", label: "Hacimsiz / ölü piyasa", risk: "HIGH", allowEntry: false };
  if (atrPercent > 1.8) return { regime: "HIGH_VOLATILITY", label: "Aşırı oynak", risk: "HIGH", allowEntry: false };
  if (bbWidthPercent < 0.45 && adx < 20) return { regime: "SQUEEZE", label: "Sıkışma", risk: "MEDIUM", allowEntry: false };
  if (adx < 18) return { regime: "RANGE", label: "Yatay / kararsız", risk: "MEDIUM", allowEntry: false };

  const bullStack = lastClose > ema50 && ema50 > ema200 && ema9 > ema21;
  const bearStack = lastClose < ema50 && ema50 < ema200 && ema9 < ema21;
  if (adx >= 22 && (bullStack || bearStack)) return { regime: "TREND", label: bullStack ? "Yukarı trend" : "Aşağı trend", risk: "LOW", allowEntry: true };
  return { regime: "MIXED", label: "Karışık ama takip edilebilir", risk: "MEDIUM", allowEntry: true };
}

function buildGuide(signal) {
  const price = signal.lastClose;
  const longTrigger = signal.resistance;
  const shortTrigger = signal.support;
  const volumeNeed = Number(process.env.MIN_ENTRY_VOLUME_RATIO || 0.85);
  const direction = signal.side && signal.side !== "NONE" ? signal.side : "NONE";
  const next = [];

  if (direction === "LONG") {
    next.push(`LONG için ${longTrigger} üstü 5m kapanış ve hacim x${volumeNeed}+ beklenir.`);
    next.push(`${signal.ema21} altına sarkma long fikrini zayıflatır.`);
  } else if (direction === "SHORT") {
    next.push(`SHORT için ${shortTrigger} altı 5m kapanış ve hacim x${volumeNeed}+ beklenir.`);
    next.push(`${signal.ema21} üstüne atma short fikrini zayıflatır.`);
  } else {
    next.push(`LONG için ${longTrigger} üstü hacimli kapanış bekle.`);
    next.push(`SHORT için ${shortTrigger} altı hacimli kapanış bekle.`);
  }

  let decision = "BEKLE";
  if (signal.entryApproved) decision = `${direction} GİRİŞ ONAYI`;
  else if (signal.entryBlocked) decision = `${direction} HAZIRLIK / GİRİŞ YOK`;

  return { decision, price, next, summary: `${signal.marketRegime?.label || "Piyasa"} | Hacim x${signal.volumeRatio} | Güven ${signal.confidence}%` };
}

function calculateConfidence({ score, entryApproved, volumeRatio, marketRegime, mtfOk, breakoutConfirmed, breakdownConfirmed, side }) {
  let c = Number(score || 0);
  if (!entryApproved) c -= 15;
  if (volumeRatio < 0.85) c -= 15;
  if (volumeRatio < 0.55) c -= 15;
  if (marketRegime && marketRegime.allowEntry === false) c -= 18;
  if (!mtfOk) c -= 10;
  if (side === "LONG" && !breakoutConfirmed) c -= 7;
  if (side === "SHORT" && !breakdownConfirmed) c -= 7;
  return clamp(Math.round(c), 0, 100);
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
  const bb = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  const macd = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
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
  const lastBb = safeLast(bb);
  const bbWidthPercent = lastBb ? ((lastBb.upper - lastBb.lower) / lastClose) * 100 : 0;

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
  const marketRegime = detectMarketRegime({ adx: lastAdx.adx || 0, atrPercent, volumeRatio, ema9: lastEma9, ema21: lastEma21, ema50: lastEma50, ema200: lastEma200, lastClose, bbWidthPercent });

  let longScore = 0, shortScore = 0;
  const longReasons = [], shortReasons = [], filters = [];
  const addLong = (p, r) => { longScore += p; longReasons.push(r); };
  const addShort = (p, r) => { shortScore += p; shortReasons.push(r); };
  const filter = (r) => filters.push(r);

  if (lastClose > lastEma50) addLong(9, "Fiyat EMA50 üstünde");
  if (lastClose > lastEma200) addLong(8, "Fiyat EMA200 üstünde");
  if (emaBull) addLong(13, "EMA9 EMA21 üstünde");
  if (emaSlopeUp) addLong(8, "EMA eğimi yukarı");
  if (lastRsi > 45 && lastRsi < 66) addLong(9, "RSI long için sağlıklı");
  if (lastRsi >= 52 && lastRsi <= 62) addLong(5, "RSI momentum long tarafında");
  if (macdSide === "BULL") addLong(11, "MACD long pozitif");
  if (macdImproving) addLong(5, "MACD histogram iyileşiyor");
  if (lastAdx.adx > 21 && lastAdx.pdi > lastAdx.mdi) addLong(11, `ADX long trend destekli: ${lastAdx.adx.toFixed(2)}`);
  if (volumeRatio > 1.05 && priceMomentum > 0) addLong(8, "Hacimli yukarı hareket");
  if (volumeRatio > 1.35 && priceMomentum > 0) addLong(5, "Güçlü hacim onayı");

  const breakoutDistance = ((recentHigh - lastClose) / lastClose) * 100;
  const breakoutConfirmed = lastClose > recentHigh && volumeRatio >= Number(process.env.BREAKOUT_VOLUME_RATIO || 0.95);
  if (breakoutDistance > 0 && breakoutDistance < 0.5) addLong(3, "Dirence yakın, kırılım bekleniyor");
  if (breakoutConfirmed) addLong(14, "Direnç üstü kapanış / kırılım onayı");

  if (lastClose < lastEma50) addShort(9, "Fiyat EMA50 altında");
  if (lastClose < lastEma200) addShort(8, "Fiyat EMA200 altında");
  if (emaBear) addShort(13, "EMA9 EMA21 altında");
  if (emaSlopeDown) addShort(8, "EMA eğimi aşağı");
  if (lastRsi > 34 && lastRsi < 55) addShort(9, "RSI short için uygun");
  if (lastRsi <= 48 && lastRsi >= 38) addShort(5, "RSI momentum short tarafında");
  if (macdSide === "BEAR") addShort(11, "MACD short negatif");
  if (!macdImproving) addShort(5, "MACD histogram zayıflıyor");
  if (lastAdx.adx > 21 && lastAdx.mdi > lastAdx.pdi) addShort(11, `ADX short trend destekli: ${lastAdx.adx.toFixed(2)}`);
  if (volumeRatio > 1.05 && priceMomentum < 0) addShort(8, "Hacimli aşağı hareket");
  if (volumeRatio > 1.35 && priceMomentum < 0) addShort(5, "Güçlü satış hacmi onayı");

  const breakdownDistance = ((lastClose - recentLow) / lastClose) * 100;
  const breakdownConfirmed = lastClose < recentLow && volumeRatio >= Number(process.env.BREAKOUT_VOLUME_RATIO || 0.95);
  if (breakdownDistance > 0 && breakdownDistance < 0.5) addShort(3, "Desteğe yakın, kırılım bekleniyor");
  if (breakdownConfirmed) addShort(14, "Destek altı kapanış / kırılım onayı");

  const minVol = Number(process.env.MIN_ENTRY_VOLUME_RATIO || 0.85);
  const weakVolume = volumeRatio < minVol;
  const veryWeakVolume = volumeRatio < 0.55;
  if (weakVolume) filter(`Hacim zayıf x${volumeRatio.toFixed(2)} — aktif giriş engellendi`);
  if (marketRegime.allowEntry === false) filter(`Piyasa rejimi: ${marketRegime.label} — giriş engellendi`);
  if (veryWeakVolume) { longScore -= 18; shortScore -= 18; }

  const longBlockedByResistance = breakoutDistance > 0 && breakoutDistance < Number(process.env.NEAR_LEVEL_BLOCK_PERCENT || 0.8) && !breakoutConfirmed;
  const shortBlockedBySupport = breakdownDistance > 0 && breakdownDistance < Number(process.env.NEAR_LEVEL_BLOCK_PERCENT || 0.8) && !breakdownConfirmed;
  if (longBlockedByResistance) filter(`LONG için direnç ${recentHigh.toFixed(4)} üstü kapanış bekleniyor`);
  if (shortBlockedBySupport) filter(`SHORT için destek ${recentLow.toFixed(4)} altı kapanış bekleniyor`);

  longScore = clamp(Math.round(longScore), 0, 100);
  shortScore = clamp(Math.round(shortScore), 0, 100);
  let side = longScore >= shortScore ? "LONG" : "SHORT";
  let rawScore = side === "LONG" ? longScore : shortScore;
  let reasons = side === "LONG" ? longReasons : shortReasons;
  let entryApproved = rawScore >= Number(process.env.ENTRY_APPROVAL_SCORE || 88);

  if (weakVolume || marketRegime.allowEntry === false) entryApproved = false;
  if (side === "LONG" && longBlockedByResistance) entryApproved = false;
  if (side === "SHORT" && shortBlockedBySupport) entryApproved = false;
  if (side === "LONG" && macdSide === "BEAR" && !macdImproving) entryApproved = false;
  if (side === "SHORT" && macdSide === "BULL" && macdImproving) entryApproved = false;

  // En sert güvenlik: aktif giriş için ya kırılım onayı ya da çok net trend + hacim gerekir.
  const cleanTrendLong = side === "LONG" && lastClose > lastEma50 && lastEma50 >= lastEma200 * 0.998 && emaBull && emaSlopeUp && lastAdx.pdi > lastAdx.mdi && volumeRatio >= 0.95;
  const cleanTrendShort = side === "SHORT" && lastClose < lastEma50 && lastEma50 <= lastEma200 * 1.002 && emaBear && emaSlopeDown && lastAdx.mdi > lastAdx.pdi && volumeRatio >= 0.95;
  if (side === "LONG" && !breakoutConfirmed && !cleanTrendLong) entryApproved = false;
  if (side === "SHORT" && !breakdownConfirmed && !cleanTrendShort) entryApproved = false;

  let score = rawScore;
  if (!entryApproved && rawScore >= 85) score = Math.min(rawScore, 78);
  if (!entryApproved && weakVolume) score = Math.min(score, 68);
  if (!entryApproved && veryWeakVolume) score = Math.min(score, 58);
  if (!entryApproved && marketRegime.allowEntry === false) score = Math.min(score, 62);

  if (score < 55) { side = "NONE"; reasons = ["Net yön yok, işlem için bekle"]; entryApproved = false; }
  const actionData = scoreToAction(side, score, entryApproved);

  const base = {
    action: actionData.action,
    side: actionData.side,
    score,
    rawScore,
    confidence: calculateConfidence({ score, entryApproved, volumeRatio, marketRegime, mtfOk: true, breakoutConfirmed, breakdownConfirmed, side }),
    entryApproved,
    entryBlocked: !entryApproved && side !== "NONE",
    filters,
    timeframe,
    marketRegime,
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
    bbWidthPercent: round(bbWidthPercent, 2),
    resistance: round(recentHigh, 4),
    support: round(recentLow, 4),
    breakoutDistance: round(breakoutDistance, 2),
    breakdownDistance: round(breakdownDistance, 2),
    breakoutConfirmed,
    breakdownConfirmed,
    reasons,
  };
  base.guide = buildGuide(base);
  return base;
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
  const midRejects = midOpp >= 62 && midOpp > midSame + 7;
  const highRejects = highOpp >= 58 && highOpp > highSame + 7;
  const midConfirms = midSame >= Number(process.env.MTF_MID_CONFIRM_SCORE || 58) && midSame >= midOpp;
  const highNotAgainst = !highRejects;
  const mtfOk = midConfirms && highNotAgainst && !midRejects;

  result.mtfSummary = { midSame, highSame, midOpp, highOpp, midConfirms, highNotAgainst, mtfOk };
  if (!midConfirms) result.mtfFilters.push(`15m aynı yön teyidi zayıf (${midSame}/${midOpp})`);
  if (midRejects) result.mtfFilters.push(`15m ters yön baskısı güçlü (${midOpp})`);
  if (highRejects) result.mtfFilters.push(`1h ters yön baskısı var (${highOpp})`);

  if (!mtfOk) {
    result.entryApproved = false;
    result.entryBlocked = true;
    result.score = Math.min(Number(result.score || 0), 70);
    result.confidence = calculateConfidence({ score: result.score, entryApproved: false, volumeRatio: result.volumeRatio, marketRegime: result.marketRegime, mtfOk: false, breakoutConfirmed: result.breakoutConfirmed, breakdownConfirmed: result.breakdownConfirmed, side });
    result.action = result.score >= 55 ? `WATCH_${side}` : "WAIT";
    result.filters = [...(result.filters || []), ...result.mtfFilters];
  } else if (result.entryApproved && result.score >= 85) {
    result.filters = [...(result.filters || []), "5m + 15m uyumlu, 1h ters baskı yok"];
  }
  result.guide = buildGuide(result);
  return result;
}

function analyzeMultiTimeframe({ candles5m, candles15m, candles1h }) {
  const primary = analyzeMarket(candles5m, { timeframe: "5m" });
  const mid = analyzeMarket(candles15m, { timeframe: "15m" });
  const high = analyzeMarket(candles1h, { timeframe: "1h" });
  return applyMultiTimeframeFilter(primary, mid, high);
}

module.exports = { analyzeMarket, analyzeMultiTimeframe };
