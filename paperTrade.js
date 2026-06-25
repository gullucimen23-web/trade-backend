const { readJson, writeJson } = require("./dataStore");
const { registerTradeClose } = require("./riskGuard");

let trades = readJson("trades.json", []);

function persist() {
  writeJson("trades.json", trades);
}

async function loadOpenTrades() {
  trades = readJson("trades.json", []);
  console.log(`♻️ JSON'dan ${getOpenTrades().length} açık paper işlem yüklendi.`);
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
    entry: Number(tradePlan.entry),
    takeProfitPrice: Number(tradePlan.takeProfitPrice),
    originalStopLossPrice: Number(tradePlan.stopLossPrice),
    stopLossPrice: Number(tradePlan.stopLossPrice),
    activeStopLossPrice: Number(tradePlan.stopLossPrice),
    takeProfitPercent: tradePlan.takeProfitPercent,
    stopLossPercent: tradePlan.stopLossPercent,
    positionSizePercent: tradePlan.positionSizePercent,
    leverage: tradePlan.leverage,
    score: signal.score,
    openedAt: new Date().toISOString(),
    bestPrice: Number(tradePlan.entry),
    highestPnlPercent: 0,
    riskLevel: "INITIAL_RISK",
    trailStep: 0,
  };

  trades.push(trade);
  persist();
  return trade;
}

function getOpenTrades() {
  return trades.filter((t) => t.status === "OPEN");
}

function getAllTrades() {
  return trades;
}

function calculatePnlPercent(trade, currentPrice) {
  const isLong = trade.side === "LONG";
  const rawPnl = isLong
    ? ((currentPrice - trade.entry) / trade.entry) * 100
    : ((trade.entry - currentPrice) / trade.entry) * 100;

  return Number((rawPnl * Number(trade.leverage || 1)).toFixed(2));
}

function improvePaperRisk(trade, currentPrice) {
  const pnlPercent = calculatePnlPercent(trade, currentPrice);
  trade.highestPnlPercent = Math.max(Number(trade.highestPnlPercent || 0), pnlPercent);

  const isLong = trade.side === "LONG";
  const bestBefore = Number(trade.bestPrice || trade.entry);
  trade.bestPrice = isLong ? Math.max(bestBefore, currentPrice) : Math.min(bestBefore, currentPrice);

  const oldSl = Number(trade.activeStopLossPrice || trade.stopLossPrice);
  let newSl = oldSl;
  let riskMessage = null;

  const setStopByProfit = (lockedProfitPercent, level, label) => {
    const priceMove = lockedProfitPercent / Number(trade.leverage || 1) / 100;
    const targetSl = isLong
      ? trade.entry * (1 + priceMove)
      : trade.entry * (1 - priceMove);

    const better = isLong ? targetSl > newSl : targetSl < newSl;
    if (better) {
      newSl = Number(targetSl.toFixed(4));
      trade.riskLevel = level;
      riskMessage = label;
    }
  };

  if (pnlPercent >= 0.6) setStopByProfit(0, "BREAK_EVEN", "Risk azaltıldı: SL giriş fiyatına çekildi.");
  if (pnlPercent >= 1.2) setStopByProfit(0.35, "LOCK_035", "Kâr koruma: SL yaklaşık +%0.35 kâra çekildi.");
  if (pnlPercent >= 2.0) setStopByProfit(0.8, "LOCK_080", "Kâr koruma: SL yaklaşık +%0.80 kâra çekildi.");
  if (pnlPercent >= 3.0) setStopByProfit(1.4, "TRAILING", "Trailing koruma aktif: SL kârı koruyacak şekilde taşındı.");

  if (newSl !== oldSl) {
    trade.activeStopLossPrice = newSl;
    trade.stopLossPrice = newSl;
    trade.lastRiskMoveAt = new Date().toISOString();
    return { changed: true, oldSl, newSl, pnlPercent, riskMessage };
  }

  return { changed: false, oldSl, newSl, pnlPercent, riskMessage: null };
}

async function updatePaperTrades(symbol, currentPrice) {
  const closed = [];
  let changed = false;

  for (const trade of trades) {
    if (trade.symbol !== symbol || trade.status !== "OPEN") continue;

    const riskMove = improvePaperRisk(trade, Number(currentPrice));
    if (riskMove.changed) changed = true;

    const isLong = trade.side === "LONG";
    const activeStop = Number(trade.activeStopLossPrice || trade.stopLossPrice);

    const hitTp = isLong
      ? currentPrice >= trade.takeProfitPrice
      : currentPrice <= trade.takeProfitPrice;

    const hitSl = isLong
      ? currentPrice <= activeStop
      : currentPrice >= activeStop;

    if (hitTp || hitSl) {
      trade.status = hitTp ? "CLOSED_TP" : "CLOSED_SL";
      trade.exit = Number(currentPrice);
      trade.pnlPercent = calculatePnlPercent(trade, Number(currentPrice));
      trade.closedAt = new Date().toISOString();
      registerTradeClose(trade.pnlPercent);
      closed.push(trade);
      changed = true;
    }
  }

  if (changed) persist();
  return closed;
}

module.exports = {
  loadOpenTrades,
  createPaperTrade,
  getOpenTrades,
  getAllTrades,
  updatePaperTrades,
  calculatePnlPercent,
  improvePaperRisk,
};
