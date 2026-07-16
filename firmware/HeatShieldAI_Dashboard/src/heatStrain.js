// heatStrain.js
// -------------
// Shared analytics for turning a stream of per-reading heat-stress
// classifications into a 30-day picture per worker. Used by both the live
// ingest route (routes/ingest.js, updating one day at a time as real
// readings arrive) and the dummy-data seed script (scripts/seedDummyWorkers.js,
// computing a full month at once), so the two paths can never disagree on
// what these indicators mean.
//
// WHY THIS EXISTS (the mentor's ask): HeatShieldAI's on-device TinyML model
// classifies ACUTE heat stress from the current reading only (SAFE/WARNING/
// DANGER/CRITICAL). It has no way to see -- and was never trained to see --
// the cumulative, longer-horizon picture: a single day's reading can look
// fine even for a worker whose body is quietly accumulating weeks of strain.
// This module is a transparent, RULE-BASED aggregation layer on top of the
// model's per-reading output -- NOT a second ML model, NOT a diagnosis of
// any condition. It surfaces four separate, independently-grounded risk
// PATTERNS a single instantaneous reading can never show:
//
//   1. Heat Strain Days       -- systemic/kidney risk (existing indicator)
//   2. Cardiovascular Strain  -- sustained dangerously high heart rate
//   3. Electrolyte/Cramp Risk -- prolonged heavy exertion in high heat
//   4. Dehydration Trend      -- rising heart rate at comparable exertion
//      over the month (cardiovascular drift)
//
// Grounding for each is documented next to its computation below. None of
// this diagnoses heat exhaustion, kidney disease, or anything else --  it
// flags patterns worth a closer look, exactly the same spirit as OSHA/NIOSH
// water-rest-shade guidance: a schedule based on exposure and signs, not a
// clinical test.

const CLASS_NAMES = ["SAFE", "WARNING", "DANGER", "CRITICAL"];

function classNameFromIndex(index) {
  return CLASS_NAMES[index] || "UNKNOWN";
}

// ---- 1. Heat Strain Days (systemic / kidney risk) --------------------
// A day counts as a "heat strain day" once at least this fraction of that
// day's readings landed in DANGER or CRITICAL -- i.e. a meaningful portion
// of the shift, not one noisy/borderline reading. Repeated heat-strain
// episodes (elevated core temperature + dehydration + exertion, recurring
// over weeks) are linked in outdoor/construction worker research to
// elevated risk of acute kidney injury and, with enough recurrence, chronic
// kidney disease of nontraditional origin -- see Occupational Heat Stress
// and Kidney Health (PMC5733743) and Occupational heat exposure and the
// risk of chronic kidney disease of nontraditional origin (PMC/PubMed
// 34161738). The 0.15 fraction is a project-defined heuristic, not a
// clinical cutoff.
const HEAT_STRAIN_FRACTION_THRESHOLD = 0.15;

// ---- 2. Cardiovascular Strain -----------------------------------------
// ACGIH's own heat-strain criteria flag sustained heart rate above roughly
// (180 - age) BPM -- around 140-150 BPM for a worker in their 30s-40s -- as
// excessive heat strain requiring the worker to stop. 150 BPM is used here
// as a single threshold (age isn't collected), matching the DANGER/CRITICAL
// heart-rate ranges this project's own TinyML training data uses (see
// HeatShieldAI/training/generate_dataset.py). A day where the MAXIMUM heart
// rate reached this is flagged -- one bad peak, not an average.
const CARDIO_STRAIN_HR_THRESHOLD_BPM = 150;

