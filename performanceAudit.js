function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildPerformanceAudit(trades, options = {}) {
  const minTrades = Math.max(20, num(options.minTrades ?? process.env.EDGE_VALIDATION_MIN_TRADES, 100));
  const minProfitFactor = Math.max(1, num(options.minProfitFactor ?? process.env.EDGE_VALIDATION_MIN_PROFIT_FACTOR, 1.30));
  const maxDrawdownLimit = Math.max(1, num(options.maxDrawdown ?? process.env.EDGE_VALIDATION_MAX_DRAWDOWN_PERCENT, 10));
  const defaultCostPercent = Math.max(0, num(process.env.EDGE_ALL_IN_COST_PERCENT, 0.20));
  const closed = (Array.isArray(trades) ? trades : []).filter((trade) =>
    String(trade.status || "").startsWith("CLOSED") && trade.signalSnapshot?.mode === "EDGE_V9_COST_AWARE"
  );

  let grossProfit = 0;
  let grossLoss = 0;
  let netTotalRoe = 0;
  let equityCurve = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let wins = 0;

  for (const trade of closed) {
    const leverage = Math.max(1, num(trade.leverage, 1));
    const costPercent = num(trade.signalSnapshot?.estimatedCostPercent, defaultCostPercent);
    const netRoe = num(trade.pnlPercent) - costPercent * leverage;
    netTotalRoe += netRoe;
    equityCurve += netRoe;
    peak = Math.max(peak, equityCurve);
    maxDrawdown = Math.max(maxDrawdown, peak - equityCurve);
    if (netRoe > 0) {
      wins += 1;
      grossProfit += netRoe;
    } else {
      grossLoss += Math.abs(netRoe);
    }
  }

  const count = closed.length;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
  const averageNetRoe = count ? netTotalRoe / count : 0;
  const ready = count >= minTrades && profitFactor >= minProfitFactor && averageNetRoe > 0 && maxDrawdown <= maxDrawdownLimit;
  const blockers = [];
  if (count < minTrades) blockers.push(`${minTrades - count} doğrulama işlemi daha gerekli`);
  if (count && profitFactor < minProfitFactor) blockers.push(`profit factor ${profitFactor.toFixed(2)} < ${minProfitFactor}`);
  if (count && averageNetRoe <= 0) blockers.push("maliyet sonrası ortalama işlem pozitif değil");
  if (maxDrawdown > maxDrawdownLimit) blockers.push(`maksimum düşüş %${maxDrawdown.toFixed(2)} > %${maxDrawdownLimit}`);

  return {
    mode: "forward_paper_cost_adjusted",
    closedTrades: count,
    wins,
    winRate: count ? Number((wins / count * 100).toFixed(2)) : 0,
    profitFactor: Number(profitFactor.toFixed(2)),
    averageNetRoe: Number(averageNetRoe.toFixed(3)),
    netTotalRoe: Number(netTotalRoe.toFixed(2)),
    maxDrawdownRoe: Number(maxDrawdown.toFixed(2)),
    liveEvidenceReady: ready,
    blockers,
  };
}

module.exports = { buildPerformanceAudit };
