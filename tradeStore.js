// Firestore kaldırıldı. Bu dosya eski importlar hata vermesin diye RAM uyumlu stub olarak bırakıldı.
async function saveTrade() {
  return true;
}

async function updateTrade() {
  return true;
}

async function getOpenTradesFromFirestore() {
  return [];
}

module.exports = {
  saveTrade,
  updateTrade,
  getOpenTradesFromFirestore,
};