// ---- 3. Electrolyte / Heat-Cramp Risk ---------------------------------
// NIOSH/OSHA guidance: heat cramps are attributed to electrolyte loss from
// heavy sweating during hard labor in heat, and workers doing 2+ hours of
// such work should have electrolyte-replacement fluids available (NIOSH
// Heat Stress guidance; OSHA "Water. Rest. Shade."). "Heavy sweating +
// hard labor" is approximated here from the two sensor signals available:
// Heat Index at/above the WARNING threshold this project already validated
// against the NWS Heat Index chart (see HeatShieldAI/README.md), combined
// with an elevated heart rate indicating active exertion (not resting) --
// see the same project's HeartRate class-distribution fix for why ~110 BPM
// is the resting/active boundary. A day is flagged once a meaningful
// fraction of its readings show both at once.
const HEAVY_EXERTION_HEAT_INDEX_C = 32; // Extreme-Caution+ on the validated HI scale
const HEAVY_EXERTION_HR_BPM = 110; // above the corrected SAFE-class ceiling -- active work
const ELECTROLYTE_RISK_FRACTION_THRESHOLD = 0.3;

// ---- 4. Dehydration / Cardiovascular Drift Trend ----------------------
// "Cardiovascular drift": progressive dehydration during prolonged heat
// exposure reduces blood volume and stroke volume, so the heart compensates
// by beating faster for the SAME workload -- a measurable, rising heart
// rate over time rather than a single elevated reading (see e.g. Heat,
// Hydration and the Human Brain, Heart and Skeletal Muscles, PMC6445826;
// dehydration reduces stroke volume and cardiac output during exercise,
// PMC7294577). This compares average heart rate in the most recent 7 days
// against the first 7 days of the available window -- a rising trend
// suggests accumulating dehydration/declining heat tolerance worth a
// hydration-schedule review, not a single bad day.
const DEHYDRATION_TREND_WINDOW_DAYS = 7;
const DEHYDRATION_TREND_RISE_THRESHOLD_BPM = 5;

function dateKeyUTC(date) {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD", UTC calendar day
}

function emptyDailyStats(dateKey) {
  return {
    date: dateKey,
    readingsCount: 0,
    sumTemperatureC: 0,
    sumHumidityPct: 0,
    sumHeartRateBpm: 0,
    sumSpo2Pct: 0,
    sumHeatIndexC: 0,
    minSpo2Pct: null,
    maxHeartRateBpm: null,
    classCounts: { SAFE: 0, WARNING: 0, DANGER: 0, CRITICAL: 0 },
    heavyExertionInHeatCount: 0,
    heatStrainDay: false,
    cardiovascularStrainDay: false,
    electrolyteRiskDay: false,
  };
}

function computeHeatStrainDay(stats) {
  if (stats.readingsCount === 0) return false;
  const strainCount = stats.classCounts.DANGER + stats.classCounts.CRITICAL;
  return strainCount / stats.readingsCount >= HEAT_STRAIN_FRACTION_THRESHOLD;
}

function computeCardiovascularStrainDay(stats) {
  return stats.maxHeartRateBpm !== null && stats.maxHeartRateBpm >= CARDIO_STRAIN_HR_THRESHOLD_BPM;
}

function computeElectrolyteRiskDay(stats) {
  if (stats.readingsCount === 0) return false;
  return stats.heavyExertionInHeatCount / stats.readingsCount >= ELECTROLYTE_RISK_FRACTION_THRESHOLD;
}

