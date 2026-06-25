const { getFirestore } = require("firebase-admin/firestore");

(async () => {
  try {
    await getFirestore().listCollections();
    console.log("FIRESTORE OK");
  } catch (e) {
    console.error("FIRESTORE ERROR");
    console.error(e);
  }
})();