// routes/auth.js
// ---------------
// Account creation and "who am I" for the phone+password login. The
// Firebase Auth account itself (email/password under the hood -- see
// ../auth.js) is created CLIENT-SIDE by the browser's Firebase SDK, which
// is what gives the frontend a fresh ID token; this route only ever runs
// AFTER that, to attach a role (worker/supervisor) and profile to the
// already-created account. There is deliberately no server-side "create
// user" call here -- one less place credentials pass through.

const express = require("express");
const { admin, db } = require("../firebase");
const { normalizePhone, verifyAuth } = require("../auth");

const router = express.Router();

// POST /api/auth/register
// Body: { phoneNumber, role: "worker"|"supervisor", name?, supervisorCode? }
// Requires Authorization: Bearer <idToken> from the just-created Firebase
// Auth account. Idempotent: calling it again for an already-registered uid
// just returns the existing profile rather than erroring.
router.post("/register", verifyAuthWithoutProfile, async (req, res) => {
  const { phoneNumber, role, name } = req.body || {};

  const normalizedPhone = normalizePhone(phoneNumber);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "phoneNumber looks invalid (need 7-15 digits)." });
  }
  if (role !== "worker" && role !== "supervisor") {
    return res.status(400).json({ error: 'role must be "worker" or "supervisor".' });
  }

  const userRef = db.collection("users").doc(req.uid);
  const existing = await userRef.get();
  if (existing.exists) {
    return res.json({ user: existing.data() });
  }

  if (role === "supervisor") {
    const expected = process.env.SUPERVISOR_SIGNUP_CODE || "";
    const provided = req.body.supervisorCode || "";
    if (!expected || provided !== expected) {
      // Clean up the Firebase Auth account we didn't end up wanting, so a
      // rejected supervisor signup doesn't leave an orphaned account behind
      // that silently owns the phone number (blocking a legitimate retry).
      await admin.auth().deleteUser(req.uid).catch(() => {});
      return res.status(403).json({ error: "Incorrect supervisor signup code." });
    }
  }

  const profile = {
    phoneNumber: normalizedPhone,
    role,
    name: typeof name === "string" && name.trim() ? name.trim() : null,
    createdAt: admin.firestore.Timestamp.now(),
  };
  await userRef.set(profile);
  res.status(201).json({ user: profile });
});

// GET /api/auth/me -- returns the caller's own profile (used on page load
// to restore a session and decide which view to render).
router.get("/me", verifyAuth, (req, res) => {
  res.json({ user: req.user });
});

// Like verifyAuth, but deliberately does NOT require a users/{uid} profile
// to already exist (that's exactly what /register is creating) -- it only
// needs a valid Firebase ID token, and attaches the raw uid.
async function verifyAuthWithoutProfile(req, res, next) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: "Missing Authorization: Bearer <idToken> header." });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired sign-in token." });
  }
}

module.exports = router;
