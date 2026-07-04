/* ============================================================
   Optional cloud layer. The app works 100% offline without this.
   When you fill in firebase-config.js and flip CLOUD_ENABLED,
   this adds: email+password signup with email verification,
   phone number sign-in with a real SMS OTP, and syncing every
   store to Firestore so uninstalling/reinstalling and logging
   back in restores everything. Firebase's free "Spark" plan
   covers a single personal user with plenty of headroom — no
   card, no fee, unless you deliberately upgrade later.
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, onAuthStateChanged,
  RecaptchaVerifier, signInWithPhoneNumber,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDocs, collection,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, CLOUD_ENABLED } from "./firebase-config.js";

const STORES = ["transactions", "members", "groupExpenses", "notes", "ideas", "habits", "dayLogs", "goals", "settings"];

let app = null, auth = null, db = null, user = null, confirmationResult = null;

if (CLOUD_ENABLED) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    onAuthStateChanged(auth, (u) => {
      user = u;
      window.dispatchEvent(new CustomEvent("auth-changed", { detail: { user: u } }));
    });
  } catch (e) {
    console.warn("Cloud init failed — app continues offline-only.", e);
  }
}

async function signUpEmail(email, password) {
  if (!auth) return toastFallback("Cloud isn't set up yet — see SETUP.md");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(cred.user);
    toastFallback("Account created — check your email to verify it");
  } catch (e) { toastFallback(friendlyError(e)); }
}

async function signInEmail(email, password) {
  if (!auth) return toastFallback("Cloud isn't set up yet — see SETUP.md");
  try {
    await signInWithEmailAndPassword(auth, email, password);
    toastFallback("Signed in — pulling your data…");
    await pullAll();
  } catch (e) { toastFallback(friendlyError(e)); }
}

async function sendReset(email) {
  if (!auth) return toastFallback("Cloud isn't set up yet — see SETUP.md");
  try { await sendPasswordResetEmail(auth, email); toastFallback("Password reset email sent"); }
  catch (e) { toastFallback(friendlyError(e)); }
}

async function startPhoneAuth(phoneNumber) {
  if (!auth) return toastFallback("Cloud isn't set up yet — see SETUP.md");
  try {
    if (!window._recaptchaVerifier) {
      window._recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
    }
    confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, window._recaptchaVerifier);
    toastFallback("Code sent by SMS");
    return true;
  } catch (e) { toastFallback(friendlyError(e)); return false; }
}

async function confirmPhoneCode(code) {
  if (!confirmationResult) return toastFallback("Request a code first");
  try {
    await confirmationResult.confirm(code);
    toastFallback("Phone verified — pulling your data…");
    await pullAll();
  } catch (e) { toastFallback(friendlyError(e)); }
}

async function signOutUser() {
  if (!auth) return;
  await signOut(auth);
  toastFallback("Signed out — your data stays on this device");
}

/* push one document up (fire-and-forget from DB.put's perspective) */
async function pushDoc(store, obj) {
  if (!db || !user || !STORES.includes(store)) return;
  await setDoc(doc(db, "users", user.uid, store, String(obj.id)), obj);
}

/* pull everything down after login/restore, merge into local IndexedDB, then reload */
async function pullAll() {
  if (!db || !user) return;
  for (const store of STORES) {
    const snap = await getDocs(collection(db, "users", user.uid, store));
    for (const d of snap.docs) await window.DB.put(store, d.data());
  }
  toastFallback("Cloud data restored — reloading…");
  setTimeout(() => location.reload(), 1200);
}

function friendlyError(e) {
  const code = (e && e.code) || "";
  if (code.includes("email-already-in-use")) return "That email is already registered — try logging in.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Wrong email or password.";
  if (code.includes("user-not-found")) return "No account with that email yet — sign up first.";
  if (code.includes("invalid-phone-number")) return "Enter phone number in international format, e.g. +923001234567";
  return e.message || "Something went wrong";
}
function toastFallback(msg) {
  if (window.toast) window.toast(msg); else console.log(msg);
}

window.Cloud = {
  enabled: CLOUD_ENABLED,
  currentUser: () => user,
  signUpEmail, signInEmail, sendReset, signOutUser,
  startPhoneAuth, confirmPhoneCode, pullAll, pushDoc,
};

// Once the DB module is on the page, wrap DB.put so every local write
// also syncs up to Firestore when someone is logged in. Falls back to
// pure local-only silently if offline or cloud isn't configured.
function wrapDbPut() {
  if (!window.DB || window.DB._cloudWrapped) return;
  const original = window.DB.put.bind(window.DB);
  window.DB.put = async function (store, obj) {
    const res = await original(store, obj);
    if (CLOUD_ENABLED && user) pushDoc(store, obj).catch(() => {});
    return res;
  };
  window.DB._cloudWrapped = true;
}
const waitForDb = setInterval(() => { if (window.DB) { wrapDbPut(); clearInterval(waitForDb); } }, 100);
