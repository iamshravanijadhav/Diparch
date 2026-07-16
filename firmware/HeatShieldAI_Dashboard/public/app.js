// app.js
// ------
// HeatShieldAI Dashboard frontend. Vanilla JS.
//
// Auth gate: nothing renders until we know who's signed in and what role
// they have. Workers and supervisors both sign in with phone number +
// password (no SMS OTP yet -- deferred, see README) via Firebase Auth's
// email/password provider under the hood, using a synthetic email derived
// from the phone number (mirrors ../src/auth.js exactly -- keep both in
// sync if that logic ever changes). Once signed in:
//   - Supervisors get the existing hash-routed grid/detail dashboard,
//     hash-routed:  #/  -> grid,  #/worker/<id> -> detail
//     plus a device-management panel (allocate/unallocate/erase) on the
//     detail view.
//   - Workers skip routing entirely and see only their one allocated
//     device (this project's "one device per worker, strictly" rule),
//     reusing the same detail view minus the management panel.
//
// The frontend never talks to Firestore directly -- Firebase Auth is used
// ONLY to establish identity (get an ID token); every actual data read/
// write goes through this project's own Express API, which verifies that
// token server-side on every request.

const root = document.getElementById("app-root");
const headerMeta = document.getElementById("header-meta");
const headerUser = document.getElementById("header-user");

const CLASS_META = [
  { name: "SAFE", label: "Safe", badge: "status-badge--safe" },
  { name: "WARNING", label: "Warning", badge: "status-badge--warning" },
  { name: "DANGER", label: "Danger", badge: "status-badge--danger" },
  { name: "CRITICAL", label: "Critical", badge: "status-badge--critical" },
];

const RISK_BUCKET_COLOR = {
  low: "var(--status-good)",
  moderate: "var(--status-warning)",
  high: "var(--status-critical)",
};

const BUCKET_LABEL = { low: "Low", moderate: "Moderate", high: "High" };
function bucketLabel(bucket) {
  return BUCKET_LABEL[bucket] || "Unknown";
}

// The fuller list of conditions linked to repeated/prolonged occupational
// heat exposure (per NIOSH/OSHA/clinical sources — see sources cited in
// heatStrain.js and this project's README). Only four of these are actually
// computed from sensor data as indicators above (heat strain, cardiovascular
// strain, electrolyte/cramp risk, dehydration trend); the rest are shown
// here purely as context for why those four matter, NOT as tracked metrics
// — HeatShieldAI has no sensor data source for productivity, absenteeism,
// or a clinical diagnosis of any of these, and doesn't claim to.
const HEAT_EXPOSURE_CONDITIONS = [
  "Heat stress",
  "Heat exhaustion",
  "Chronic dehydration",
  "Fatigue",
  "Electrolyte imbalance",
  "Muscle cramps",
  "Cardiovascular stress",
  "Kidney stress",
  "Reduced productivity",
  "Increased absenteeism",
];

const METRICS = [
  { key: "avgHeatIndexC", label: "Heat Index", unit: "°C" },
  { key: "avgTemperatureC", label: "Temperature", unit: "°C" },
  { key: "avgHeartRateBpm", label: "Heart Rate", unit: "BPM" },
  { key: "avgSpo2Pct", label: "SpO2", unit: "%" },
];

const SYNTHETIC_EMAIL_DOMAIN = "heatshieldai.local";

let pollTimer = null;
let mapInstance = null;
let mapMarker = null;
let chartInstance = null;
let activeMetricIndex = 0;

let currentProfile = null; // { uid, phoneNumber, role, name } from /api/auth/me
let loginState = { role: "worker", mode: "signin" };

// ---------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------

function statusMeta(predictedClass) {
  if (predictedClass === null || predictedClass === undefined || !CLASS_META[predictedClass]) {
    return { name: "UNKNOWN", label: "No data", badge: "status-badge--unknown" };
  }
  return CLASS_META[predictedClass];
}

function statusBadgeHtml(predictedClass, { size } = {}) {
  const meta = statusMeta(predictedClass);
  const sizeAttr = size === "lg" ? ' style="font-size:14px;padding:6px 14px;"' : "";
  return `<span class="status-badge ${meta.badge}"${sizeAttr}><span class="status-badge__dot"></span>${meta.label}</span>`;
}

function fmt(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(digits);
}

