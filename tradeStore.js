const { db } = require("./firebase");

async function saveTrade(trade) {
  await db.collection("trade_logs").doc(trade.id).set(trade, { merge: true });
}

async function updateTrade(trade) {
  await db.collection("trade_logs").doc(trade.id).set(trade, { merge: true });
}

async function getOpenTradesFromFirestore() {
  const snap = await db
    .collection("trade_logs")
    .where("status", "==", "OPEN")
    .get();

  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

module.exports = {
  saveTrade,
  updateTrade,
  getOpenTradesFromFirestore,
};