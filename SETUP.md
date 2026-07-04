# Deen & Discipline — Setup Guide (100% free, personal use)

Everything below uses only free tiers. No credit card is required anywhere
in this guide. Total time: ~15 minutes.

---

## Part 1 — Host it so it's installable as a real PWA (required)

A service worker (what makes the app installable and offline-capable) only
works over HTTPS or on `localhost`. **GitHub Pages** is free forever and
gives you HTTPS automatically.

1. Create a free GitHub account if you don't have one: https://github.com/signup
2. Create a new **public** repository, e.g. `deen-discipline`.
3. Upload every file in this project (keep the folder structure: `css/`,
   `js/`, `icons/`, `index.html`, `manifest.json`, `sw.js`) — either drag-and-drop
   on github.com, or:
   ```
   git init
   git add .
   git commit -m "Deen & Discipline"
   git branch -M main
   git remote add origin https://github.com/<your-username>/deen-discipline.git
   git push -u origin main
   ```
4. In the repo: **Settings → Pages → Source → Deploy from branch → main → / (root) → Save.**
5. After a minute your app is live at:
   `https://<your-username>.github.io/deen-discipline/`
6. Open that link on your phone → browser menu → **"Add to Home Screen" / "Install app."**
   It now behaves like a native app icon, works fully offline, and keeps all
   your data on-device via IndexedDB.

This alone gives you everything except cross-device sync: prayers, habits,
routine alarms, finance, hostel splitting, notes, ideas, journal, PIN lock —
all working offline, forever, free.

---

## Part 2 — Optional: free login + cloud sync (so reinstalling never loses data)

This uses **Firebase's free "Spark" plan** — genuinely free for a single
personal user, no card needed, no time limit. It gives you real email+password
accounts with email verification, and real SMS OTP phone sign-in.

### 2.1 Create the Firebase project
1. Go to https://console.firebase.google.com → **Add project** → name it
   anything (e.g. "deen-discipline") → you can disable Google Analytics,
   it's not needed → **Create project**.

### 2.2 Register your web app
1. In the project overview, click the **`</>`** (web) icon → nickname it →
   **Register app**. Skip the "Firebase Hosting" offer (you're already on
   GitHub Pages).
2. Firebase shows you a `firebaseConfig` object. Copy it.

### 2.3 Paste your config into the app
Open `js/firebase-config.js` in the project and replace the placeholder
values with the ones Firebase gave you, then flip the last line:
```js
export const CLOUD_ENABLED = true;
```
Re-upload/push this one changed file to your GitHub repo.

### 2.4 Turn on sign-in methods
In the Firebase console: **Build → Authentication → Get started → Sign-in method** tab:
- Enable **Email/Password**.
- Enable **Phone**. (Free tier includes a real SMS quota; more than enough
  for one person's account across devices.)

### 2.5 Turn on Firestore (the cloud database)
**Build → Firestore Database → Create database** → start in **production mode** → pick
any region close to Pakistan (e.g. `asia-south1`).

Then go to the **Rules** tab and replace the default rules with this, so only
you (once signed in) can ever read or write your own data:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{store}/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
Click **Publish**.

### 2.6 Add your phone number as an authorized domain (for phone OTP)
**Authentication → Settings → Authorized domains** should already include
your `<username>.github.io` domain automatically once you sign in from it once;
if phone sign-in complains, add it manually here.

### 2.7 Done
Reload the app, go to **Settings → Account & cloud sync**, sign up with email
or phone. From then on: install the app on any device, log in with the same
credentials, and everything restores automatically.

**Free tier limits** (Spark plan, as of writing): 50K reads / 20K writes /
day on Firestore, 10K phone verifications/month, unlimited email/password
auth. A single person's daily use of this app is a tiny fraction of that —
you won't hit a paywall by accident.

---

## Part 3 — Later: publishing to the Play Store

When you're ready and have the funds, the path is:
1. **Google Play Console** account — one-time $25 fee (this is the only real
   cost in this whole project, and it's optional/later, as you said).
2. Use **PWABuilder** (https://www.pwabuilder.com) — paste your GitHub Pages
   URL, it packages your PWA into an Android app (a "Trusted Web Activity")
   automatically, using your existing manifest.json and service worker as-is.
3. Upload the generated `.aab` file to Play Console, fill in the store
   listing, submit for review.

Nothing about the app needs to change for this — it's designed to be
Play-Store-ready from day one. We can walk through this step together
whenever you're ready to spend the $25.
