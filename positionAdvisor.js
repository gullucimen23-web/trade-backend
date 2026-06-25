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

function getScoresForTrade(trade, signal) {
  const sameSideScore = trade.side === "LONG"
    ? Number(signal.longScore || 0)
    : Number(signal.shortScore || 0);

  const oppositeScore = trade.side === "LONG"
    ? Number(signal.shortScore || 0)
    : Number(signal.longScore || 0);

  return { sameSideScore, oppositeScore };
}

function improveTrackedRisk(trade, currentPrice, pnlPercent) {
  const isLong = trade.side === "LONG";
  const oldSl = Number(trade.activeStopLossPrice || trade.stopLossPrice);
  let newSl = oldSl;
  let message = null;

  const bestBefore = Number(trade.bestPrice || trade.entry);
  trade.bestPrice = isLong ? Math.max(bestBefore, currentPrice) : Math.min(bestBefore, currentPrice);
  trade.highestPnlPercent = Math.max(Number(trade.highestPnlPercent || 0), pnlPercent);

  const setStopByProfit = (lockedProfitPercent, level, label) => {
    const priceMove = lockedProfitPercent / Number(trade.leverage || 1) / 100;
    const targetSl = isLong
      ? trade.entry * (1 + priceMove)
      : trade.entry * (1 - priceMove);

    const better = isLong ? targetSl > newSl : targetSl < newSl;
    if (better) {
      newSl = roundPrice(targetSl);
      trade.riskLevel = level;
      message = label;
    }
  };

  if (pnlPercent >= 0.6) setStopByProfit(0, "BREAK_EVEN", "SL giriş fiyatına çek. Zarar riski sıfıra yaklaşsın.");
  if (pnlPercent >= 1.2) setStopByProfit(0.35, "LOCK_035", "Kârı koru. SL yaklaşık +%0.35 kâr bölgesine taşınabilir.");
  if (pnlPercent >= 2.0) setStopByProfit(0.8, "LOCK_080", "Kâr koruma güçlendi. SL yaklaşık +%0.80 kâr bölgesine taşınabilir.");
  if (pnlPercent >= 3.0) setStopByProfit(1.4, "TRAILING", "Trailing mantık aktif. Kârı bırakma, stopu fiyatla beraber taşı.");

  if (newSl !== oldSl) {
    trade.activeStopLossPrice = newSl;
    trade.stopLossPrice = newSl;
    trade.lastRiskMoveAt = new Date().toISOString();
    trade.notes = Array.isArray(trade.notes) ? trade.notes : [];
    trade.notes.push({ at: trade.lastRiskMoveAt, oldSl, newSl, pnlPercent, message });
    return { changed: true, oldSl, newSl, message };
  }

  return { changed: false, oldSl, newSl, message: null };
}

function distanceToPricePercent(currentPrice, targetPrice) {
  return Number(((Math.abs(targetPrice - currentPrice) / currentPrice) * 100).toFixed(2));
}

