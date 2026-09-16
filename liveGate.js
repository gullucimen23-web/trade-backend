function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function evaluateLiveCandidate(symbol, signal, tradePlan, marketMeta = {}) {
  const reasons = [];
  const side = signal?.side;
  const score = num(signal?.score);
  const confidence = num(signal?.confidence);
  const volume = num(signal?.volumeRatio);
  const adx = num(signal?.adx);
  const atr = num(signal?.atrPercent);
  const rsi = num(signal?.rsi, 50);
  const move15m = Math.abs(num(signal?.move15mPercent));
  const emaDistance = Math.abs(num(signal?.ema21DistancePercent));
  const rr = num(tradePlan?.riskReward);
  const mtf = signal?.mtfSummary || {};
  const same1h = num(mtf.same1h);
  const opp1h = num(mtf.opp1h);
  const same4h = num(mtf.same4h);
  const opp4h = num(mtf.opp4h);

  if (!signal?.entryApproved || signal?.entryBlocked || !["LONG", "SHORT"].includes(side)) reasons.push("strateji onayı yok");
  if (score < num(process.env.MEXC_AUTO_MIN_SCORE, 90)) reasons.push("skor düşük");
  if (confidence < num(process.env.LIVE_MIN_CONFIDENCE, 85)) reasons.push("güven düşük");
  if (volume < num(process.env.LIVE_MIN_VOLUME_RATIO, 1.05)) reasons.push("hacim zayıf");
  if (volume > num(process.env.LIVE_MAX_VOLUME_RATIO, 4)) reasons.push("hacim patlaması geç giriş riski");
  if (adx < num(process.env.LIVE_MIN_ADX, 20)) reasons.push("trend gücü zayıf");
  if (atr < num(process.env.LIVE_MIN_ATR_PERCENT, 0.12) || atr > num(process.env.LIVE_MAX_ATR_PERCENT, 1.5)) reasons.push("oynaklık güvenli aralık dışında");
  if (move15m > num(process.env.LIVE_MAX_15M_MOVE_PERCENT, 2)) reasons.push("15 dakikalık hareket kovalanmayacak kadar uzamış");
  if (emaDistance > num(process.env.LIVE_MAX_EMA21_DISTANCE_PERCENT, 1.2)) reasons.push("EMA21'den fazla uzaklaşmış");
  if (side === "LONG" && (rsi < num(process.env.LIVE_LONG_RSI_MIN, 52) || rsi > num(process.env.LIVE_LONG_RSI_MAX, 68))) reasons.push("long RSI aralığı uygun değil");
  if (side === "SHORT" && (rsi < num(process.env.LIVE_SHORT_RSI_MIN, 32) || rsi > num(process.env.LIVE_SHORT_RSI_MAX, 48))) reasons.push("short RSI aralığı uygun değil");
  if ((opp1h > same1h + 8) || (opp4h > same4h + 12)) reasons.push("üst zaman yönü ters");
  if (rr < num(process.env.LIVE_MIN_RISK_REWARD, 1.5)) reasons.push("risk/ödül düşük");

  const liquidityBoost = Math.min(10, Math.log10(Math.max(1, num(marketMeta.turnover))) * 1.4);
  const selectionScore = Number((score * 0.45 + confidence * 0.25 + Math.min(100, adx * 2) * 0.15 + Math.min(100, volume * 25) * 0.10 + liquidityBoost - move15m * 4 - emaDistance * 3).toFixed(2));
  return { symbol, allowed: reasons.length === 0, reasons, selectionScore };
}

module.exports = { evaluateLiveCandidate };
