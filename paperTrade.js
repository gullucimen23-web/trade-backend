let trades = [];

async function loadOpenTrades() {
  console.log("♻️ Firestore kapalı. Açık işlemler RAM'den takip edilecek.");
  return trades;
}

async function createPaperTrade(symbol, signal, tradePlan) {
  const exists = trades.find(
    (t) => t.symbol === symbol && t.status === "OPEN"
  );

  if (exists) return null;

  const trade = {
    id: Date.now().toString(),
    symbol,
    side: tradePlan.side,
    status: "OPEN",
    entry: tradePlan.entry,
    takeProfitPrice: tradePlan.takeProfitPrice,
    stopLossPrice: tradePlan.stopLossPrice,
    takeProfitPercent: tradePlan.takeProfitPercent,
    stopLossPercent: tradePlan.stopLossPercent,
    positionSizePercent: tradePlan.positionSizePercent,
    leverage: tradePlan.leverage,
    score: signal.score,
    openedAt: new Date().toISOString(),
  };

  trades.push(trade);
  return trade;
}

function getOpenTrades() {
  return trades.filter((t) => t.status === "OPEN");
}

function getAllTrades() {
  return trades;
}

async function updatePaperTrades(symbol, currentPrice) {
  const closed = [];

  for (const trade of trades) {
    if (trade.symbol !== symbol || trade.status !== "OPEN") continue;

    const isLong = trade.side === "LONG";

    const hitTp = isLong
      ? currentPrice >= trade.takeProfitPrice
      : currentPrice <= trade.takeProfitPrice;

    const hitSl = isLong
      ? currentPrice <= trade.stopLossPrice
      : currentPrice >= trade.stopLossPrice;

    if (hitTp || hitSl) {
      trade.status = hitTp ? "CLOSED_TP" : "CLOSED_SL";
      trade.exit = currentPrice;

      const rawPnl = isLong
        ? ((currentPrice - trade.entry) / trade.entry) * 100
        : ((trade.entry - currentPrice) / trade.entry) * 100;

      trade.pnlPercent = Number((rawPnl * trade.leverage).toFixed(2));
      trade.closedAt = new Date().toISOString();

      closed.push(trade);
    }
  }

  return closed;
}

module.exports = {
  loadOpenTrades,
  createPaperTrade,
  getOpenTrades,
  getAllTrades,
  updatePaperTrades,
};