// Mutates and returns `stats` with one more reading folded in. `reading`
// needs: temperatureC, humidityPct, heartRateBpm, spo2Pct, heatIndexC,
// predictedClass (0-3 index).
function foldReadingIntoDailyStats(stats, reading) {
  stats.readingsCount += 1;
  stats.sumTemperatureC += reading.temperatureC;
  stats.sumHumidityPct += reading.humidityPct;
  stats.sumHeartRateBpm += reading.heartRateBpm;
  stats.sumSpo2Pct += reading.spo2Pct;
  stats.sumHeatIndexC += reading.heatIndexC;

  stats.minSpo2Pct =
    stats.minSpo2Pct === null ? reading.spo2Pct : Math.min(stats.minSpo2Pct, reading.spo2Pct);
  stats.maxHeartRateBpm =
    stats.maxHeartRateBpm === null
      ? reading.heartRateBpm
      : Math.max(stats.maxHeartRateBpm, reading.heartRateBpm);

  const className = classNameFromIndex(reading.predictedClass);
  if (stats.classCounts[className] !== undefined) {
    stats.classCounts[className] += 1;
  }

  if (reading.heatIndexC >= HEAVY_EXERTION_HEAT_INDEX_C && reading.heartRateBpm >= HEAVY_EXERTION_HR_BPM) {
    stats.heavyExertionInHeatCount += 1;
  }

  stats.heatStrainDay = computeHeatStrainDay(stats);
  stats.cardiovascularStrainDay = computeCardiovascularStrainDay(stats);
  stats.electrolyteRiskDay = computeElectrolyteRiskDay(stats);
  return stats;
}

// Derives averages from the running sums -- kept separate from the stored
// document so Firestore only ever stores sums/counts (cheap, atomic
// increments) and averages are computed on read.
function dailyAverages(stats) {
  if (stats.readingsCount === 0) {
    return {
      avgTemperatureC: null,
      avgHumidityPct: null,
      avgHeartRateBpm: null,
      avgSpo2Pct: null,
      avgHeatIndexC: null,
    };
  }
  const n = stats.readingsCount;
  return {
    avgTemperatureC: stats.sumTemperatureC / n,
    avgHumidityPct: stats.sumHumidityPct / n,
    avgHeartRateBpm: stats.sumHeartRateBpm / n,
    avgSpo2Pct: stats.sumSpo2Pct / n,
    avgHeatIndexC: stats.sumHeatIndexC / n,
  };
}

// One count-based indicator's severity tier -- the same 3-tier scale is
// reused across heat strain / cardiovascular strain / electrolyte risk so
// they read consistently side by side (0-2 low, 3-6 moderate, 7+ high out
// of a 30-day window). This is a project-defined severity ladder, not a
// clinical score.
function severityBucket(count) {
  if (count >= 7) return "high";
  if (count >= 3) return "moderate";
  return "low";
}

function dehydrationTrend(dailyStatsAscending) {
  const withData = dailyStatsAscending.filter((d) => d.readingsCount > 0);
  if (withData.length < DEHYDRATION_TREND_WINDOW_DAYS * 2) {
    return {
      status: "insufficient_data",
      deltaBpm: null,
      label: `Need at least ${DEHYDRATION_TREND_WINDOW_DAYS * 2} days of data to compute a trend.`,
    };
  }

  const firstWindow = withData.slice(0, DEHYDRATION_TREND_WINDOW_DAYS);
  const lastWindow = withData.slice(-DEHYDRATION_TREND_WINDOW_DAYS);
  const avgOf = (days) => {
    const totalReadings = days.reduce((sum, d) => sum + d.readingsCount, 0);
    const totalHr = days.reduce((sum, d) => sum + d.sumHeartRateBpm, 0);
    return totalReadings > 0 ? totalHr / totalReadings : null;
  };

  const firstAvg = avgOf(firstWindow);
  const lastAvg = avgOf(lastWindow);
  if (firstAvg === null || lastAvg === null) {
    return { status: "insufficient_data", deltaBpm: null, label: "Not enough heart-rate data yet." };
  }

  const deltaBpm = lastAvg - firstAvg;
  if (deltaBpm >= DEHYDRATION_TREND_RISE_THRESHOLD_BPM) {
    return {
      status: "rising",
      deltaBpm,
      label:
        `Average heart rate is up ${deltaBpm.toFixed(1)} BPM vs. the start of this window -- a rising ` +
        "trend at comparable exertion can indicate cardiovascular drift from accumulating dehydration. " +
        "Worth a hydration-schedule review.",
    };
  }
  return {
    status: "stable",
    deltaBpm,
    label: "No concerning rise in average heart rate over this window.",
  };
}