function getPositionAdvice(trade, signal, currentPrice, pnlPercent) {
  const { sameSideScore, oppositeScore } = getScoresForTrade(trade, signal);
  const isLong = trade.side === "LONG";
  const activeStop = Number(trade.activeStopLossPrice || trade.stopLossPrice);
  const tp1 = Number(trade.tp1Price || trade.takeProfitPrice);
  const tp2 = Number(trade.tp2Price || trade.takeProfitPrice);
  const tp3 = Number(trade.tp3Price || trade.takeProfitPrice);

  const hitTp1 = isLong ? currentPrice >= tp1 : currentPrice <= tp1;
  const hitTp2 = isLong ? currentPrice >= tp2 : currentPrice <= tp2;
  const hitTp3 = isLong ? currentPrice >= tp3 : currentPrice <= tp3;
  const hitSl = isLong ? currentPrice <= activeStop : currentPrice >= activeStop;

  if (hitSl) {
    return {
      status: "EXIT_NOW",
      icon: "🔴",
      title: "ŞİMDİ ÇIK / SL ÇALIŞTI",
      reason: "Fiyat aktif stop seviyesine geldi. Zararı büyütme.",
      sameSideScore,
      oppositeScore,
      hitSl,
      hitTp1,
      hitTp2,
      hitTp3,
      reverseReady: oppositeScore >= 85,
    };
  }

  if (oppositeScore >= 85 && oppositeScore >= sameSideScore + 12) {
    return {
      status: "EXIT_AND_REVERSE_WATCH",
      icon: "🔴",
      title: "ÇIK / TERS YÖNE HAZIRLAN",
      reason: "Ters sinyal çok güçlendi. Mevcut pozisyon zayıflıyor.",
      sameSideScore,
      oppositeScore,
      hitSl,
      hitTp1,
      hitTp2,
      hitTp3,
      reverseReady: true,
    };
  }

  if (oppositeScore >= 75 && oppositeScore > sameSideScore) {
    return {
      status: "RISK_UP",
      icon: "🟠",
      title: "RİSK ARTTI",
      reason: "Ters yön güçleniyor. Pozisyonu küçült veya çıkışa hazırlan.",
      sameSideScore,
      oppositeScore,
      hitSl,
      hitTp1,
      hitTp2,
      hitTp3,
      reverseReady: oppositeScore >= 82,
    };
  }

  if (hitTp3 || pnlPercent >= 3.0) {
    return {
      status: "TAKE_PROFIT_STRONG",
      icon: "🟢",
      title: "KÂRI AL / TRAILING DEVAM",
      reason: "Güçlü kâr bölgesi geldi. Kârı koru, ters sinyalde çık.",
      sameSideScore,
      oppositeScore,
      hitSl,
      hitTp1,
      hitTp2,
      hitTp3,
      reverseReady: false,
    };
  }

  if (hitTp2 || pnlPercent >= 1.5) {
    return {
      status: "PROTECT_PROFIT",
      icon: "🟡",
      title: "KÂRI KORU",
      reason: "İşlem kârda. SL kâra çekilip devam edilebilir.",
      sameSideScore,
      oppositeScore,
      hitSl,
      hitTp1,
      hitTp2,
      hitTp3,
      reverseReady: false,
    };
  }

  if (hitTp1 || pnlPercent >= 0.6) {
    return {
      status: "CONTINUE_BREAK_EVEN",
      icon: "🟢",
      title: "DEVAM ET / SL GİRİŞE",
      reason: "İşlem doğru yönde ilerliyor. Stopu girişe çekerek riski azalt.",
      sameSideScore,
      oppositeScore,
      hitSl,
      hitTp1,
      hitTp2,
      hitTp3,
      reverseReady: false,
    };
  }

  if (pnlPercent <= -0.5 || sameSideScore < 55) {
    return {
      status: "DANGER",
      icon: "🔴",
      title: "ZARAR RİSKİ VAR",
      reason: "Pozisyon yönü yeterince güçlü değil. SL'ye sadık kal, ekleme yapma.",
      sameSideScore,
      oppositeScore,
      hitSl,
      hitTp1,
      hitTp2,
      hitTp3,
      reverseReady: oppositeScore >= 75,
    };
  }

  return {
    status: "CONTINUE",
    icon: "🟢",
    title: "DEVAM ET",
    reason: "Pozisyon yönü hâlâ korunuyor. Plan dışına çıkma.",
    sameSideScore,
    oppositeScore,
    hitSl,
    hitTp1,
    hitTp2,
    hitTp3,
    reverseReady: false,
  };
}

function formatTradeReport(trade, signal, currentPrice, advice, pnlPercent) {
  const activeStop = Number(trade.activeStopLossPrice || trade.stopLossPrice);
  const tp1 = Number(trade.tp1Price || trade.takeProfitPrice);
  const tp2 = Number(trade.tp2Price || trade.takeProfitPrice);
  const tp3 = Number(trade.tp3Price || trade.takeProfitPrice);

  const reverseText = advice.reverseReady
    ? `\n🔁 <b>Ters yön:</b> ${trade.side === "LONG" ? "SHORT" : "LONG"} hazırlığı var. Direkt atlama, yeni sinyal bekle.`
    : "";

  return `
📊 <b>${trade.symbol} ${trade.side} CANLI TAKİP</b>

Giriş: <b>${trade.entry}</b>
Şu An: <b>${currentPrice}</b>
Kaldıraç: <b>${trade.leverage}x</b>
PnL: <b>%${pnlPercent}</b>

🎯 TP1: <b>${tp1}</b> — Uzaklık: <b>%${distanceToPricePercent(currentPrice, tp1)}</b>
🎯 TP2: <b>${tp2}</b> — Uzaklık: <b>%${distanceToPricePercent(currentPrice, tp2)}</b>
🎯 TP3: <b>${tp3}</b> — Uzaklık: <b>%${distanceToPricePercent(currentPrice, tp3)}</b>
🛑 Aktif SL: <b>${activeStop}</b> — Uzaklık: <b>%${distanceToPricePercent(currentPrice, activeStop)}</b>

Pozisyon Gücü: <b>${advice.sameSideScore}/100</b>
Ters Güç: <b>${advice.oppositeScore}/100</b>
RSI: <b>${signal.rsi}</b> | ADX: <b>${signal.adx}</b>

${advice.icon} <b>${advice.title}</b>
${advice.reason}${reverseText}
`;
}

module.exports = {
  calculatePnlPercent,
  improveTrackedRisk,
  getPositionAdvice,
  formatTradeReport,
  distanceToPricePercent,
};