function relativeTime(isoString) {
  if (!isoString) return "never";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Auth: phone+password via Firebase Auth's email/password provider
// (synthetic email -- see the file-level comment for why)
// ---------------------------------------------------------------------

function normalizePhoneClient(rawPhone) {
  if (typeof rawPhone !== "string") return null;
  const trimmed = rawPhone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return (hasPlus ? "+" : "") + digits;
}

function phoneToSyntheticEmail(normalizedPhone) {
  const digitsOnly = normalizedPhone.replace(/\D/g, "");
  return `${digitsOnly}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

function friendlyAuthError(err) {
  const code = err && err.code;
  const map = {
    "auth/email-already-in-use": "That phone number is already registered — try signing in instead.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect phone number or password.",
    "auth/user-not-found": "No account with that phone number — try signing up instead.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  };
  return map[code] || (err && err.message) || "Something went wrong. Please try again.";
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const user = firebase.auth().currentUser;
  const headers = { "Content-Type": "application/json" };
  if (user) {
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    await handleSignOut("Your session expired — please sign in again.");
    throw new Error("Session expired.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request to ${path} failed (${res.status})`);
  }
  return data;
}

async function handleSignOut(message) {
  stopPolling();
  try {
    await firebase.auth().signOut();
  } catch (err) {
    /* ignore */
  }
  currentProfile = null;
  renderLoginScreen(message || null);
}

async function initApp() {
  let config;
  try {
    config = await (await fetch("/api/firebase-config")).json();
  } catch (err) {
    root.innerHTML = `<div class="empty-state"><h3>Couldn't load app configuration</h3><p>${err.message}</p></div>`;
    return;
  }

  if (!config.apiKey) {
    root.innerHTML = `
      <div class="empty-state">
        <h3>Firebase Web SDK isn't configured yet</h3>
        <p>Set FIREBASE_WEB_API_KEY, FIREBASE_WEB_AUTH_DOMAIN, FIREBASE_WEB_PROJECT_ID and FIREBASE_WEB_APP_ID in this backend's .env — see README.md.</p>
      </div>`;
    return;
  }

  firebase.initializeApp(config);

  // Opt-in only (?emulator=1): points the client at a local Firebase Auth
  // emulator instead of real Firebase, for local testing against
  // `firebase emulators:start`. Never triggers in normal use.
  if (new URLSearchParams(window.location.search).get("emulator") === "1") {
    firebase.auth().useEmulator("http://localhost:9099", { disableWarnings: true });
  }

  firebase.auth().onAuthStateChanged((user) => {
    // Suppressed during handleLoginSubmit(): sign-up needs its own
    // /api/auth/register call to finish creating the Firestore profile
    // BEFORE /api/auth/me is fetched, but this listener fires the instant
    // the Firebase Auth account exists -- letting it call
    // loadProfileAndRoute() here too would race register() and 401 (no
    // profile yet). handleLoginSubmit calls loadProfileAndRoute() itself
    // once it's actually safe to.
    if (suppressAuthStateHandler) return;
    if (user) {
      loadProfileAndRoute();
    } else if (!currentProfile) {
      renderLoginScreen();
    }
  });
}

let suppressAuthStateHandler = false;

async function loadProfileAndRoute() {
  root.innerHTML = `<div class="spinner-row">Signing in&hellip;</div>`;
  try {
    const { user } = await apiRequest("/api/auth/me");
    currentProfile = user;
  } catch (err) {
    return; // apiRequest already handled 401 -> back to login; other errors just stop here
  }
  renderHeaderUser();
  route();
}

function renderHeaderUser() {
  if (!currentProfile) {
    headerUser.innerHTML = "";
    return;
  }
  headerUser.innerHTML = `
    <span class="role-pill">${currentProfile.role}</span>
    <span>${escapeHtml(currentProfile.name || currentProfile.phoneNumber)}</span>
    <button class="btn btn-sm" id="logout-btn">Sign out</button>
  `;
  document.getElementById("logout-btn").addEventListener("click", () => handleSignOut());
}

// ---------------------------------------------------------------------
// Login / signup screen
// ---------------------------------------------------------------------

