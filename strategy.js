const { RSI, EMA, MACD, ADX, ATR, BollingerBands } = require("technicalindicators");

function safeLast(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
function pct(a, b) { if (!b) return 0; return ((a - b) / b) * 100; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function round(n, d = 2) { return Number(Number(n || 0).toFixed(d)); }

function scoreToAction(side, score, entryApproved) {
  // Kullanıcı tarafında sadece net aksiyonlar görünsün:
  // WAIT -> RADAR -> READY -> ENTRY
  if (!side || side === "NONE" || score < 55) return { action: "WAIT", side: "NONE" };
  if (!entryApproved) {
    if (score >= 75) return { action: `READY_${side}`, side };
    if (score >= 55) return { action: `RADAR_${side}`, side };
    return { action: "WAIT", side: "NONE" };
  }
  return { action: `ENTRY_${side}`, side };
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
  if (signal.entryApproved) decision = `🟢 AKSİYON: İŞLEM AÇ (${direction})`;
  else if (signal.entryBlocked) decision = `🟡 AKSİYON: HAZIR OL / BEKLE (${direction})`;

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
    priceMomentum: round(priceMomentum, 3),
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

function planPrice(side, entry, percent) {
  return round(side === "LONG" ? entry * (1 + percent / 100) : entry * (1 - percent / 100), 4);
}

function analyzeSwingPlan({ candles15m, candles1h, candles4h }) {
  const entrySignal = analyzeMarket(candles15m, { timeframe: "15m" });
  const trend1h = analyzeMarket(candles1h, { timeframe: "1h" });
  const trend4h = analyzeMarket(candles4h, { timeframe: "4h" });

  let side = entrySignal.side;
  const filters = [...(entrySignal.filters || [])];
  if (!side || side === "NONE") filters.push("15m net yön üretmedi");

  const same1h = sameDirectionScore(trend1h, side);
  const opp1h = oppositeDirectionScore(trend1h, side);
  const same4h = sameDirectionScore(trend4h, side);
  const opp4h = oppositeDirectionScore(trend4h, side);

  const minScore = Number(process.env.SWING_MIN_SCORE || 90);
  const minConfidence = Number(process.env.SWING_MIN_CONFIDENCE || 75);
  const minVolume = Number(process.env.SWING_MIN_VOLUME_RATIO || 0.90);
  const minRR = Number(process.env.SWING_MIN_RR || 2);
  const requireEntryTrigger = process.env.REQUIRE_ENTRY_TRIGGER !== "false";
  const targetProfitUsdt = Number(process.env.TARGET_PROFIT_USDT || 5);
  const defaultBalance = Number(process.env.ACCOUNT_BALANCE_USDT || 100);
  const leverage = Number(process.env.SWING_LEVERAGE || process.env.DEFAULT_LEVERAGE || 5);

  const mtfOk = side !== "NONE" && same1h >= 58 && same1h >= opp1h && same4h >= 52 && opp4h <= same4h + 8;
  if (!mtfOk) filters.push(`1h/4h yön onayı yetersiz: 1h ${same1h}/${opp1h}, 4h ${same4h}/${opp4h}`);

  const volumeOk = Number(entrySignal.volumeRatio || 0) >= minVolume;
  if (!volumeOk) filters.push(`Hacim x${entrySignal.volumeRatio} < x${minVolume} — işlem yok`);

  const adxOk = Number(entrySignal.adx || 0) >= Number(process.env.SWING_MIN_ADX || 20) || Number(trend1h.adx || 0) >= Number(process.env.SWING_MIN_ADX || 20);
  if (!adxOk) filters.push("Trend gücü zayıf — işlem yok");

  const triggerPrice = side === "LONG" ? Number(entrySignal.resistance || entrySignal.lastClose) : Number(entrySignal.support || entrySignal.lastClose);
  const triggerConfirmed = side === "LONG" ? Boolean(entrySignal.breakoutConfirmed) : Boolean(entrySignal.breakdownConfirmed);

  // v2: Sadece kırılım bekleyen sistem fırsat kaçırıyordu.
  // Bu yüzden ikinci giriş tipi eklendi: PULLBACK / destekten-dirençten dönüş.
  // Breakout = daha geç ama daha temiz. Pullback = daha erken, stop daha yakın.
  const enablePullbackEntry = process.env.ENABLE_PULLBACK_ENTRY !== "false";
  const ema21 = Number(entrySignal.ema21 || entrySignal.lastClose);
  const ema9 = Number(entrySignal.ema9 || entrySignal.lastClose);
  const price = Number(entrySignal.lastClose || 0);
  const rsi = Number(entrySignal.rsi || 50);
  const momentum = Number(entrySignal.priceMomentum || 0);
  const nearEma21Pct = price && ema21 ? Math.abs((price - ema21) / price) * 100 : 99;
  const nearLevelPct = side === "LONG"
    ? (price && entrySignal.support ? Math.abs((price - Number(entrySignal.support)) / price) * 100 : 99)
    : (price && entrySignal.resistance ? Math.abs((Number(entrySignal.resistance) - price) / price) * 100 : 99);
  const pullbackMaxDistance = Number(process.env.PULLBACK_MAX_DISTANCE_PERCENT || 0.85);
  const pullbackMinVolume = Number(process.env.PULLBACK_MIN_VOLUME_RATIO || Math.min(minVolume, 0.75));
  const pullbackLong = side === "LONG"
    && enablePullbackEntry
    && Number(entrySignal.volumeRatio || 0) >= pullbackMinVolume
    && ema9 >= ema21
    && price >= ema21 * 0.998
    && (nearEma21Pct <= pullbackMaxDistance || nearLevelPct <= pullbackMaxDistance)
    && rsi >= 38 && rsi <= 62
    && momentum >= -0.18;
  const pullbackShort = side === "SHORT"
    && enablePullbackEntry
    && Number(entrySignal.volumeRatio || 0) >= pullbackMinVolume
    && ema9 <= ema21
    && price <= ema21 * 1.002
    && (nearEma21Pct <= pullbackMaxDistance || nearLevelPct <= pullbackMaxDistance)
    && rsi >= 38 && rsi <= 62
    && momentum <= 0.18;
  const pullbackConfirmed = side === "LONG" ? pullbackLong : side === "SHORT" ? pullbackShort : false;
  const entryType = triggerConfirmed ? "BREAKOUT" : pullbackConfirmed ? "PULLBACK" : "WAIT_TRIGGER";
  const triggerOk = !requireEntryTrigger || triggerConfirmed || pullbackConfirmed;

  const breakoutCondition = side === "LONG"
    ? `Breakout: 15m mum ${round(triggerPrice, 4)} üstünde kapanmalı + hacim x${minVolume}+ olmalı`
    : `Breakout: 15m mum ${round(triggerPrice, 4)} altında kapanmalı + hacim x${minVolume}+ olmalı`;
  const pullbackCondition = side === "LONG"
    ? `Pullback: fiyat EMA21/destek bölgesinden yukarı dönmeli + hacim x${pullbackMinVolume}+ korunmalı`
    : `Pullback: fiyat EMA21/direnç bölgesinden aşağı dönmeli + hacim x${pullbackMinVolume}+ korunmalı`;
  const triggerCondition = enablePullbackEntry
    ? `${breakoutCondition} VEYA ${pullbackCondition}`
    : breakoutCondition;
  if (!triggerOk && side !== "NONE") filters.push(`Giriş tetikleyicisi bekleniyor: ${triggerCondition}`);

  const entry = Number(entrySignal.lastClose);
  const atrPct = Math.max(Number(entrySignal.atrPercent || 0.35), 0.35);
  const stopPct = clamp(atrPct * Number(process.env.SWING_STOP_ATR_MULT || 1.25), 0.45, 1.35);
  const tp1Pct = stopPct * 1.15;
  const tp2Pct = stopPct * 2.05;
  const tp3Pct = stopPct * 3.0;
  const weightedTpPct = (tp1Pct * 0.30) + (tp2Pct * 0.40) + (tp3Pct * 0.30);
  const riskReward = weightedTpPct / stopPct;
  if (riskReward < minRR) filters.push(`Risk/ödül 1:${round(riskReward, 2)} < 1:${minRR} — işlem yok`);

  let score = Math.round(
    (Number(entrySignal.score || 0) * 0.45) +
    (same1h * 0.30) +
    (same4h * 0.25)
  );
  if (!mtfOk) score = Math.min(score, 72);
  if (!volumeOk) score = Math.min(score, 68);
  if (!adxOk) score = Math.min(score, 70);
  score = clamp(score, 0, 100);

  let confidence = calculateConfidence({
    score,
    entryApproved: true,
    volumeRatio: entrySignal.volumeRatio,
    marketRegime: entrySignal.marketRegime,
    mtfOk,
    breakoutConfirmed: entrySignal.breakoutConfirmed,
    breakdownConfirmed: entrySignal.breakdownConfirmed,
    side,
  });
  if (!mtfOk) confidence = Math.min(confidence, 65);
  if (!volumeOk) confidence = Math.min(confidence, 60);

  if (!triggerOk) confidence = Math.min(confidence, 72);

  const planOk = side !== "NONE" && score >= minScore && confidence >= minConfidence && volumeOk && mtfOk && riskReward >= minRR && triggerOk;

  // v3: Kademeli giriş sistemi. Artık sadece "tam onay" yok.
  // EARLY = erken aday, PREPARE = hazırlık, CONFIRMED = giriş onayı.
  const earlyScore = Number(process.env.EARLY_ENTRY_SCORE || 60);
  const prepareScore = Number(process.env.PREPARE_ENTRY_SCORE || 75);
  const earlyMinVolume = Number(process.env.EARLY_MIN_VOLUME_RATIO || 0.55);
  const entryStage = planOk
    ? "CONFIRMED"
    : (side !== "NONE" && score >= prepareScore && Number(entrySignal.volumeRatio || 0) >= earlyMinVolume)
      ? "PREPARE"
      : (side !== "NONE" && score >= earlyScore && Number(entrySignal.volumeRatio || 0) >= earlyMinVolume)
        ? "EARLY"
        : "WAIT";
  const entryStageLabel = entryStage === "CONFIRMED"
    ? "🟢 AKSİYON: İŞLEM AÇ"
    : entryStage === "PREPARE"
      ? "🟡 AKSİYON: HAZIR OL"
      : entryStage === "EARLY"
        ? "👀 AKSİYON: RADAR"
        : "⏳ AKSİYON: BEKLE";

  if (score < minScore) filters.push(`Skor ${score} < ${minScore} — onaylı giriş yok`);
  if (confidence < minConfidence) filters.push(`Güven ${confidence}% < ${minConfidence}% — işlem yok`);

  // Tek fiyat yerine giriş bölgesi: kullanıcıya daha uygulanabilir plan verir.
  // CONFIRMED olduğunda bölge dar, erken/hazırlıkta bilgi amaçlıdır.
  const entryZoneWidthPct = entryType === "PULLBACK" ? Number(process.env.PULLBACK_ENTRY_ZONE_PERCENT || 0.22) : Number(process.env.BREAKOUT_ENTRY_ZONE_PERCENT || 0.14);
  const entryLow = round(entry * (1 - entryZoneWidthPct / 100), 4);
  const entryHigh = round(entry * (1 + entryZoneWidthPct / 100), 4);
  const stopLossPrice = planPrice(side === "LONG" ? "SHORT" : "LONG", entry, stopPct);
  const tp1Price = planPrice(side, entry, tp1Pct);
  const tp2Price = planPrice(side, entry, tp2Pct);
  const tp3Price = planPrice(side, entry, tp3Pct);

  const requiredNotional = targetProfitUsdt / (weightedTpPct / 100);
  const estimatedMargin = requiredNotional / leverage;
  const estimatedRiskUsdt = requiredNotional * (stopPct / 100);

  return {
    ...entrySignal,
    mode: "SWING_PLAN",
    action: planOk ? `ENTRY_${side}` : (entryStage === "PREPARE" ? `READY_${side}` : entryStage === "EARLY" ? `RADAR_${side}` : "WAIT"),
    side: planOk ? side : (side || "NONE"),
    score,
    confidence,
    entryApproved: planOk,
    entryBlocked: !planOk,
    filters,
    reasons: [
      `Giriş tipi: ${entryType}`,
      `15m giriş yönü: ${side}`,
      `1h teyit: aynı ${same1h} / ters ${opp1h}`,
      `4h teyit: aynı ${same4h} / ters ${opp4h}`,
      ...(entrySignal.reasons || []).slice(0, 4),
    ],
    mtfSummary: { same1h, opp1h, same4h, opp4h, mtfOk },
    entryStage,
    entryStageLabel,
    entryTrigger: {
      requireEntryTrigger,
      triggerPrice: round(triggerPrice, 4),
      triggerConfirmed,
      pullbackConfirmed,
      entryType,
      condition: triggerCondition,
      candle: "15m",
      minVolumeRatio: minVolume,
      waitMessage: entryStageLabel,
      entryZoneLow: entryLow,
      entryZoneHigh: entryHigh,
    },
    plan: {
      targetProfitUsdt: round(targetProfitUsdt, 2),
      accountBalanceUsdt: round(defaultBalance, 2),
      leverage,
      entry: round(entry, 4),
      entryLow,
      entryHigh,
      stopLossPrice,
      stopLossPercent: round(stopPct, 2),
      tp1Price,
      tp2Price,
      tp3Price,
      tp1Percent: round(tp1Pct, 2),
      tp2Percent: round(tp2Pct, 2),
      tp3Percent: round(tp3Pct, 2),
      tp1ClosePercent: 30,
      tp2ClosePercent: 40,
      tp3ClosePercent: 30,
      riskReward: round(riskReward, 2),
      estimatedMarginUsdt: round(estimatedMargin, 2),
      estimatedRiskUsdt: round(estimatedRiskUsdt, 2),
      requiredNotionalUsdt: round(requiredNotional, 2),
      timeWindow: process.env.SWING_TIME_WINDOW || "2 saat - 2 gün",
    },
    guide: {
      decision: planOk ? `🟢 AKSİYON: İŞLEM AÇ — ${entryType}` : entryStageLabel,
      next: planOk
        ? [
          `${side} için ${entryLow} - ${entryHigh} giriş bölgesi`,
          `Stop: ${stopLossPrice}`,
          `TP1 ${tp1Price}, TP2 ${tp2Price}, TP3 ${tp3Price}`,
        ]
        : filters.slice(0, 4),
    },
  };
}

module.exports = { analyzeMarket, analyzeMultiTimeframe, analyzeSwingPlan };
