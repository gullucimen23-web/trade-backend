const { applyRiskReduction, calculatePnlPercent } = require("./riskManager");

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
    initialStopLossPrice: tradePlan.stopLossPrice,
    takeProfitPercent: tradePlan.takeProfitPercent,
    stopLossPercent: tradePlan.stopLossPercent,
    positionSizePercent: tradePlan.positionSizePercent,
    leverage: tradePlan.leverage,
    score: signal.score,
    openedAt: new Date().toISOString(),
    breakEvenActivated: false,
    lockedProfitPercent: 0,
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
  const riskUpdates = [];

  for (const trade of trades) {
    if (trade.symbol !== symbol || trade.status !== "OPEN") continue;

    const riskResult = applyRiskReduction(trade, currentPrice);
    for (const update of riskResult.updates) {
      riskUpdates.push({ trade, update });
    }

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
      trade.pnlPercent = calculatePnlPercent(trade, currentPrice);
      trade.closedAt = new Date().toISOString();
      closed.push(trade);
    }
  }

  return { closed, riskUpdates };
}

module.exports = {
  loadOpenTrades,
  createPaperTrade,
  getOpenTrades,
  getAllTrades,
  updatePaperTrades,
};