function renderLoginScreen(message) {
  stopPolling();
  headerUser.innerHTML = "";
  headerMeta.textContent = "—";

  const isSignup = loginState.mode === "signup";
  const isSupervisor = loginState.role === "supervisor";

  root.innerHTML = `
    <div class="login-wrap">
      <h2>HeatShieldAI</h2>
      <p class="login-subtitle">${isSignup ? "Create an account" : "Sign in"} to continue</p>

      <div class="role-tabs">
        <button type="button" class="role-tab${loginState.role === "worker" ? " is-active" : ""}" data-role="worker">Worker</button>
        <button type="button" class="role-tab${isSupervisor ? " is-active" : ""}" data-role="supervisor">Supervisor</button>
      </div>

      ${message ? `<div class="form-error">${escapeHtml(message)}</div>` : ""}
      <div class="form-error" id="login-error" style="display:none;"></div>

      <form id="login-form">
        <div class="form-field">
          <label for="phone-input">Phone number</label>
          <input id="phone-input" type="tel" placeholder="e.g. 9876543210" autocomplete="tel" required />
        </div>
        ${
          isSignup
            ? `<div class="form-field">
                <label for="name-input">Name (optional)</label>
                <input id="name-input" type="text" placeholder="Your name" autocomplete="name" />
              </div>`
            : ""
        }
        <div class="form-field">
          <label for="password-input">Password</label>
          <input id="password-input" type="password" placeholder="${isSignup ? "At least 6 characters" : "Password"}" autocomplete="${isSignup ? "new-password" : "current-password"}" required />
        </div>
        ${
          isSignup && isSupervisor
            ? `<div class="form-field">
                <label for="code-input">Supervisor signup code</label>
                <input id="code-input" type="password" placeholder="Ask your admin for this" autocomplete="off" required />
              </div>`
            : ""
        }
        <button type="submit" class="btn btn-primary" id="submit-btn" style="width:100%;">
          ${isSignup ? "Sign up" : "Sign in"} as ${isSupervisor ? "supervisor" : "worker"}
        </button>
      </form>

      <div class="form-switch-mode">
        ${isSignup ? "Already have an account?" : "Don't have an account?"}
        <button type="button" id="switch-mode-btn">${isSignup ? "Sign in" : "Sign up"}</button>
      </div>
    </div>
  `;

  root.querySelectorAll(".role-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      loginState.role = tab.dataset.role;
      renderLoginScreen();
    });
  });
  document.getElementById("switch-mode-btn").addEventListener("click", () => {
    loginState.mode = isSignup ? "signin" : "signup";
    renderLoginScreen();
  });
  document.getElementById("login-form").addEventListener("submit", handleLoginSubmit);
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const errorBox = document.getElementById("login-error");
  const submitBtn = document.getElementById("submit-btn");
  errorBox.style.display = "none";

  const rawPhone = document.getElementById("phone-input").value;
  const password = document.getElementById("password-input").value;
  const normalizedPhone = normalizePhoneClient(rawPhone);

  if (!normalizedPhone) {
    errorBox.textContent = "Enter a valid phone number (7-15 digits).";
    errorBox.style.display = "block";
    return;
  }

  const email = phoneToSyntheticEmail(normalizedPhone);
  submitBtn.disabled = true;
  suppressAuthStateHandler = true;

  try {
    if (loginState.mode === "signup") {
      const name = document.getElementById("name-input")?.value || "";
      const supervisorCode = document.getElementById("code-input")?.value || "";

      await firebase.auth().createUserWithEmailAndPassword(email, password);
      try {
        await apiRequest("/api/auth/register", {
          method: "POST",
          body: { phoneNumber: normalizedPhone, role: loginState.role, name, supervisorCode },
        });
      } catch (registerErr) {
        // Backend already deleted the orphaned Firebase Auth account (e.g.
        // wrong supervisor code) -- keep the client in sync with that.
        await firebase.auth().signOut().catch(() => {});
        throw registerErr;
      }
    } else {
      await firebase.auth().signInWithEmailAndPassword(email, password);
    }
    // Now that signup's /api/auth/register (if any) has actually finished,
    // it's safe to fetch the profile -- see the onAuthStateChanged comment.
    suppressAuthStateHandler = false;
    await loadProfileAndRoute();
  } catch (err) {
    suppressAuthStateHandler = false;
    errorBox.textContent = friendlyAuthError(err);
    errorBox.style.display = "block";
    submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function route() {
  if (!currentProfile) return; // login screen already showing
  stopPolling();

  if (currentProfile.role !== "supervisor") {
    renderWorkerHome();
    return;
  }

  const hash = window.location.hash || "#/";
  const workerMatch = hash.match(/^#\/worker\/([^/]+)$/);
  if (workerMatch) {
    renderDetail(decodeURIComponent(workerMatch[1]));
  } else {
    renderGrid();
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", initApp);

// ---------------------------------------------------------------------
// Worker home (single allocated device, no grid/routing)
// ---------------------------------------------------------------------

async function renderWorkerHome() {
  root.innerHTML = `<div class="spinner-row">Loading your device&hellip;</div>`;
  headerMeta.textContent = "—";

  let data;
  try {
    data = await apiRequest("/api/workers");
  } catch (err) {
    root.innerHTML = `<div class="empty-state"><h3>Couldn't load your device</h3><p>${err.message}</p></div>`;
    return;
  }

  if (data.workers.length === 0) {
    headerMeta.textContent = "—";
    root.innerHTML = `
      <div class="empty-state">
        <h3>No device allocated to you yet</h3>
        <p>Ask your supervisor to allocate a device to your phone number (<strong>${escapeHtml(currentProfile.phoneNumber)}</strong>).</p>
      </div>`;
    return;
  }

  renderDetail(data.workers[0].workerId, { allowBack: false });
}

// ---------------------------------------------------------------------
// Grid view (supervisor only)
// ---------------------------------------------------------------------

async function renderGrid() {
  root.innerHTML = `<div class="spinner-row">Loading workers&hellip;</div>`;
  headerMeta.textContent = "—";

  async function load() {
    let data;
    try {
      data = await apiRequest("/api/workers");
    } catch (err) {
      root.innerHTML = `<div class="empty-state"><h3>Couldn't reach the backend</h3><p>${err.message}</p></div>`;
      return;
    }

    let workers = data.workers;
    if (!workers.some((w) => w.workerId === "worker1")) {
      // worker1 is the real device; show a waiting placeholder so it's
      // clear the dashboard is working correctly and just hasn't heard
      // from the hardware yet, rather than looking like it's missing.
      workers = [
        {
          workerId: "worker1",
          name: "worker1",
          site: "Real device",
          deviceType: "real",
          latest: null,
          lastSeenAt: null,
          waiting: true,
        },
        ...workers,
      ];
    }

    headerMeta.textContent = `${workers.length} worker${workers.length === 1 ? "" : "s"} · updated ${new Date().toLocaleTimeString()}`;

    if (workers.length === 0) {
      root.innerHTML = `
        <div class="empty-state">
          <h3>No worker data yet</h3>
          <p>Once the gateway forwards a reading, or you run <code>npm run seed</code> for example workers, they'll show up here.</p>
        </div>`;
      return;
    }

    root.innerHTML = `<div class="worker-grid">${workers.map(workerCardHtml).join("")}</div>`;
    root.querySelectorAll(".worker-card").forEach((card) => {
      card.addEventListener("click", () => {
        window.location.hash = `#/worker/${encodeURIComponent(card.dataset.workerId)}`;
      });
    });
  }

  await load();
  pollTimer = setInterval(load, 5000);
}

function workerCardHtml(worker) {
  const latest = worker.latest;
  return `
    <button class="worker-card" data-worker-id="${worker.workerId}">
      <div class="worker-card__top">
        <div>
          <p class="worker-card__name">${escapeHtml(worker.name)}</p>
          <p class="worker-card__site">${escapeHtml(worker.site)}</p>
        </div>
        ${statusBadgeHtml(latest ? latest.predictedClass : null)}
      </div>
      <div class="worker-card__stats">
        <div class="mini-stat">
          <span class="mini-stat__label">Heat Index</span>
          <span class="mini-stat__value">${latest ? fmt(latest.heatIndexC) + "°C" : "—"}</span>
        </div>
        <div class="mini-stat">
          <span class="mini-stat__label">Heart Rate</span>
          <span class="mini-stat__value">${latest && latest.fingerPresent ? fmt(latest.heartRateBpm, 0) : "—"}</span>
        </div>
        <div class="mini-stat">
          <span class="mini-stat__label">SpO2</span>
          <span class="mini-stat__value">${latest && latest.fingerPresent ? fmt(latest.spo2Pct, 0) + "%" : "—"}</span>
        </div>
      </div>
      <div class="worker-card__footer">
        <span>${worker.allocatedToName || worker.allocatedToPhone ? `Allocated: ${escapeHtml(worker.allocatedToName || worker.allocatedToPhone)}` : worker.deviceType === "real" ? "Live device" : "Example data"}</span>
        <span>${worker.waiting ? "Waiting for first reading…" : relativeTime(worker.lastSeenAt)}</span>
      </div>
    </button>`;
}

// ---------------------------------------------------------------------
// Detail view (shared by supervisor drill-down and worker home)
// ---------------------------------------------------------------------

async function renderDetail(workerId, { allowBack = true } = {}) {
  root.innerHTML = `<div class="spinner-row">Loading ${escapeHtml(workerId)}&hellip;</div>`;
  headerMeta.textContent = "—";
  activeMetricIndex = 0;

  async function load(isFirstLoad) {
    let w;
    try {
      w = await apiRequest(`/api/workers/${encodeURIComponent(workerId)}`);
    } catch (err) {
      const isWaitingOnRealDevice = workerId === "worker1" && /no worker with id/i.test(err.message);
      root.innerHTML = isWaitingOnRealDevice
        ? `
        <div class="empty-state">
          <h3>Waiting for worker1's first reading</h3>
          <p>worker1 is reserved for the real device. This page will populate automatically once the gateway forwards its first reading -- no action needed here.</p>
          ${allowBack ? `<p><a href="#/">&larr; Back to all workers</a></p>` : ""}
        </div>`
        : `
        <div class="empty-state">
          <h3>Couldn't load ${escapeHtml(workerId)}</h3>
          <p>${escapeHtml(err.message)}</p>
          ${allowBack ? `<p><a href="#/">&larr; Back to all workers</a></p>` : ""}
        </div>`;
      return;
    }

    headerMeta.textContent = `Updated ${new Date().toLocaleTimeString()}`;

    if (isFirstLoad) {
      root.innerHTML = detailShellHtml(w, { allowBack });
      wireDetailInteractions(w, { allowBack });
    } else {
      updateDetailLiveParts(w);
    }
  }

  await load(true);
  pollTimer = setInterval(() => load(false), 5000);
}

function detailShellHtml(w, { allowBack }) {
  const latest = w.latest;
  const isSupervisor = currentProfile && currentProfile.role === "supervisor";
  return `
    <div class="detail-header">
      ${allowBack ? `<button class="back-button" id="back-btn">&larr; All workers</button>` : ""}
      <div>
        <h2>${escapeHtml(w.name)} <span style="font-weight:400;color:var(--text-muted);font-size:14px;">(${escapeHtml(w.workerId)})</span></h2>
        <div class="detail-header__site">${escapeHtml(w.site)} · ${w.deviceType === "real" ? "Live device" : "Example data"}</div>
      </div>
    </div>

    <div class="stat-tile-row" id="stat-tiles">
      ${statTileRowHtml(latest)}
    </div>

    <div class="panel-grid">
      <div class="panel">
        <h3>Location</h3>
        <div id="map"></div>
        <div class="map-caption" id="map-caption">
          ${latest && latest.gpsFixValid ? `${fmt(latest.latitude, 5)}, ${fmt(latest.longitude, 5)} · ${latest.satellites} satellites` : "No GPS fix yet"}
        </div>
      </div>

      <div class="panel">
        <h3>30-day overall risk</h3>
        <div class="risk-count">${bucketLabel(w.risk.bucket)}<span class="risk-count-unit"> over ${w.risk.totalDays} days</span></div>
        <div class="meter-track">
          <div class="meter-fill" style="width:${Math.min(100, (w.risk.heatStrainDays / 30) * 100)}%;background:${RISK_BUCKET_COLOR[w.risk.bucket]};"></div>
        </div>
        <div class="meter-scale"><span>0</span><span>3 (moderate)</span><span>7 (high)</span><span>30</span></div>
        <p class="risk-label">Worst of the 4 indicators below — see the full breakdown for specifics.</p>
      </div>
    </div>

    ${longTermRiskPanelHtml(w.risk)}

    ${isSupervisor ? managementPanelHtml(w) : ""}

    <div class="panel" style="margin-bottom:20px;">
      <h3>
        <span>Trend (last ${w.history.length} days)</span>
        <span class="metric-tabs" id="metric-tabs">
          ${METRICS.map((m, i) => `<button class="metric-tab${i === 0 ? " is-active" : ""}" data-metric-index="${i}">${m.label}</button>`).join("")}
        </span>
      </h3>
      <div class="chart-wrap"><canvas id="trend-chart"></canvas></div>
      <div class="daily-status-strip" id="daily-status-strip"></div>
    </div>

    <div class="panel">
      <h3>Recent readings</h3>
      <div class="readings-table-wrap">
        <table class="readings-table">
          <thead>
            <tr>
              <th>Time</th><th>Status</th><th>Temp</th><th>Humidity</th><th>Heart Rate</th>
              <th>SpO2</th><th>Heat Index</th><th>Confidence</th><th>GPS</th><th>Link (RSSI/SNR)</th>
            </tr>
          </thead>
          <tbody id="readings-tbody">
            ${readingsRowsHtml(w.recentReadings)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function riskIndicatorCardHtml(indicator, valueHtml) {
  return `
    <div class="risk-indicator-card" data-bucket="${indicator.bucket}">
      <div class="risk-indicator-card__title">
        <span>${escapeHtml(indicator.title)}</span>
        <span class="risk-indicator-card__tier">${bucketLabel(indicator.bucket)}</span>
      </div>
      <div class="risk-indicator-card__value">${valueHtml}</div>
      <div class="risk-indicator-card__desc">${escapeHtml(indicator.description)}</div>
    </div>`;
}

function longTermRiskPanelHtml(risk) {
  const ind = risk.indicators;
  const trendValue =
    ind.dehydrationTrend.status === "insufficient_data"
      ? "—"
      : ind.dehydrationTrend.status === "rising"
        ? `+${fmt(ind.dehydrationTrend.deltaBpm, 1)}<span class="risk-indicator-card__value-unit">BPM ↑</span>`
        : `${fmt(ind.dehydrationTrend.deltaBpm, 1)}<span class="risk-indicator-card__value-unit">BPM</span>`;

  return `
    <div class="panel" style="margin-bottom:20px;">
      <h3>Long-term heat-exposure risk indicators</h3>
      <p class="risk-label" style="margin-top:0;">
        A single reading can look fine even while strain quietly builds up over weeks. These four
        indicators are computed from this device's stored history to surface patterns a single reading can't —
        they flag risk patterns, they do not diagnose any condition.
      </p>
      <div class="risk-indicator-grid">
        ${riskIndicatorCardHtml(ind.heatStrain, `${ind.heatStrain.days}<span class="risk-indicator-card__value-unit">/ 30 days</span>`)}
        ${riskIndicatorCardHtml(ind.cardiovascularStrain, `${ind.cardiovascularStrain.days}<span class="risk-indicator-card__value-unit">/ 30 days</span>`)}
        ${riskIndicatorCardHtml(ind.electrolyteRisk, `${ind.electrolyteRisk.days}<span class="risk-indicator-card__value-unit">/ 30 days</span>`)}
        ${riskIndicatorCardHtml(ind.dehydrationTrend, trendValue)}
      </div>

      <details class="why-matters">
        <summary>Why this matters</summary>
        <div class="why-matters-body">
          <p>Heat stroke is only the final, acute stage. The real problem is that workers can spend
          8-10 hours a day under extreme heat, which causes continuous physiological stress. Over weeks
          and months, that repeated stress is linked to:</p>
          <div class="condition-chip-row">
            ${HEAT_EXPOSURE_CONDITIONS.map((c) => `<span class="condition-chip">${escapeHtml(c)}</span>`).join("")}
          </div>
          <p>HeatShieldAI is <strong>not diagnosing any of these.</strong> The on-device model only ever
          classifies the current reading (SAFE/WARNING/DANGER/CRITICAL). The four indicators above are a
          transparent, rule-based layer on top of that — identifying risk patterns, repeated heat exposure,
          and early warning trends from this device's history, before health visibly deteriorates. Reduced
          productivity and absenteeism are real downstream costs of the conditions above, but aren't
          something this wearable can measure directly, so they aren't tracked as metrics here.</p>
        </div>
      </details>
    </div>`;
}

function managementPanelHtml(w) {
  const isAllocated = !!w.allocatedToPhone;
  return `
    <div class="panel" style="margin-bottom:20px;" id="management-panel">
      <h3>Device management</h3>
      <div class="allocation-status" id="allocation-status">
        ${isAllocated ? `Allocated to <strong>${escapeHtml(w.allocatedToName || w.allocatedToPhone)}</strong> (${escapeHtml(w.allocatedToPhone)})` : "Not allocated to any worker."}
      </div>
      <div class="management-row">
        <select id="allocate-select"><option value="">Loading registered workers&hellip;</option></select>
        <button class="btn btn-primary btn-sm" id="allocate-btn">Allocate</button>
        ${isAllocated ? `<button class="btn btn-sm" id="unallocate-btn">Unallocate</button>` : ""}
      </div>
      <div class="management-divider"></div>
      <button class="btn btn-danger btn-sm" id="erase-btn">Erase all data for this device</button>
      <div class="form-error" id="management-error" style="display:none;margin-top:10px;"></div>
    </div>
  `;
}

function wireDetailInteractions(w, { allowBack }) {
  if (allowBack) {
    document.getElementById("back-btn").addEventListener("click", () => {
      window.location.hash = "#/";
    });
  }

  document.querySelectorAll(".metric-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activeMetricIndex = Number(tab.dataset.metricIndex);
      document.querySelectorAll(".metric-tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      renderTrendChart(w.history);
    });
  });

  renderMap(w.latest);
  renderTrendChart(w.history);
  renderDailyStatusStrip(w.history);

  if (currentProfile && currentProfile.role === "supervisor") {
    wireManagementPanel(w);
  }
}

async function wireManagementPanel(w) {
  const select = document.getElementById("allocate-select");
  const errorBox = document.getElementById("management-error");

  try {
    const { workers } = await apiRequest("/api/supervisor/registered-workers");
    if (workers.length === 0) {
      select.innerHTML = `<option value="">No registered workers yet</option>`;
    } else {
      select.innerHTML = workers
        .map((rw) => {
          const label = `${rw.name || rw.phoneNumber} (${rw.phoneNumber})${rw.allocatedDeviceId ? ` — currently: ${rw.allocatedDeviceId}` : ""}`;
          return `<option value="${escapeHtml(rw.phoneNumber)}">${escapeHtml(label)}</option>`;
        })
        .join("");
    }
  } catch (err) {
    select.innerHTML = `<option value="">Couldn't load registered workers</option>`;
  }

  document.getElementById("allocate-btn").addEventListener("click", async () => {
    const phoneNumber = select.value;
    if (!phoneNumber) return;
    errorBox.style.display = "none";
    try {
      await apiRequest("/api/supervisor/allocate", { method: "POST", body: { workerId: w.workerId, phoneNumber } });
      renderDetail(w.workerId, { allowBack: true });
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });

  const unallocateBtn = document.getElementById("unallocate-btn");
  if (unallocateBtn) {
    unallocateBtn.addEventListener("click", async () => {
      errorBox.style.display = "none";
      try {
        await apiRequest("/api/supervisor/unallocate", { method: "POST", body: { workerId: w.workerId } });
        renderDetail(w.workerId, { allowBack: true });
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = "block";
      }
    });
  }

  document.getElementById("erase-btn").addEventListener("click", async () => {
    const confirmed = window.confirm(
      `Erase all readings and history for ${w.workerId}? This cannot be undone. The device profile and allocation will stay intact.`
    );
    if (!confirmed) return;
    errorBox.style.display = "none";
    try {
      await apiRequest("/api/supervisor/erase", { method: "POST", body: { workerId: w.workerId } });
      renderDetail(w.workerId, { allowBack: true });
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = "block";
    }
  });
}

function statTileRowHtml(latest) {
  return `
    <div class="stat-tile">
      <div class="stat-tile__label">Status</div>
      <div class="stat-tile__value" style="font-size:16px;">${statusBadgeHtml(latest ? latest.predictedClass : null, { size: "lg" })}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__label">Heat Index</div>
      <div class="stat-tile__value">${latest ? fmt(latest.heatIndexC) : "—"}<span class="stat-tile__unit">°C</span></div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__label">Temperature</div>
      <div class="stat-tile__value">${latest ? fmt(latest.temperatureC) : "—"}<span class="stat-tile__unit">°C</span></div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__label">Humidity</div>
      <div class="stat-tile__value">${latest ? fmt(latest.humidityPct) : "—"}<span class="stat-tile__unit">%</span></div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__label">Heart Rate</div>
      <div class="stat-tile__value">${latest && latest.fingerPresent ? fmt(latest.heartRateBpm, 0) : "—"}<span class="stat-tile__unit">BPM</span></div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__label">SpO2</div>
      <div class="stat-tile__value">${latest && latest.fingerPresent ? fmt(latest.spo2Pct, 0) : "—"}<span class="stat-tile__unit">%</span></div>
    </div>
    <div class="stat-tile">
      <div class="stat-tile__label">Confidence</div>
      <div class="stat-tile__value">${latest ? fmt(latest.confidencePercent, 0) : "—"}<span class="stat-tile__unit">%</span></div>
    </div>
  `;
}

function readingsRowsHtml(readings) {
  if (!readings || readings.length === 0) {
    return `<tr><td colspan="10" style="color:var(--text-muted);">No readings yet.</td></tr>`;
  }
  return readings
    .map((r) => {
      const time = r.receivedAt ? new Date(r.receivedAt).toLocaleString() : "—";
      const gps = r.gpsFixValid ? `${fmt(r.latitude, 4)}, ${fmt(r.longitude, 4)}` : "—";
      const link = r.rssi !== null && r.rssi !== undefined ? `${r.rssi} dBm / ${fmt(r.snr, 1)} dB` : "—";
      return `
        <tr>
          <td>${time}</td>
          <td>${statusBadgeHtml(r.predictedClass)}</td>
          <td>${fmt(r.temperatureC)}°C</td>
          <td>${fmt(r.humidityPct)}%</td>
          <td>${r.fingerPresent ? fmt(r.heartRateBpm, 0) : "—"}</td>
          <td>${r.fingerPresent ? fmt(r.spo2Pct, 0) + "%" : "—"}</td>
          <td>${fmt(r.heatIndexC)}°C</td>
          <td>${fmt(r.confidencePercent, 0)}%</td>
          <td>${gps}</td>
          <td>${link}</td>
        </tr>`;
    })
    .join("");
}

// Refreshes only the parts of the detail view that change every poll
// (stat tiles, map marker, table) -- avoids tearing down/rebuilding the
// chart, map, and management panel on every 5s refresh.
function updateDetailLiveParts(w) {
  const statTiles = document.getElementById("stat-tiles");
  if (statTiles) statTiles.innerHTML = statTileRowHtml(w.latest);

  const tbody = document.getElementById("readings-tbody");
  if (tbody) tbody.innerHTML = readingsRowsHtml(w.recentReadings);

  const mapCaption = document.getElementById("map-caption");
  if (mapCaption) {
    mapCaption.textContent =
      w.latest && w.latest.gpsFixValid
        ? `${fmt(w.latest.latitude, 5)}, ${fmt(w.latest.longitude, 5)} · ${w.latest.satellites} satellites`
        : "No GPS fix yet";
  }
  updateMapMarker(w.latest);
}

// ---------------------------------------------------------------------
// Map (Leaflet, OpenStreetMap tiles -- no API key required)
// ---------------------------------------------------------------------

function renderMap(latest) {
  const mapEl = document.getElementById("map");
  if (!mapEl || typeof L === "undefined") return;

  const hasFix = latest && latest.gpsFixValid;
  const center = hasFix ? [latest.latitude, latest.longitude] : [20.5937, 78.9629]; // India centroid fallback
  const zoom = hasFix ? 16 : 4;

  mapInstance = L.map(mapEl).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(mapInstance);

  if (hasFix) {
    mapMarker = L.marker(center).addTo(mapInstance);
  }
}

function updateMapMarker(latest) {
  if (!mapInstance) return;
  const hasFix = latest && latest.gpsFixValid;
  if (!hasFix) return;
  const center = [latest.latitude, latest.longitude];
  if (mapMarker) {
    mapMarker.setLatLng(center);
  } else {
    mapMarker = L.marker(center).addTo(mapInstance);
  }
  mapInstance.panTo(center);
}

// ---------------------------------------------------------------------
// Trend chart (Chart.js) -- single metric at a time (never dual-axis)
// ---------------------------------------------------------------------

function renderTrendChart(history) {
  const canvas = document.getElementById("trend-chart");
  if (!canvas || typeof Chart === "undefined") return;

  const metric = METRICS[activeMetricIndex];
  const labels = history.map((d) => d.date.slice(5)); // "MM-DD"
  const values = history.map((d) => d[metric.key]);

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${metric.label} (${metric.unit})`,
          data: values,
          borderColor: cssVar("--series-1"),
          backgroundColor: cssVar("--series-1") + "1a",
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: cssVar("--series-1"),
          pointBorderColor: cssVar("--surface-1"),
          pointBorderWidth: 2,
          tension: 0.25,
          fill: true,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${metric.label}: ${fmt(ctx.parsed.y)} ${metric.unit}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: cssVar("--gridline") },
          ticks: { color: cssVar("--text-muted"), maxRotation: 0, autoSkip: true },
        },
        y: {
          grid: { color: cssVar("--gridline") },
          ticks: { color: cssVar("--text-muted") },
        },
      },
    },
  });
}

function renderDailyStatusStrip(history) {
  const strip = document.getElementById("daily-status-strip");
  if (!strip) return;

  strip.innerHTML = history
    .map((day) => {
      const dominant = dominantClassIndex(day.classCounts);
      const meta = statusMeta(dominant);
      const color =
        meta.name === "SAFE"
          ? "var(--status-good)"
          : meta.name === "WARNING"
            ? "var(--status-warning)"
            : meta.name === "DANGER"
              ? "var(--status-serious)"
              : meta.name === "CRITICAL"
                ? "var(--status-critical)"
                : "var(--gridline)";
      const title = `${day.date}: mostly ${meta.label}${day.heatStrainDay ? " — heat-strain day" : ""}`;
      return `<div class="daily-status-dot" style="background:${color};" title="${title}"></div>`;
    })
    .join("");
}

function dominantClassIndex(classCounts) {
  if (!classCounts) return null;
  let bestIndex = null;
  let bestCount = -1;
  CLASS_META.forEach((meta, i) => {
    const count = classCounts[meta.name] || 0;
    if (count > bestCount) {
      bestCount = count;
      bestIndex = i;
    }
  });
  return bestCount > 0 ? bestIndex : null;
}
