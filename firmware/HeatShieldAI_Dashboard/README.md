# HeatShieldAI Dashboard

Node.js/Express backend + a plain HTML/CSS/JS web dashboard for HeatShieldAI's
LoRa node → gateway → cloud pipeline. The gateway (`../HeatShieldAI_Gateway`)
forwards each reading it receives over LoRa from the sensor node
(`../HeatShieldAI`) to this backend's `/api/ingest` endpoint over WiFi; the
backend stores it in Firestore and serves a dashboard where each worker shows
up as a card you can click into for live parameters, a location map, and a
30-day heat-strain history.

**worker1 is reserved for the real device.** It only ever gets data from the
actual gateway forwarding real sensor readings — nothing seeds or fakes data
for it. `npm run seed` populates three *example* workers (worker2-4) with 30
days of synthetic history so the dashboard has something to demonstrate the
multi-worker view and the 30-day trend/risk features before you have weeks of
real data.

## Architecture

```
ESP32-S3 node          classic ESP32 gateway         this backend            browser
(sensors + GPS)  --LoRa-->  (WiFi)  --HTTP POST-->  Express + Firestore  <--fetch--  dashboard
```

The browser never talks to Firestore directly — it only calls this backend's
own REST API. Firebase credentials stay server-side.

## 1. Firebase setup (~8 minutes)

