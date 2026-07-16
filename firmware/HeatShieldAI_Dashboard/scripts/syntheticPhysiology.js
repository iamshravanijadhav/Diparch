// syntheticPhysiology.js
// -----------------------
// Mirrors HeatShieldAI/training/generate_dataset.py and common.py's
// class-conditional distributions and Heat Index formula, so the dashboard's
// dummy worker data is generated from the SAME physiologically-grounded
// numbers the TinyML model was actually trained on (see that project's
// README "How Labels Are Generated" section for the sourcing/rationale).
//
// This is a deliberate, minimal port -- not a shared module -- because the
// Python training pipeline and this Node backend are separate deployables.
// If HeatShieldAI/training/generate_dataset.py's CLASS_DISTRIBUTIONS ever
// change (e.g. a future retrain), update the numbers below to match.

const CLASS_NAMES = ["SAFE", "WARNING", "DANGER", "CRITICAL"];

const CLASS_DISTRIBUTIONS = {
  SAFE: { Temperature: [26.0, 3.5], Humidity: [45.0, 16.0], HeartRate: [90.0, 15.0], SpO2: [98.0, 1.0] },
  WARNING: { Temperature: [32.0, 3.0], Humidity: [55.0, 16.0], HeartRate: [125.0, 12.0], SpO2: [96.5, 1.3] },
  DANGER: { Temperature: [37.0, 2.8], Humidity: [65.0, 15.0], HeartRate: [148.0, 10.0], SpO2: [94.5, 1.5] },
  CRITICAL: { Temperature: [41.5, 2.8], Humidity: [75.0, 14.0], HeartRate: [170.0, 12.0], SpO2: [92.0, 2.0] },
};

const GLOBAL_BOUNDS = {
  Temperature: [18.0, 48.0],
  Humidity: [10.0, 98.0],
  HeartRate: [50.0, 190.0],
  SpO2: [88.0, 100.0],
};

function clip(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

// Deterministic seeded PRNG (mulberry32) so re-running the seed script
// without --force produces the same numbers, and so this file has zero
// external dependencies.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform for a normal(mean, std) sample from a uniform RNG.
function gaussian(rng, mean, std) {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * std;
}

// Same Australian BOM Apparent Temperature formula as
// HeatShieldAI/training/common.py's heat_index_celsius() (ws=0, no
// anemometer) -- kept numerically identical so dummy HeatIndex values are
// consistent with what a real node would compute.
function heatIndexCelsius(tempC, rhPct) {
  const e = (rhPct / 100.0) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  return tempC + 0.33 * e - 4.0;
}

// Samples one reading for a given class, applying the same global clip
// bounds and the same >38C humidity-ceiling taper as generate_dataset.py's
// sample_class(). `heartRateDriftBpm` (default 0) is an optional additive
// shift -- used by the seed script to simulate gradual cardiovascular
// drift/dehydration accumulation across a month for the dehydration-trend
// demo indicator (see heatStrain.js's dehydrationTrend()); real ingested
// data never has this, it only exists for synthetic demo data.
function sampleReadingForClass(className, rng, heartRateDriftBpm = 0) {
  const dist = CLASS_DISTRIBUTIONS[className];

  let temperature = gaussian(rng, dist.Temperature[0], dist.Temperature[1]);
  let humidity = gaussian(rng, dist.Humidity[0], dist.Humidity[1]);
  let heartRate = gaussian(rng, dist.HeartRate[0], dist.HeartRate[1]) + heartRateDriftBpm;
  let spo2 = gaussian(rng, dist.SpO2[0], dist.SpO2[1]);

  temperature = clip(temperature, ...GLOBAL_BOUNDS.Temperature);
  humidity = clip(humidity, ...GLOBAL_BOUNDS.Humidity);
  heartRate = clip(heartRate, ...GLOBAL_BOUNDS.HeartRate);
  spo2 = clip(spo2, ...GLOBAL_BOUNDS.SpO2);

  const humidityCeiling = clip(98.0 - Math.max(0, temperature - 38.0) * 2.2, 45.0, 98.0);
  humidity = Math.min(humidity, humidityCeiling);

  const heatIndex = heatIndexCelsius(temperature, humidity);

  return {
    temperatureC: Math.round(temperature * 100) / 100,
    humidityPct: Math.round(humidity * 100) / 100,
    heartRateBpm: Math.round(heartRate * 10) / 10,
    spo2Pct: Math.round(spo2 * 10) / 10,
    heatIndexC: Math.round(heatIndex * 100) / 100,
  };
}

module.exports = {
  CLASS_NAMES,
  mulberry32,
  sampleReadingForClass,
};
