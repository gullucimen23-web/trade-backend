function calculatePnlPercent(trade, currentPrice) {
  const isLong = trade.side === "LONG";
  const rawPnl = isLong
    ? ((currentPrice - trade.entry) / trade.entry) * 100
    : ((trade.entry - currentPrice) / trade.entry) * 100;

  return Number((rawPnl * Number(trade.leverage || 1)).toFixed(2));
}

function priceFromPercent(entry, side, percent) {
  const isLong = side === "LONG";
  const price = isLong
    ? entry * (1 + percent / 100)
    : entry * (1 - percent / 100);
  return Number(price.toFixed(4));
}

function isBetterStop(side, nextStop, currentStop) {
  if (!currentStop) return true;
  return side === "LONG" ? nextStop > currentStop : nextStop < currentStop;
}

function applyRiskReduction(trade, currentPrice) {
  const pnlPercent = calculatePnlPercent(trade, currentPrice);
  const oldStop = Number(trade.stopLossPrice);
  const entry = Number(trade.entry);
  const side = trade.side;
  const updates = [];

  if (pnlPercent >= 0.6 && !trade.breakEvenActivated) {
    const nextStop = Number(entry.toFixed(4));
    if (isBetterStop(side, nextStop, oldStop)) {
      trade.stopLossPrice = nextStop;
      trade.breakEvenActivated = true;
      updates.push({
        type: "BREAK_EVEN",
        oldStop,
        newStop: nextStop,
        pnlPercent,
        message: "Risk azaltıldı: SL giriş fiyatına çekildi.",
      });
    }
  }

  const trailingRules = [
    { minPnl: 1.2, lockPercent: 0.35 },
    { minPnl: 2.0, lockPercent: 0.8 },
    { minPnl: 3.0, lockPercent: 1.4 },
    { minPnl: 4.5, lockPercent: 2.2 },
  ];

  for (const rule of trailingRules) {
    if (pnlPercent < rule.minPnl) continue;
    if (Number(trade.lockedProfitPercent || 0) >= rule.lockPercent) continue;

    const nextStop = priceFromPercent(entry, side, rule.lockPercent / Number(trade.leverage || 1));

    if (isBetterStop(side, nextStop, Number(trade.stopLossPrice))) {
      const before = Number(trade.stopLossPrice);
      trade.stopLossPrice = nextStop;
      trade.lockedProfitPercent = rule.lockPercent;
      updates.push({
        type: "TRAILING_STOP",
        oldStop: before,
        newStop: nextStop,
        pnlPercent,
        lockedProfitPercent: rule.lockPercent,
        message: `Risk azaltıldı: SL kâr korumaya çekildi. Kilitlenen yaklaşık PnL: %${rule.lockPercent}`,
      });
    }
  }

  trade.lastPnlPercent = pnlPercent;
  trade.lastRiskCheckAt = new Date().toISOString();

  return { pnlPercent, updates };
}

module.exports = {
  calculatePnlPercent,
  applyRiskReduction,
};