// Summarizes up to 30 daily-stats documents into the dashboard's four
// long-term risk indicators, plus a headline "worst of the four" bucket.
// Buckets are project-defined severity tiers, not a medical risk score.
function thirtyDayRisk(dailyStatsArray) {
  const heatStrainDays = dailyStatsArray.filter((d) => d.heatStrainDay).length;
  const cardiovascularStrainDays = dailyStatsArray.filter((d) => d.cardiovascularStrainDay).length;
  const electrolyteRiskDays = dailyStatsArray.filter((d) => d.electrolyteRiskDay).length;
  const trend = dehydrationTrend(dailyStatsArray);

  const heatStrainBucket = severityBucket(heatStrainDays);
  const cardioBucket = severityBucket(cardiovascularStrainDays);
  const electrolyteBucket = severityBucket(electrolyteRiskDays);
  const trendBucket = trend.status === "rising" ? "moderate" : "low";

  const bucketRank = { low: 0, moderate: 1, high: 2 };
  const worst = [heatStrainBucket, cardioBucket, electrolyteBucket, trendBucket].reduce((a, b) =>
    bucketRank[b] > bucketRank[a] ? b : a
  );

  const OVERALL_LABEL = {
    low: "Low cumulative heat-exposure risk this month.",
    moderate:
      "Moderate cumulative heat-exposure risk this month -- review the indicators below for specifics.",
    high:
      "High cumulative heat-exposure risk this month -- recurrent heat strain is associated with " +
      "elevated long-term health risk in outdoor workers; consider a medical check-in and reviewing " +
      "this worker's rest/hydration schedule.",
  };

  return {
    // Headline (backward-compatible field names -- existing dashboard code
    // reads heatStrainDays/bucket/label as the top-line summary).
    heatStrainDays,
    totalDays: dailyStatsArray.length,
    bucket: worst,
    label: OVERALL_LABEL[worst],
    // Per-indicator breakdown.
    indicators: {
      heatStrain: {
        days: heatStrainDays,
        bucket: heatStrainBucket,
        title: "Heat Strain (systemic/kidney risk)",
        description:
          "Days with sustained DANGER/CRITICAL classification. Repeated heat-strain episodes are " +
          "linked to elevated risk of kidney injury in outdoor workers over time.",
      },
      cardiovascularStrain: {
        days: cardiovascularStrainDays,
        bucket: cardioBucket,
        title: "Cardiovascular Strain",
        description: `Days where heart rate reached ${CARDIO_STRAIN_HR_THRESHOLD_BPM}+ BPM, ACGIH's approximate excessive-heat-strain range.`,
      },
      electrolyteRisk: {
        days: electrolyteRiskDays,
        bucket: electrolyteBucket,
        title: "Electrolyte / Heat-Cramp Risk",
        description:
          "Days with prolonged heavy exertion in high heat -- the NIOSH/OSHA-recognized combination " +
          "behind heat cramps and the trigger for electrolyte-replacement guidance.",
      },
      dehydrationTrend: {
        status: trend.status,
        deltaBpm: trend.deltaBpm,
        bucket: trendBucket,
        title: "Dehydration Trend",
        description: trend.label,
      },
    },
  };
}

module.exports = {
  CLASS_NAMES,
  classNameFromIndex,
  HEAT_STRAIN_FRACTION_THRESHOLD,
  CARDIO_STRAIN_HR_THRESHOLD_BPM,
  HEAVY_EXERTION_HEAT_INDEX_C,
  HEAVY_EXERTION_HR_BPM,
  ELECTROLYTE_RISK_FRACTION_THRESHOLD,
  dateKeyUTC,
  emptyDailyStats,
  computeHeatStrainDay,
  computeCardiovascularStrainDay,
  computeElectrolyteRiskDay,
  foldReadingIntoDailyStats,
  dailyAverages,
  dehydrationTrend,
  severityBucket,
  thirtyDayRisk,
};
