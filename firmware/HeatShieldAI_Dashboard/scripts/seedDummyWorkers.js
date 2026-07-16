// seedDummyWorkers.js
// --------------------
// Populates 3 example workers (worker2, worker3, worker4) with 30 days of
// synthetic hourly readings, so the dashboard has something to show besides
// worker1 (the real device). NEVER touches worker1 -- that id is reserved
// for the actual running system, per the project requirement that worker1's
// data must be real, not simulated.
//
// Run with: npm run seed
// Re-running is safe by default (skips any worker that already has data);
// pass --force to wipe and regenerate a worker's readings/dailyStats first.
//
// Each worker gets a different monthly heat-strain profile on purpose, so
// the dashboard's 30-day chronic-exposure indicator (see ../src/heatStrain.js)
// has something meaningful to differentiate between low/moderate/high risk
// across workers, instead of every dummy worker looking identical:
//   - worker2: mild month, mostly SAFE/WARNING -> low cumulative exposure
//   - worker3: a rough ~8-day stretch mid-month with heavy sun exposure
//     -> high cumulative exposure (demonstrates the "high" risk bucket)
//   - worker4: moderate, uneven month -> moderate cumulative exposure

require("dotenv").config();

const { db, admin } = require("../src/firebase");
const { dateKeyUTC, emptyDailyStats, foldReadingIntoDailyStats } = require("../src/heatStrain");
const { deleteSubcollection } = require("../src/firestoreUtils");
const { CLASS_NAMES, mulberry32, sampleReadingForClass } = require("./syntheticPhysiology");

const FORCE = process.argv.includes("--force");
const DAYS_OF_HISTORY = 30;
const WORK_HOURS = 11; // one reading per hour, 07:00-17:00 UTC (see README note on timezone)
const PEAK_HOUR_INDEX = 5; // the 12:00 reading -- midday, hottest part of the shift

// Placeholder site coordinates (generic city centers) -- replace with your
// actual job-site coordinates before showing this to anyone who'd notice.
// Tiny per-reading jitter simulates a worker moving around a site + normal
// GPS noise, not the worker teleporting.
// Which days run "hot" is assigned DETERMINISTICALLY per worker (not by
// per-day coin-flip) so the resulting 30-day heat-strain-day count reliably
// lands in the intended risk bucket (see heatStrain.js: low <3, moderate
// 3-6, high >=7) instead of drifting with random chance. The Gaussian noise
// within each reading still comes from the seeded RNG -- only the
// day-to-day STRUCTURE (which days are bad) is fixed.
const WORKER_PROFILES = [
  {
    workerId: "worker2",
    name: "Ramesh Kumar",
    site: "Site B - Warehouse Expansion",
    baseLat: 28.6139,
    baseLon: 77.209, // New Delhi (placeholder)
    seed: 20260101,
    // Mild month: only 2 DANGER-peak days all month -> "low" bucket.
    dayPeakClass(dayIndex) {
      if (dayIndex === 10 || dayIndex === 22) return 2;
      if ([0, 6, 13, 20, 27].includes(dayIndex)) return 0; // a few easy/rest days
      return 1;
    },
  },
  {
    workerId: "worker3",
    name: "Suresh Patel",
    site: "Site C - Highway Overpass",
    baseLat: 19.076,
    baseLon: 72.8777, // Mumbai (placeholder)
    seed: 20260102,
    // Rough patch: an 8-day CRITICAL-peak stretch (days 12-19) plus a
    // DANGER/WARNING-alternating baseline for the rest -> ~19 heat-strain
    // days total, comfortably "high".
    dayPeakClass(dayIndex) {
      if (dayIndex >= 12 && dayIndex <= 19) return 3;
      return dayIndex % 2 === 0 ? 2 : 1;
    },
  },
  {
    workerId: "worker4",
    name: "Amit Singh",
    site: "Site A - Residential Tower",
    baseLat: 12.9716,
    baseLon: 77.5946, // Bengaluru (placeholder)
    seed: 20260103,
    // Uneven month: 4 DANGER-peak days + 1 CRITICAL-peak day -> 5
    // heat-strain days, landing in "moderate".
    dayPeakClass(dayIndex) {
      if (dayIndex === 18) return 3;
      if ([5, 14, 21, 27].includes(dayIndex)) return 2;
      return 1;
    },
    // Demonstrates the dehydration-trend indicator: acute readings stay
    // "moderate" all month (nothing an instantaneous reading would flag),
    // but a slow +9 BPM drift by month's end simulates the cardiovascular
    // drift accumulating dehydration research describes -- precisely the
    // "looks fine day to day, but slowly deteriorating" pattern a single
    // reading can't show, which is the whole point of this feature.
    heartRateDriftBpm(dayIndex) {
      return (dayIndex / (DAYS_OF_HISTORY - 1)) * 9;
    },
  },
];

