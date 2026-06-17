const { db } = require("./firebase");

function getTodayId() {
  return new Date().toISOString().slice(0, 10);
}

async function updateDailyStats(trade) {
  const todayId = getTodayId();
  const ref = db.collection("daily_stats").doc(todayId);
  const snap = await ref.get();

  const current = snap.exists
    ? snap.data()
    : {
        date: todayId,
        totalTrades: 0,
        closedTrades: 0,
        tpCount: 0,
        slCount: 0,
        totalPnlPercent: 0,
        winRate: 0,
        updatedAt: null,
      };

  current.totalTrades += trade.openedAt && !trade.statsCountedOpen ? 1 : 0;

  if (trade.status === "CLOSED_TP" || trade.status === "CLOSED_SL") {
    current.closedTrades += 1;

    if (trade.status === "CLOSED_TP") current.tpCount += 1;
    if (trade.status === "CLOSED_SL") current.slCount += 1;

    current.totalPnlPercent = Number(
      (Number(current.totalPnlPercent || 0) + Number(trade.pnlPercent || 0)).toFixed(2)
    );

    current.winRate =
      current.closedTrades > 0
        ? Number(((current.tpCount / current.closedTrades) * 100).toFixed(2))
        : 0;
  }

  current.updatedAt = new Date().toISOString();

  await ref.set(current, { merge: true });
}

module.exports = {
  updateDailyStats,
};