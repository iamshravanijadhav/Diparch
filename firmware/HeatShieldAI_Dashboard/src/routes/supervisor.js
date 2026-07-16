// routes/supervisor.js
// ----------------------
// Supervisor-only device management: see who's signed up as a worker,
// allocate/unallocate a device to them by phone number, and erase a
// device's data. Every route here requires requireSupervisor (mounted in
// server.js after verifyAuth), so req.user.role === "supervisor" is
// guaranteed by the time these handlers run.

const express = require("express");
const { admin, db } = require("../firebase");
const { normalizePhone } = require("../auth");
const { deleteSubcollection } = require("../firestoreUtils");

const router = express.Router();

// GET /api/supervisor/registered-workers
// Everyone who has signed up with role "worker", plus which device (if
// any) is currently allocated to them -- what the allocation dropdown in
// the UI is built from. Deliberately does NOT include supervisors (nothing
// to allocate to them).
router.get("/registered-workers", async (req, res) => {
  try {
    const [usersSnap, workersSnap] = await Promise.all([
      db.collection("users").where("role", "==", "worker").get(),
      db.collection("workers").get(),
    ]);

    const allocatedDeviceByUid = {};
    workersSnap.docs.forEach((doc) => {
      const data = doc.data();
      if (data.allocatedToUid) allocatedDeviceByUid[data.allocatedToUid] = doc.id;
    });

    const workers = usersSnap.docs.map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        phoneNumber: data.phoneNumber,
        name: data.name || null,
        allocatedDeviceId: allocatedDeviceByUid[doc.id] || null,
      };
    });

    res.json({ workers });
  } catch (err) {
    console.error("[supervisor] registered-workers failed:", err);
    res.status(500).json({ error: "Internal error listing registered workers." });
  }
});

// POST /api/supervisor/allocate
// Body: { workerId, phoneNumber }
// Enforces "one device per worker, strictly": if that phone already holds a
// different device, it's unallocated first. Reassigning a device that was
// held by someone else simply overwrites their allocation -- they lose
// visibility of it, nothing else to clean up on their side since a device
// only ever points at its CURRENT holder, not a history of past ones.
router.post("/allocate", async (req, res) => {
  const { workerId } = req.body || {};
  const normalizedPhone = normalizePhone(req.body?.phoneNumber);

  if (typeof workerId !== "string" || !workerId.trim()) {
    return res.status(400).json({ error: "workerId is required." });
  }
  if (!normalizedPhone) {
    return res.status(400).json({ error: "phoneNumber looks invalid." });
  }

  try {
    const deviceRef = db.collection("workers").doc(workerId);
    const [deviceSnap, matchingWorkerSnap] = await Promise.all([
      deviceRef.get(),
      db
        .collection("users")
        .where("phoneNumber", "==", normalizedPhone)
        .where("role", "==", "worker")
        .limit(1)
        .get(),
    ]);

    if (!deviceSnap.exists) {
      return res.status(404).json({ error: `No device with id "${workerId}".` });
    }
    if (matchingWorkerSnap.empty) {
      return res.status(404).json({
        error: `No registered worker with phone number ${normalizedPhone}. They need to sign up first.`,
      });
    }

    const workerDoc = matchingWorkerSnap.docs[0];
    const workerUid = workerDoc.id;
    const workerProfile = workerDoc.data();

    // Find any OTHER device currently held by this worker and free it
    // (one device per worker, strictly).
    const previousDeviceSnap = await db
      .collection("workers")
      .where("allocatedToUid", "==", workerUid)
      .get();

    const batch = db.batch();
    previousDeviceSnap.docs.forEach((doc) => {
      if (doc.id !== workerId) {
        batch.update(doc.ref, {
          allocatedToPhone: null,
          allocatedToUid: null,
          allocatedToName: null,
          allocatedAt: null,
        });
      }
    });
    batch.update(deviceRef, {
      allocatedToPhone: normalizedPhone,
      allocatedToUid: workerUid,
      allocatedToName: workerProfile.name || null,
      allocatedAt: admin.firestore.Timestamp.now(),
    });
    await batch.commit();

    res.json({ ok: true });
  } catch (err) {
    console.error("[supervisor] allocate failed:", err);
    res.status(500).json({ error: "Internal error allocating device." });
  }
});

// POST /api/supervisor/unallocate
// Body: { workerId }
router.post("/unallocate", async (req, res) => {
  const { workerId } = req.body || {};
  if (typeof workerId !== "string" || !workerId.trim()) {
    return res.status(400).json({ error: "workerId is required." });
  }

  try {
    const deviceRef = db.collection("workers").doc(workerId);
    const deviceSnap = await deviceRef.get();
    if (!deviceSnap.exists) {
      return res.status(404).json({ error: `No device with id "${workerId}".` });
    }
    await deviceRef.update({
      allocatedToPhone: null,
      allocatedToUid: null,
      allocatedToName: null,
      allocatedAt: null,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[supervisor] unallocate failed:", err);
    res.status(500).json({ error: "Internal error unallocating device." });
  }
});

// POST /api/supervisor/erase
// Body: { workerId }
// Wipes readings + dailyStats (and the denormalized "latest" snapshot) but
// keeps the device profile (name/site/deviceType) AND its current
// allocation intact, so it can keep collecting fresh data for the same
// worker immediately afterward. This is a destructive, irreversible action
// -- the frontend is expected to confirm before calling this.
router.post("/erase", async (req, res) => {
  const { workerId } = req.body || {};
  if (typeof workerId !== "string" || !workerId.trim()) {
    return res.status(400).json({ error: "workerId is required." });
  }

  try {
    const deviceRef = db.collection("workers").doc(workerId);
    const deviceSnap = await deviceRef.get();
    if (!deviceSnap.exists) {
      return res.status(404).json({ error: `No device with id "${workerId}".` });
    }

    await deleteSubcollection(deviceRef.collection("readings"));
    await deleteSubcollection(deviceRef.collection("dailyStats"));
    await deviceRef.update({ latest: null, lastSeenAt: null });

    res.json({ ok: true });
  } catch (err) {
    console.error("[supervisor] erase failed:", err);
    res.status(500).json({ error: "Internal error erasing device data." });
  }
});

module.exports = router;
