function roundPrice(value) {
  return Number(Number(value).toFixed(4));
}

function calculatePnlPercent(trade, currentPrice) {
  const isLong = trade.side === "LONG";
  const rawPnl = isLong
    ? ((currentPrice - trade.entry) / trade.entry) * 100
    : ((trade.entry - currentPrice) / trade.entry) * 100;

  return Number((rawPnl * Number(trade.leverage || 1)).toFixed(2));
}

function calculatePnlMoney(trade, pnlPercent) {
  const amount = Number(trade.amount || trade.positionAmount || 0);
  if (!amount) return null;
  return Number(((amount * pnlPercent) / 100).toFixed(2));
}

function getScoresForTrade(trade, signal) {
  const sameSideScore = trade.side === "LONG"
    ? Number(signal.longScore || 0)
    : Number(signal.shortScore || 0);

  const oppositeScore = trade.side === "LONG"
    ? Number(signal.shortScore || 0)
    : Number(signal.longScore || 0);

  return { sameSideScore, oppositeScore };
}

function updateBestRun(trade, currentPrice, pnlPercent) {
  const isLong = trade.side === "LONG";
  const bestBefore = Number(trade.bestPrice || trade.entry);
  trade.bestPrice = isLong ? Math.max(bestBefore, currentPrice) : Math.min(bestBefore, currentPrice);
  trade.highestPnlPercent = Math.max(Number(trade.highestPnlPercent || 0), pnlPercent);

  const pullbackFromBest = Math.max(0, Number((Number(trade.highestPnlPercent || 0) - pnlPercent).toFixed(2)));
  trade.lastPnlPercent = pnlPercent;
  trade.lastPrice = Number(currentPrice);
  trade.lastCheckedAt = new Date().toISOString();
  return { pullbackFromBest };
}


function priceReached(side, currentPrice, targetPrice) {
  if (!targetPrice) return false;
  return side === "LONG" ? Number(currentPrice) >= Number(targetPrice) : Number(currentPrice) <= Number(targetPrice);
}

function stopReached(side, currentPrice, stopPrice) {
  if (!stopPrice) return false;
  return side === "LONG" ? Number(currentPrice) <= Number(stopPrice) : Number(currentPrice) >= Number(stopPrice);
}

function getPlanAdvice(trade, signal, currentPrice, pnlPercent) {
  const plan = trade.plan || {};
  if (!plan.stopLossPrice || !plan.tp1Price) return null;
  const { sameSideScore, oppositeScore } = getScoresForTrade(trade, signal);
  const { pullbackFromBest } = updateBestRun(trade, currentPrice, pnlPercent);
  const side = trade.side;

  if (stopReached(side, currentPrice, trade.stopMovedToEntry ? trade.entry : plan.stopLossPrice)) {
    return {
      status: "PLAN_STOP",
      urgency: "CRITICAL",
      icon: "❌",
      title: trade.stopMovedToEntry ? "GİRİŞ STOPU ÇALIŞTI" : "STOP ÇALIŞTI",
      reason: trade.stopMovedToEntry
        ? "TP1 sonrası risk sıfırlanmıştı. Fiyat girişe döndü, plan kapatılır."
        : "Plan stop seviyesine geldi. Zarar büyütülmez, işlem kapatılır.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: false,
    };
  }

  if (!trade.tp1Done && priceReached(side, currentPrice, plan.tp1Price)) {
    trade.tp1Done = true;
    trade.stopMovedToEntry = true;
    return {
      status: "TP1_HIT",
      urgency: "CRITICAL",
      icon: "🎯",
      title: "TP1 GERÇEKLEŞTİ",
      reason: "Pozisyonun %30'unu kapat. Stop'u giriş fiyatına çek. Bu aşamadan sonra ana risk sıfırlanır.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: false,
    };
  }

  if (trade.tp1Done && !trade.tp2Done && priceReached(side, currentPrice, plan.tp2Price)) {
    trade.tp2Done = true;
    return {
      status: "TP2_HIT",
      urgency: "CRITICAL",
      icon: "🎯",
      title: "TP2 GERÇEKLEŞTİ",
      reason: "Pozisyonun %40'ını kapat. Kalan kısmı TP3 veya trailing stop için taşı.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: false,
    };
  }

  if (trade.tp2Done && !trade.tp3Done && priceReached(side, currentPrice, plan.tp3Price)) {
    trade.tp3Done = true;
    return {
      status: "TP3_HIT",
      urgency: "CRITICAL",
      icon: "🏁",
      title: "TP3 GERÇEKLEŞTİ",
      reason: "Plan tamamlandı. Kalan pozisyon kapatılır.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: false,
    };
  }

  const nextTarget = !trade.tp1Done ? plan.tp1Price : !trade.tp2Done ? plan.tp2Price : plan.tp3Price;
  const nextLabel = !trade.tp1Done ? "TP1" : !trade.tp2Done ? "TP2" : "TP3";
  const oppositeTooStrong = oppositeScore >= Number(process.env.PLAN_INVALID_OPPOSITE_SCORE || 88) && oppositeScore > sameSideScore + 12;

  if (oppositeTooStrong) {
    return {
      status: "PLAN_INVALID",
      urgency: "HIGH",
      icon: "⚠️",
      title: "PLAN ZAYIFLADI",
      reason: "Ters yön güçlendi. Pozisyon açıksa risk azalt; yeni ekleme yapma.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: true,
      nextSide: side === "LONG" ? "SHORT" : "LONG",
    };
  }

  return {
    status: "PLAN_CONTINUE",
    urgency: "NORMAL",
    icon: "📊",
    title: "PLAN DEVAM EDİYOR",
    reason: `${nextLabel} hedefi bekleniyor. Stop: ${trade.stopMovedToEntry ? trade.entry : plan.stopLossPrice}.`,
    sameSideScore,
    oppositeScore,
    pullbackFromBest,
    reverseReady: false,
    nextTarget,
    nextLabel,
  };
}

