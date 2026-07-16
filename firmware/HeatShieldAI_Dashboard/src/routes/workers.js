// routes/workers.js
// ------------------
// Read-side API the dashboard frontend calls. Deliberately the ONLY thing
// the browser ever talks to -- the frontend has no Firebase credentials of
// its own, so all Firestore access is mediated (and rate-limitable,
// auditable, etc.) through this Express layer.

const express = require("express");
const { db } = require("../firebase");
const { dailyAverages, thirtyDayRisk } = require("../heatStrain");
const { verifyAuth } = require("../auth");

const router = express.Router();

// Every route below requires a signed-in user; WHICH devices they can see
// depends on role (applied per-route below, not blanket, since the list
// and detail routes filter differently).
router.use(verifyAuth);

function serializeReading(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    receivedAt: data.receivedAt ? data.receivedAt.toDate().toISOString() : null,
  };
}

function serializeWorkerSummary(doc) {
  const data = doc.data();
  return {
    workerId: doc.id,
    name: data.name || doc.id,
    site: data.site || "Unassigned",
    deviceType: data.deviceType || "real",
    allocatedToPhone: data.allocatedToPhone || null,
    allocatedToName: data.allocatedToName || null,
    latest: data.latest
      ? {
          ...data.latest,
          receivedAt: data.latest.receivedAt ? data.latest.receivedAt.toDate().toISOString() : null,
        }
      : null,
    lastSeenAt: data.lastSeenAt ? data.lastSeenAt.toDate().toISOString() : null,
  };
}

// GET /api/workers -- lightweight list for the dashboard's worker grid.
// Supervisors see every device; workers see only the one device (if any)
// currently allocated to their phone number.
router.get("/", async (req, res) => {
  try {
    let snap;
    if (req.user.role === "supervisor") {
      snap = await db.collection("workers").get();
    } else {
      snap = await db.collection("workers").where("allocatedToUid", "==", req.user.uid).get();
    }
    const workers = snap.docs.map(serializeWorkerSummary);
    workers.sort((a, b) => a.workerId.localeCompare(b.workerId));
    res.json({ workers });
  } catch (err) {
    console.error("[workers] list failed:", err);
    res.status(500).json({ error: "Internal error listing workers." });
  }
});

// GET /api/workers/:id -- everything the detail view needs in one call:
// profile, latest reading, recent raw readings, and the last 30 days of
// aggregated history (+ the derived chronic-exposure indicator).
router.get("/:id", async (req, res) => {
  const workerId = req.params.id;
  const workerRef = db.collection("workers").doc(workerId);

  try {
    const workerSnap = await workerRef.get();
    if (!workerSnap.exists) {
      return res.status(404).json({ error: `No worker with id "${workerId}".` });
    }
    const workerData = workerSnap.data();

    if (req.user.role !== "supervisor" && workerData.allocatedToUid !== req.user.uid) {
      return res.status(403).json({ error: "This device isn't allocated to you." });
    }

    const [recentReadingsSnap, dailyStatsSnap] = await Promise.all([
      workerRef.collection("readings").orderBy("receivedAt", "desc").limit(20).get(),
      workerRef.collection("dailyStats").orderBy("date", "desc").limit(30).get(),
    ]);

    const recentReadings = recentReadingsSnap.docs.map(serializeReading);

    // Reverse to ascending (oldest -> newest) since that's what a trend
    // chart wants, and compute per-day averages from the stored sums.
    const dailyStatsAscending = dailyStatsSnap.docs.map((d) => d.data()).reverse();
    const history = dailyStatsAscending.map((stats) => ({
      date: stats.date,
      readingsCount: stats.readingsCount,
      heatStrainDay: stats.heatStrainDay,
      minSpo2Pct: stats.minSpo2Pct,
      maxHeartRateBpm: stats.maxHeartRateBpm,
      classCounts: stats.classCounts,
      ...dailyAverages(stats),
    }));

    const risk = thirtyDayRisk(dailyStatsAscending);

    res.json({
      workerId,
      name: workerData.name || workerId,
      site: workerData.site || "Unassigned",
      deviceType: workerData.deviceType || "real",
      allocatedToPhone: workerData.allocatedToPhone || null,
      allocatedToName: workerData.allocatedToName || null,
      latest: workerData.latest
        ? {
            ...workerData.latest,
            receivedAt: workerData.latest.receivedAt
              ? workerData.latest.receivedAt.toDate().toISOString()
              : null,
          }
        : null,
      lastSeenAt: workerData.lastSeenAt ? workerData.lastSeenAt.toDate().toISOString() : null,
      recentReadings,
      history,
      risk,
    });
  } catch (err) {
    console.error(`[workers] detail failed for "${workerId}":`, err);
    res.status(500).json({ error: "Internal error loading worker detail." });
  }
});

module.exports = router;
