// firestoreUtils.js
// ------------------
// Small helpers shared between the seed script and the live backend, so
// there's exactly one implementation of "delete every doc in a
// collection" (Firestore has no built-in bulk-delete call).

const { db } = require("./firebase");

async function deleteSubcollection(collectionRef, batchSize = 400) {
  let deleted = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await collectionRef.limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < batchSize) break;
  }
  return deleted;
}

module.exports = { deleteSubcollection };