function getTrendFlags(trade, signal) {
  const isLong = trade.side === "LONG";
  const emaBull = Number(signal.ema9 || 0) > Number(signal.ema21 || 0);
  const emaBear = Number(signal.ema9 || 0) < Number(signal.ema21 || 0);
  const macdSide = signal.macdSide || "NEUTRAL";
  const rsi = Number(signal.rsi || 50);
  const adx = Number(signal.adx || 0);

  const sameEma = isLong ? emaBull : emaBear;
  const oppositeEma = isLong ? emaBear : emaBull;
  const sameMacd = isLong ? macdSide === "BULL" : macdSide === "BEAR";
  const oppositeMacd = isLong ? macdSide === "BEAR" : macdSide === "BULL";
  const sameRsi = isLong ? rsi >= 48 : rsi <= 52;
  const dangerRsi = isLong ? rsi < 45 : rsi > 55;

  return { sameEma, oppositeEma, sameMacd, oppositeMacd, sameRsi, dangerRsi, adx };
}

function getPositionAdvice(trade, signal, currentPrice, pnlPercent) {
  const planAdvice = getPlanAdvice(trade, signal, currentPrice, pnlPercent);
  if (planAdvice) return planAdvice;

  const { sameSideScore, oppositeScore } = getScoresForTrade(trade, signal);
  const { pullbackFromBest } = updateBestRun(trade, currentPrice, pnlPercent);
  const flags = getTrendFlags(trade, signal);
  const highest = Number(trade.highestPnlPercent || pnlPercent || 0);
  const scoreGap = oppositeScore - sameSideScore;

  const hardReverse =
    oppositeScore >= Number(process.env.REVERSAL_EXIT_SCORE || 85) &&
    scoreGap >= Number(process.env.REVERSAL_GAP_EXIT || 12) &&
    (flags.oppositeEma || flags.oppositeMacd);

  const reverseWarning =
    oppositeScore >= Number(process.env.REVERSAL_WARN_SCORE || 75) &&
    scoreGap >= Number(process.env.REVERSAL_GAP_WARN || 6);

  const profitGivebackDanger =
    highest >= 1.2 && pullbackFromBest >= Number(process.env.PROFIT_GIVEBACK_EXIT || 0.9);

  const profitGivebackWarn =
    highest >= 0.7 && pullbackFromBest >= Number(process.env.PROFIT_GIVEBACK_WARN || 0.45);

  const momentumLost =
    sameSideScore < 55 ||
    (flags.oppositeEma && flags.oppositeMacd) ||
    (pnlPercent < -0.6 && oppositeScore > sameSideScore);

  if (hardReverse) {
    return {
      status: "EXIT_NOW",
      urgency: "CRITICAL",
      icon: "🚨",
      title: "ŞİMDİ ÇIK",
      reason: "Ters yön net güçlendi. Mevcut pozisyon avantajını kaybetti.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: true,
      nextSide: trade.side === "LONG" ? "SHORT" : "LONG",
    };
  }

  if (profitGivebackDanger) {
    return {
      status: "PROFIT_EXIT",
      urgency: "CRITICAL",
      icon: "🔴",
      title: "KÂRI KORU / ÇIK",
      reason: "Pozisyon güzel kâr vermiş ama kâr geri erimeye başladı. Kârı masada bırakma.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: oppositeScore >= 78,
      nextSide: trade.side === "LONG" ? "SHORT" : "LONG",
    };
  }

  if (reverseWarning) {
    return {
      status: "PREPARE_EXIT",
      urgency: "HIGH",
      icon: "🟠",
      title: "ÇIKIŞA HAZIRLAN",
      reason: "Ters yön güçleniyor. Pozisyon kârda ise koru, zarardaysa büyütme.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: oppositeScore >= 82,
      nextSide: trade.side === "LONG" ? "SHORT" : "LONG",
    };
  }

  if (profitGivebackWarn) {
    return {
      status: "PROTECT_PROFIT",
      urgency: "HIGH",
      icon: "🟡",
      title: "KÂRI KORU",
      reason: "İşlem kârdaydı, geri çekilme başladı. Pozisyonu yakından izle.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: false,
    };
  }

  if (momentumLost) {
    return {
      status: "DANGER",
      urgency: "HIGH",
      icon: "🔴",
      title: "ZARAR RİSKİ ARTTI",
      reason: "Pozisyon yönündeki momentum zayıfladı. Yeni ekleme yapma, çıkış için hazır ol.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: oppositeScore >= 75,
      nextSide: trade.side === "LONG" ? "SHORT" : "LONG",
    };
  }

  if (pnlPercent >= 2.0 && sameSideScore >= oppositeScore) {
    return {
      status: "RUN_WINNER",
      urgency: "NORMAL",
      icon: "🟢",
      title: "DEVAM / KAZANANI TAŞI",
      reason: "Pozisyon iyi kârda ve yön hâlâ korunuyor. Ters sinyal gelene kadar acele çıkma.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: false,
    };
  }

  if (pnlPercent >= 0.5) {
    return {
      status: "CONTINUE_PROFIT",
      urgency: "NORMAL",
      icon: "🟢",
      title: "DEVAM ET",
      reason: "Pozisyon doğru yönde. Ters sinyal henüz onaylanmadı.",
      sameSideScore,
      oppositeScore,
      pullbackFromBest,
      reverseReady: false,
    };
  }

  return {
    status: "CONTINUE_WATCH",
    urgency: "NORMAL",
    icon: "👀",
    title: "BEKLE / İZLE",
    reason: "Pozisyon açık ama net çıkış sinyali yok. Yön bozulursa uyarı gelecek.",
    sameSideScore,
    oppositeScore,
    pullbackFromBest,
    reverseReady: false,
  };
}

