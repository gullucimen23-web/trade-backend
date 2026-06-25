const { getFirestore } = require("firebase-admin/firestore");

(async () => {
  try {
    const cols = await getFirestore().listCollections();
    console.log("Collections:", cols.map(c => c.id));
  } catch (e) {
    console.error("LIST ERROR:", e);
  }
})();