function classIndexAtHour(peakClassIndex, hourIndex) {
  const distanceFromPeak = Math.abs(hourIndex - PEAK_HOUR_INDEX);
  const levelDrop = Math.floor(distanceFromPeak / 2);
  return Math.max(0, Math.min(3, peakClassIndex - levelDrop));
}

async function seedWorker(profile) {
  const workerRef = db.collection("workers").doc(profile.workerId);
  const existing = await workerRef.get();

  if (existing.exists && !FORCE) {
    console.log(`[skip] ${profile.workerId} already has data (pass --force to regenerate).`);
    return;
  }

  if (existing.exists && FORCE) {
    console.log(`[force] Wiping existing data for ${profile.workerId}...`);
    await deleteSubcollection(workerRef.collection("readings"));
    await deleteSubcollection(workerRef.collection("dailyStats"));
  }

  console.log(`[seed] Generating ${DAYS_OF_HISTORY} days of history for ${profile.workerId} (${profile.name})...`);

  const rng = mulberry32(profile.seed);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let batch = db.batch();
  let opsInBatch = 0;
  let latestReading = null;
  let sequenceNumber = 0;

  async function flushIfNeeded(force = false) {
    if (opsInBatch >= 400 || (force && opsInBatch > 0)) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }

  for (let dayIndex = 0; dayIndex < DAYS_OF_HISTORY; dayIndex++) {
    const dayDate = new Date(today);
    dayDate.setUTCDate(dayDate.getUTCDate() - (DAYS_OF_HISTORY - 1 - dayIndex));
    const dayKey = dateKeyUTC(dayDate);

    const peakClassIndex = profile.dayPeakClass(dayIndex);
    const dailyStats = emptyDailyStats(dayKey);

    const driftBpm = profile.heartRateDriftBpm ? profile.heartRateDriftBpm(dayIndex) : 0;

    for (let hour = 0; hour < WORK_HOURS; hour++) {
      const classIdx = classIndexAtHour(peakClassIndex, hour);
      const className = CLASS_NAMES[classIdx];
      const sample = sampleReadingForClass(className, rng, driftBpm);

      const readingTime = new Date(dayDate);
      readingTime.setUTCHours(7 + hour, 0, 0, 0);

      sequenceNumber += 1;
      const reading = {
        receivedAt: admin.firestore.Timestamp.fromDate(readingTime),
        sequenceNumber,
        temperatureC: sample.temperatureC,
        humidityPct: sample.humidityPct,
        heartRateBpm: sample.heartRateBpm,
        spo2Pct: sample.spo2Pct,
        heatIndexC: sample.heatIndexC,
        fingerPresent: true,
        predictedClass: classIdx,
        confidencePercent: Math.round((78 + rng() * 20) * 10) / 10,
        latitude: profile.baseLat + (rng() - 0.5) * 0.001,
        longitude: profile.baseLon + (rng() - 0.5) * 0.001,
        gpsFixValid: true,
        satellites: 6 + Math.floor(rng() * 6),
        rssi: Math.round(-95 + rng() * 35),
        snr: Math.round((2 + rng() * 8) * 10) / 10,
      };

      foldReadingIntoDailyStats(dailyStats, reading);

      const readingRef = workerRef.collection("readings").doc();
      batch.set(readingRef, reading);
      opsInBatch += 1;
      await flushIfNeeded();

      latestReading = reading;
    }

    const dailyStatsRef = workerRef.collection("dailyStats").doc(dayKey);
    batch.set(dailyStatsRef, dailyStats);
    opsInBatch += 1;
    await flushIfNeeded();
  }

  batch.set(
    workerRef,
    {
      name: profile.name,
      site: profile.site,
      deviceType: "dummy",
      createdAt: admin.firestore.Timestamp.now(),
      latest: latestReading,
      lastSeenAt: latestReading.receivedAt,
    },
    { merge: true }
  );
  opsInBatch += 1;
  await flushIfNeeded(true);

  console.log(`[done] ${profile.workerId}: ${DAYS_OF_HISTORY * WORK_HOURS} readings across ${DAYS_OF_HISTORY} days.`);
}

async function main() {
  console.log("HeatShieldAI Dashboard - dummy worker seed script");
  console.log("worker1 is never touched by this script (reserved for the real device).\n");

  for (const profile of WORKER_PROFILES) {
    await seedWorker(profile);
  }

  console.log("\nSeeding complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
