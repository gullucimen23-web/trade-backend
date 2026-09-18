const { analyzeMarket } = require("./strategy");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  return Number(num(value).toFixed(digits));
}

function priceFor(side, entry, percent) {
  return round(side === "LONG" ? entry * (1 + percent / 100) : entry * (1 - percent / 100));
}

function strongDirection(signal) {
  const price = num(signal?.lastClose);
  const ema9 = num(signal?.ema9);
  const ema21 = num(signal?.ema21);
  const ema50 = num(signal?.trendEma);
  const ema200 = num(signal?.ema200);
  const adx = num(signal?.adx);
  const minAdx = num(process.env.EDGE_MIN_1H_ADX, 20);
  if (adx < minAdx) return "NONE";
  if (price > ema50 && ema50 > ema200 && ema9 > ema21 && num(signal?.pdi) > num(signal?.mdi)) return "LONG";
  if (price < ema50 && ema50 < ema200 && ema9 < ema21 && num(signal?.mdi) > num(signal?.pdi)) return "SHORT";
  return "NONE";
}

function analyzeProfitEdgePlan({ candles5m, candles15m, candles1h, candles4h }) {
  const timing = analyzeMarket(candles5m, { timeframe: "5m" });
  const setup = analyzeMarket(candles15m, { timeframe: "15m" });
  const trend = analyzeMarket(candles1h, { timeframe: "1h" });
  const macro = analyzeMarket(candles4h, { timeframe: "4h" });
  const side = strongDirection(trend);
  const filters = [];
  const reasons = [];
  const price = num(timing.lastClose);
  const last15 = candles15m[candles15m.length - 1] || {};
  const previous15 = candles15m[candles15m.length - 2] || last15;
  const ema21 = num(setup.ema21, price);
  const distance15 = ema21 ? Math.abs((num(setup.lastClose) - ema21) / ema21) * 100 : 999;
  const maxPullbackDistance = num(process.env.EDGE_MAX_PULLBACK_DISTANCE_PERCENT, 0.65);
  const minVolume = num(process.env.EDGE_MIN_15M_VOLUME_RATIO, 0.80);
  const maxExtension = num(process.env.EDGE_MAX_EXTENSION_PERCENT, 1.20);
  const volumeOk = num(setup.volumeRatio) >= minVolume;

  const macroDirection = strongDirection(macro);
  const macroOpposes = macroDirection !== "NONE" && side !== "NONE" && macroDirection !== side && num(macro.adx) >= 25;
  if (side === "NONE") filters.push("1 saatlik net trend yok");
  if (macroOpposes) filters.push("4 saatlik güçlü trend ters yönde");

  const setupAligned = side === "LONG"
    ? num(setup.ema9) > num(setup.ema21) && num(setup.lastClose) > num(setup.trendEma)
    : side === "SHORT"
      ? num(setup.ema9) < num(setup.ema21) && num(setup.lastClose) < num(setup.trendEma)
      : false;

  const pullback = side === "LONG"
    ? num(last15.low) <= ema21 * 1.002 && num(last15.close) >= ema21 && num(last15.close) > num(last15.open) && num(last15.close) >= num(previous15.close)
    : side === "SHORT"
      ? num(last15.high) >= ema21 * 0.998 && num(last15.close) <= ema21 && num(last15.close) < num(last15.open) && num(last15.close) <= num(previous15.close)
      : false;

  const breakout = side === "LONG"
    ? Boolean(setup.breakoutConfirmed) && num(setup.volumeRatio) >= 1.20
    : side === "SHORT"
      ? Boolean(setup.breakdownConfirmed) && num(setup.volumeRatio) >= 1.20
      : false;

  const rsiOk = side === "LONG"
    ? num(setup.rsi) >= 45 && num(setup.rsi) <= 68
    : side === "SHORT"
      ? num(setup.rsi) >= 32 && num(setup.rsi) <= 55
      : false;

  const timingAligned = side === "LONG"
    ? num(timing.ema9) > num(timing.ema21) && num(timing.priceMomentum) >= 0 && num(timing.rsi) >= 48 && num(timing.rsi) <= 72
    : side === "SHORT"
      ? num(timing.ema9) < num(timing.ema21) && num(timing.priceMomentum) <= 0 && num(timing.rsi) >= 28 && num(timing.rsi) <= 52
      : false;

  const entryType = pullback ? "PULLBACK" : breakout ? "BREAKOUT" : "WAIT";
  if (!setupAligned) filters.push("15 dakikalık kurulum ana yönle uyumlu değil");
  if (!pullback && !breakout) filters.push("15 dakikada pullback dönüşü veya hacimli kırılım yok");
  if (!rsiOk) filters.push("15 dakika RSI giriş bölgesinde değil");
  if (!timingAligned) filters.push("5 dakikalık giriş tetiklenmedi");
  if (!volumeOk) filters.push(`15 dakika hacim x${round(setup.volumeRatio, 2)} < x${minVolume}`);
  if (distance15 > maxExtension && breakout) filters.push("kırılım EMA21'den fazla uzaklaşmış; hareket kovalanmadı");

  let score = 0;
  if (side !== "NONE") { score += 30; reasons.push(`1 saatlik ${side} trend`); }
  if (setupAligned) { score += 20; reasons.push("15 dakika ana yönle uyumlu"); }
  if (pullback) { score += 20; reasons.push("EMA21 bölgesinden onaylı dönüş"); }
  else if (breakout) { score += 18; reasons.push("Hacimli 15 dakika kırılımı"); }
  if (timingAligned) { score += 15; reasons.push("5 dakika giriş tetiği aynı yönde"); }
  if (volumeOk) { score += 10; reasons.push(`15 dakika hacim x${round(setup.volumeRatio, 2)}`); }
  if (macroDirection === side) { score += 5; reasons.push("4 saatlik yön destekliyor"); }
  score = clamp(Math.round(score), 0, 100);

  const stopPercent = clamp(num(process.env.EDGE_STOP_ATR_MULTIPLIER, 1.30) * num(setup.atrPercent, 0.4), 0.35, 1.20);
  const tp1Percent = stopPercent;
  const tp2Percent = stopPercent * 1.8;
  const tp3Percent = stopPercent * 3;
  const estimatedCostPercent = num(process.env.EDGE_ALL_IN_COST_PERCENT, 0.20);
  const costEdgeRatio = estimatedCostPercent > 0 ? tp1Percent / estimatedCostPercent : 99;
  const minCostMultiple = num(process.env.EDGE_MIN_COST_MULTIPLE, 3);
  if (costEdgeRatio < minCostMultiple) filters.push(`TP1 hareketi tahmini maliyetin ${round(costEdgeRatio, 2)} katı; en az ${minCostMultiple} gerekli`);

  const minScore = num(process.env.EDGE_MIN_SCORE, 78);
  if (score < minScore) filters.push(`Edge skoru ${score} < ${minScore}`);
  const entryApproved = side !== "NONE" && setupAligned && (pullback || breakout) && rsiOk && timingAligned && volumeOk && !macroOpposes && !(breakout && distance15 > maxExtension) && costEdgeRatio >= minCostMultiple && score >= minScore;

  const zonePercent = Math.min(0.12, stopPercent * 0.20);
  const entryLow = price * (1 - zonePercent / 100);
  const entryHigh = price * (1 + zonePercent / 100);
  const opposite = side === "LONG" ? "SHORT" : "LONG";
  const leverage = clamp(num(process.env.MEXC_LEVERAGE, 3), 1, 10);
  const referenceMargin = num(process.env.MEXC_SMALL_MARGIN_USDT, 10);

  return {
    ...timing,
    mode: "EDGE_V9_COST_AWARE",
    action: entryApproved ? `ENTRY_${side}` : "WAIT",
    side,
    score,
    rawScore: score,
    confidence: score,
    entryApproved,
    entryBlocked: !entryApproved,
    filters,
    reasons,
    marketRegime: {
      regime: side === "NONE" ? "NO_TREND" : "TREND",
      label: side === "NONE" ? "1 saat yön bekleniyor" : `1s ${side} / 15dk ${entryType}`,
      risk: macroOpposes ? "HIGH" : "MEDIUM",
      allowEntry: entryApproved,
    },
    entryType,
    volumeRatio: round(setup.volumeRatio, 2),
    adx: round(trend.adx, 2),
    rsi: round(setup.rsi, 2),
    atrPercent: round(setup.atrPercent, 3),
    move15mPercent: round(setup.priceMomentum, 3),
    ema21DistancePercent: round(distance15, 3),
    estimatedCostPercent: round(estimatedCostPercent, 3),
    costEdgeRatio: round(costEdgeRatio, 2),
    mtfSummary: {
      direction1h: side,
      direction4h: macroDirection,
      setup15m: setupAligned,
      timing5m: timingAligned,
      mtfOk: side !== "NONE" && setupAligned && !macroOpposes,
      note: "1s yön, 15dk kurulum, 5dk tetik",
    },
    entryStage: entryApproved ? "CONFIRMED" : "WAIT",
    entryStageLabel: entryApproved ? "🟢 MALİYET SONRASI FIRSAT" : "⏳ AVANTAJ BEKLENİYOR",
    entryTrigger: {
      requireEntryTrigger: true,
      triggerConfirmed: entryApproved,
      pullbackConfirmed: pullback,
      entryType,
      condition: entryApproved ? "1s trend + 15dk kurulum + 5dk tetik + maliyet eşiği" : filters.join(" | "),
      candle: "5m",
      minVolumeRatio: minVolume,
      entryZoneLow: round(entryLow),
      entryZoneHigh: round(entryHigh),
    },
    plan: {
      targetProfitUsdt: num(process.env.FINAL_TARGET_USDT, 1),
      accountBalanceUsdt: num(process.env.ACCOUNT_BALANCE_USDT, 100),
      leverage,
      entry: round(price),
      entryLow: round(entryLow),
      entryHigh: round(entryHigh),
      stopLossPrice: priceFor(opposite, price, stopPercent),
      stopLossPercent: round(stopPercent, 3),
      tp1Price: priceFor(side, price, tp1Percent),
      tp2Price: priceFor(side, price, tp2Percent),
      tp3Price: priceFor(side, price, tp3Percent),
      tp1Percent: round(tp1Percent, 3),
      tp2Percent: round(tp2Percent, 3),
      tp3Percent: round(tp3Percent, 3),
      tp1ClosePercent: 50,
      tp2ClosePercent: 30,
      tp3ClosePercent: 20,
      riskReward: 1.84,
      estimatedMarginUsdt: referenceMargin,
      estimatedRiskUsdt: round(referenceMargin * leverage * stopPercent / 100, 3),
      requiredNotionalUsdt: round(referenceMargin * leverage, 2),
      estimatedCostPercent: round(estimatedCostPercent, 3),
      costEdgeRatio: round(costEdgeRatio, 2),
      timeWindow: process.env.EDGE_TIME_WINDOW || "15-180 dk",
    },
    guide: {
      decision: entryApproved ? `🟢 MALİYET SONRASI İŞLEM (${side})` : "⏳ BEKLE",
      next: entryApproved
        ? [`${side} ${round(entryLow)} - ${round(entryHigh)}`, `Stop ${priceFor(opposite, price, stopPercent)}`, `TP1 ${priceFor(side, price, tp1Percent)}`]
        : filters.slice(0, 5),
    },
  };
}

module.exports = { analyzeProfitEdgePlan, strongDirection };