1. Go to the [Firebase Console](https://console.firebase.google.com/) → **Add project** → name it (e.g. `heatshieldai`) → **Continue** → turn off Google Analytics → **Create project**.
2. Left sidebar → **Build** → **Firestore Database** → **Create database**.
3. Pick a nearby region → **Next**.
4. Choose **Start in production mode** → **Enable**. (This backend uses a service-account key, which always bypasses Firestore security rules — you'll never need to write any. Production mode just keeps the database closed to everyone else.)
5. **⚙️ gear icon** → **Project settings** → **Service accounts** tab → **Generate new private key** → confirms and downloads a JSON file.
6. Rename it to `serviceAccountKey.json` and place it directly in this folder (`firmware/HeatShieldAI_Dashboard/`). It's gitignored — never commit it. **Guard this file like a password** — anyone who has it has full read/write access to your Firestore data, bypassing all rules.
7. Left sidebar → **Build** → **Authentication** → **Get started** → **Email/Password** → enable the first toggle (not the passwordless link one) → **Save**. (Workers and supervisors both sign in with phone number + password under the hood via this provider — see "Accounts & roles" below for why.)
8. Still in Project settings → **General** tab → scroll to **Your apps** → click the **`</>`** (Web) icon → give it any nickname → **Register app**. You'll see a `firebaseConfig` object — you need four values from it for `.env` in the next step: `apiKey`, `authDomain`, `projectId`, `appId`. (Skip Firebase Hosting if it offers it — not needed here.)

That's the entire Firebase side. No schema, no manual indexes, no security rules to write.

## 2. Backend setup

```bash
cd firmware/HeatShieldAI_Dashboard
npm install
copy .env.example .env      # macOS/Linux: cp .env.example .env
```

Open `.env` and fill in:
- `PORT` — defaults to 3000.
- `FIREBASE_SERVICE_ACCOUNT_PATH` — defaults to `./serviceAccountKey.json`, matching step 6 above.
- `INGEST_API_KEY` — optional, leave blank for now (see "Securing ingestion" below).
- `SUPERVISOR_SIGNUP_CODE` — **required for supervisor signup to work at all.** Pick any string — this is what gates who can create a supervisor account (full admin power: reallocate/erase any device) from the public signup screen. Treat it like a password; share it only with people who should have admin access.
- `FIREBASE_WEB_API_KEY`, `FIREBASE_WEB_AUTH_DOMAIN`, `FIREBASE_WEB_PROJECT_ID`, `FIREBASE_WEB_APP_ID` — the four values from step 8 above.

Run it:

```bash
npm start
```

You should see:

```
HeatShieldAI Dashboard backend listening on http://0.0.0.0:3000
  - Dashboard:       http://localhost:3000
  - Ingest endpoint: http://localhost:3000/api/ingest (POST)
```

Open `http://localhost:3000` in a browser — you'll see an empty worker grid
with a "worker1 — waiting for first reading" placeholder card until either
the gateway sends real data or you seed the example workers:

```bash
npm run seed
```

(Safe to re-run — it skips any worker that already has data. Pass
`npm run seed -- --force` to wipe and regenerate worker2-4's data.)

## 3. Point the gateway at this backend

Both the gateway and the machine running this backend need to be reachable
from each other — simplest setup is putting both on the same WiFi network.

1. Find this machine's LAN IP: `ipconfig` (Windows, look for the WiFi
   adapter's IPv4 address) or `ifconfig`/`ip addr` (macOS/Linux).
2. In `../HeatShieldAI_Gateway/src/`, copy `wifi_config.h.example` to
   `wifi_config.h` (gitignored — holds your WiFi password).
3. Fill in `HEATSHIELD_WIFI_SSID`, `HEATSHIELD_WIFI_PASSWORD`, and set
   `HEATSHIELD_BACKEND_URL` to `http://<this-machine's-LAN-IP>:3000/api/ingest`.
4. Flash the gateway (`pio run --target upload` from `HeatShieldAI_Gateway/`).
   Its Serial Monitor will print `[HTTP] Forwarded to backend.` on every
   successful reading, or a specific warning if WiFi or the backend is
   unreachable.

## Accounts & roles

Opening the dashboard now shows a sign-in screen with two roles:

- **Worker** — self-serve signup with phone number + password. Sees only the one device currently allocated to them (or a "no device allocated yet" message with their phone number, for a supervisor to allocate against).
- **Supervisor** — signup requires the `SUPERVISOR_SIGNUP_CODE` from `.env`. Sees every device (the same grid/detail view as before this feature existed), plus a **Device management** panel on each device's detail page: allocate it to any registered worker (by phone number, picked from a dropdown of everyone who's signed up as a worker), unallocate it, or erase all its readings/history. A device can only be allocated to one worker at a time, and a worker can only hold one device at a time — allocating a second device to an already-allocated worker automatically frees their first one.

**No SMS OTP yet** — "phone number" is currently just an identifier + password pair (Firebase Auth's email/password provider under the hood, via a synthetic email derived from the phone number — see `src/auth.js`), not actually verified by text message. Anyone who knows a phone number could sign up claiming to be that person. Real OTP verification is a natural next step (Firebase Phone Auth) but is explicitly deferred for now.

The allocation flow in order: **(1)** worker signs up first (establishes their account), **(2)** supervisor picks that worker from the dropdown on the device they want to hand them and clicks Allocate, **(3)** the worker's next page load/poll shows that device. A worker who hasn't been allocated anything yet just sees their own phone number displayed so they can tell it to their supervisor.

## Securing ingestion (optional, recommended before leaving this running unattended)

By default `/api/ingest` accepts readings from anything on your network that
knows the URL. To lock it down: pick a random string, set `INGEST_API_KEY` to
it in this project's `.env`, and set the *same* string as
`HEATSHIELD_INGEST_API_KEY` in the gateway's `wifi_config.h`. Restart the
backend and reflash the gateway. Requests without a matching `x-api-key`
header are now rejected with 401.

## What's in Firestore

```
workers/{workerId}                    -- profile + latest reading + allocation state (denormalized for the grid)
workers/{workerId}/readings/{auto}    -- one doc per reading (raw, for the recent-activity table)
workers/{workerId}/dailyStats/{date}  -- running sums/counts + the heatStrainDay flag, one per UTC day
users/{uid}                           -- {phoneNumber, role, name} -- one per signed-up account (worker or supervisor)
```

`workerId` is whatever the node firmware sends (see `HEATSHIELD_WORKER_ID` in
`../HeatShieldAI/src/main.cpp` — `"worker1"` by default). A worker (device)
doc is created automatically the first time it POSTs, no manual setup needed.
Allocation state lives on that same doc: `allocatedToPhone`, `allocatedToUid`,
`allocatedToName`, `allocatedAt` — all `null` until a supervisor allocates it.

`users/{uid}` is keyed by the Firebase Auth uid (not the phone number) so a
phone number can never collide with a Firestore document-id restriction; the
phone number is looked up via a `where("phoneNumber", "==", ...)` query
instead (see `src/routes/supervisor.js`'s allocate handler).

## About the long-term heat-exposure risk indicators

Your mentor's point about long-term/chronic health effects (not just "is this
reading dangerous right now") is handled as a separate, transparent,
**rule-based** layer on top of the model — see the comment block at the top
of `src/heatStrain.js` for the full reasoning and the research each one is
grounded in. The on-device TinyML model only ever sees the current reading;
this layer looks at up to 30 days of stored history per device and computes
four independent indicators, each shown on the worker detail page with its
own severity tier (low/moderate/high) and plain-language explanation:

1. **Heat Strain (systemic/kidney risk)** — days with sustained DANGER/CRITICAL classification.
2. **Cardiovascular Strain** — days where heart rate reached ACGIH's approximate excessive-heat-strain range.
3. **Electrolyte / Heat-Cramp Risk** — days with prolonged heavy exertion in high heat (the NIOSH/OSHA combination behind heat cramps).
4. **Dehydration Trend** — whether average heart rate is rising week-over-week at comparable exertion (cardiovascular drift), which can flag a worker whose day-to-day readings all look fine while an underlying trend quietly worsens.

None of this diagnoses heat exhaustion, kidney disease, or anything else —
it flags risk *patterns* worth a closer look, the same spirit as OSHA/NIOSH's
own water-rest-shade guidance. The dashboard's own "Why this matters" panel
(on every worker detail page) says so explicitly, alongside the fuller list
of heat-related conditions this exists to motivate — keep that framing
intact if you extend this further.

## Project layout

```
server.js                    Express entry point; also serves GET /api/firebase-config (public Web SDK config)
src/firebase.js              Firebase Admin SDK init
src/auth.js                  verifyAuth/requireSupervisor middleware + phone<->synthetic-email helpers
src/heatStrain.js            Shared daily-aggregate + 30-day risk logic (ingest route + seed script both use this)
src/firestoreUtils.js        Shared batched-delete helper (erase route + seed script's --force both use this)
src/routes/ingest.js         POST /api/ingest -- gateway's forward target (unauthenticated; optional INGEST_API_KEY)
src/routes/auth.js           POST /api/auth/register, GET /api/auth/me
src/routes/workers.js        GET /api/workers, /api/workers/:id -- role-filtered (requires sign-in)
src/routes/supervisor.js     GET registered-workers, POST allocate/unallocate/erase -- supervisor-only
scripts/seedDummyWorkers.js  Populates worker2-4 with 30 days of example data
scripts/syntheticPhysiology.js  Mirrors the TinyML training pipeline's class-conditional distributions
public/                      The dashboard itself (index.html, styles.css, app.js) -- served statically
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Firebase service account key not found at "..."` on `npm start` | You haven't done step 6 of Firebase setup, or `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env` doesn't match the filename you saved. |
| Dashboard loads but the worker grid never shows real data | Check the gateway's Serial Monitor for `[HTTP]` lines — `WiFi not connected` means check `wifi_config.h`; `Forward FAILED` means the backend URL/port is unreachable from the gateway's network. |
| `401` responses in the backend's console | `INGEST_API_KEY` is set in `.env` but the gateway's `HEATSHIELD_INGEST_API_KEY` doesn't match (or is still empty). |
| Map shows a marker but no map tiles | Needs outbound internet access to `tile.openstreetmap.org` from the browser (not from the gateway) — no API key required, just connectivity. |
| Chart/map area looks empty right after seeding | Hard-refresh the dashboard page; the grid/detail views poll every 5s but won't pick up a brand-new worker until the next poll or a manual reload. |
| "Firebase Web SDK isn't configured yet" on the login screen | `FIREBASE_WEB_API_KEY`/`AUTH_DOMAIN`/`PROJECT_ID`/`APP_ID` are missing from `.env` — see step 8 of Firebase setup. |
| Supervisor signup always says "Incorrect supervisor signup code" | `SUPERVISOR_SIGNUP_CODE` isn't set in `.env` (an empty value never matches, on purpose) — set it and restart the backend. |
| A worker's allocated device disappeared after a supervisor allocated a *different* device to them | Expected — this project enforces one device per worker; allocating a new one automatically frees their previous one (see "Accounts & roles"). |
| Testing locally against `firebase emulators:start`? | Append `?emulator=1` to the dashboard URL — the frontend will point Firebase Auth at `localhost:9099` instead of real Firebase. Never triggers otherwise. |