function formatMoney(value) {
  if (value === null || value === undefined) return "-";
  return `${value > 0 ? "+" : ""}${value} USDT`;
}

function formatTradeReport(trade, signal, currentPrice, advice, pnlPercent) {
  const pnlMoney = calculatePnlMoney(trade, pnlPercent);
  const amountText = Number(trade.amount || 0) > 0 ? `\nPozisyon: <b>${trade.amount} USDT</b>` : "";
  const reverseText = advice.reverseReady
    ? `\n🔁 <b>Ters yön:</b> ${advice.nextSide || (trade.side === "LONG" ? "SHORT" : "LONG")} güçleniyor. Çıkmadan ters işleme atlama; yeni onayı bekle.`
    : "";
  const plan = trade.plan || {};
  const planText = plan.tp1Price ? `\nPlan: TP1 <b>${plan.tp1Price}</b> | TP2 <b>${plan.tp2Price}</b> | TP3 <b>${plan.tp3Price}</b> | Stop <b>${trade.stopMovedToEntry ? trade.entry : plan.stopLossPrice}</b>\nDurum: TP1 ${trade.tp1Done ? "✅" : "⏳"} | TP2 ${trade.tp2Done ? "✅" : "⏳"} | TP3 ${trade.tp3Done ? "✅" : "⏳"}` : "";

  return `
📊 <b>${trade.symbol} ${trade.side} CANLI POZİSYON</b>${amountText}

Giriş: <b>${trade.entry}</b>
Şu An: <b>${currentPrice}</b>
Kaldıraç: <b>${trade.leverage}x</b>
PnL: <b>%${pnlPercent}</b>
Tahmini K/Z: <b>${formatMoney(pnlMoney)}</b>
En iyi PnL: <b>%${Number(trade.highestPnlPercent || 0).toFixed(2)}</b>
Geri verme: <b>%${Number(advice.pullbackFromBest || 0).toFixed(2)}</b>

Pozisyon Gücü: <b>${advice.sameSideScore}/100</b>
Ters Güç: <b>${advice.oppositeScore}/100</b>
RSI: <b>${signal.rsi}</b> | ADX: <b>${signal.adx}</b>
EMA: <b>${signal.ema9}</b> / <b>${signal.ema21}</b>${planText}

${advice.icon} <b>${advice.title}</b>
${advice.reason}${reverseText}
`;
}

module.exports = {
  calculatePnlPercent,
  calculatePnlMoney,
  updateBestRun,
  getPositionAdvice,
  formatTradeReport,
};
