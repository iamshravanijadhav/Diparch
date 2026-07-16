// auth.js
// -------
// Authentication/authorization helpers.
//
// Workers and supervisors both sign in with a phone number + password (no
// SMS OTP yet -- explicitly deferred, see README). Firebase Auth has no
// built-in "phone + password" provider, so this uses the well-established
// "synthetic email" pattern: a phone number like "9876543210" becomes the
// Firebase Auth email "9876543210@heatshieldai.local" under the hood. Users
// never see or type an email anywhere -- the UI only ever shows "phone
// number" -- this is purely how it's represented to Firebase Auth, so we
// get its battle-tested password hashing/session/ID-token handling for free
// instead of rolling our own.
//
// Role (worker vs supervisor) is NOT trusted from the client. It's decided
// once at signup (backend/routes/auth.js) and stored in Firestore
// `users/{uid}`; every authenticated request re-reads it from there via
// verifyAuth below, keyed off the Firebase-verified uid.

const { admin, db } = require("./firebase");

const SYNTHETIC_EMAIL_DOMAIN = "heatshieldai.local";

function normalizePhone(rawPhone) {
  if (typeof rawPhone !== "string") return null;
  // Keep a leading "+" (country code) if present, strip everything else
  // down to digits. This is deliberately permissive (no country-specific
  // validation) since phone number here is an identifier, not something
  // actually SMS-verified yet.
  const trimmed = rawPhone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return (hasPlus ? "+" : "") + digits;
}

function phoneToSyntheticEmail(normalizedPhone) {
  // Firebase Auth emails are case-insensitive and don't allow "+", so strip
  // it here -- the "+"/no-"+" distinction doesn't need to survive into the
  // synthetic email, normalizePhone() already collapsed the digits.
  const digitsOnly = normalizedPhone.replace(/\D/g, "");
  return `${digitsOnly}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

// Express middleware: verifies the Firebase ID token in the Authorization
// header, loads that user's role/profile from Firestore, and attaches it as
// req.user. 401s if the token is missing/invalid, or if signup never
// finished (Firebase Auth account exists but no users/{uid} profile yet --
// see routes/auth.js's register handler).
async function verifyAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: "Missing Authorization: Bearer <idToken> header." });
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(match[1]);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired sign-in token. Please sign in again." });
  }

  const profileSnap = await db.collection("users").doc(decoded.uid).get();
  if (!profileSnap.exists) {
    return res.status(401).json({ error: "No account profile found for this sign-in. Please sign up again." });
  }

  const profile = profileSnap.data();
  req.user = {
    uid: decoded.uid,
    phoneNumber: profile.phoneNumber,
    role: profile.role,
    name: profile.name || null,
  };
  next();
}

function requireSupervisor(req, res, next) {
  if (!req.user || req.user.role !== "supervisor") {
    return res.status(403).json({ error: "Supervisor access required." });
  }
  next();
}

module.exports = {
  normalizePhone,
  phoneToSyntheticEmail,
  verifyAuth,
  requireSupervisor,
};
