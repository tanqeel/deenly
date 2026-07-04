/* ===================== State ===================== */
const S = {
  tab: "dashboard",
  date: todayStr(),
  day: null,
  habits: [],
  goals: [],
  notes: [],
  ideas: [],
  members: [],
  groupExpenses: [],
  transactions: [],
  settings: { lat: null, lng: null, tz: 5, method: "karachi", hanafi: true, notifEnabled: false, city: "", lastBackup: null },
  routine: [
    { time: "05:00", activity: "Fajr + Qur'an", notify: true },
    { time: "07:00", activity: "University / classes", notify: true },
    { time: "13:30", activity: "Dhuhr + lunch", notify: true },
    { time: "16:30", activity: "Asr + walk", notify: true },
    { time: "18:15", activity: "Maghrib + revision", notify: true },
    { time: "20:00", activity: "Isha + deep study block", notify: true },
    { time: "22:30", activity: "Wind down, sleep", notify: true },
  ],
  ideaFilter: "all",
  ideaSearch: "",
  noteSearch: "",
};

const DEFAULT_HABITS = [
  { id: "h1", name: "Qur'an recitation", time: "" },
  { id: "h2", name: "Morning & evening adhkar", time: "" },
  { id: "h3", name: "Deep-work study block", time: "" },
  { id: "h4", name: "Exercise / movement", time: "" },
  { id: "h5", name: "Sleep before midnight", time: "22:30" },
  { id: "h6", name: "No wasted screen time", time: "" },
];

const REMINDERS = [
  "Whoever relies on Allah, He is sufficient for him — Surah at-Talaq 65:3 (in meaning).",
  "The Prophet ﷺ said actions are judged by intentions — renew your niyyah before you begin.",
  "Salah is described as a means of restraining a person from indecency — Surah al-Ankabut 29:45 (in meaning).",
  "Reflect on Allah's order and balance in creation, then pace your own day with the same balance — Surah Hud 11:7 (in meaning).",
  "The strong believer is better than the weak believer, while good is in both — build strength: body, knowledge, and deen.",
  "Consistency (istiqamah) in small deeds is loved by Allah more than a burst of worship that fades.",
  "\"Indeed, with hardship comes ease\" — Surah ash-Sharh 94:6 (in meaning). Your effort this semester is not wasted.",
];

const IDEA_CATS = [
  { key: "all", label: "All", emoji: "✨" },
  { key: "idea", label: "Idea", emoji: "💡" },
  { key: "project", label: "Project", emoji: "🚀" },
  { key: "principle", label: "Principle", emoji: "🧭" },
  { key: "improvement", label: "Improvement", emoji: "📈" },
  { key: "golden", label: "Golden Rule", emoji: "⭐" },
  { key: "thought", label: "Thought", emoji: "💭" },
];

const NOTE_COLORS = 5;

function emptyDay(id) {
  return { id, prayers: {}, habits: {}, sleepHours: "", exercise: false, water: 0, mood: "", journal: "", studyMinutes: 0, studySubject: "" };
}

/* ===================== Init ===================== */
async function init() {
  await dbReady;
  const [habits, goals, notes, ideas, members, groupExpenses, transactions, settings, routine, day, security] = await Promise.all([
    DB.all("habits"),
    DB.all("goals"),
    DB.all("notes"),
    DB.all("ideas"),
    DB.all("members"),
    DB.all("groupExpenses"),
    DB.all("transactions"),
    DB.get("settings", "prayer"),
    DB.get("settings", "routine"),
    DB.get("dayLogs", todayStr()),
    DB.get("settings", "security"),
  ]);

  if (habits.length === 0) {
    for (const h of DEFAULT_HABITS) await DB.put("habits", h);
    S.habits = DEFAULT_HABITS;
  } else S.habits = habits;

  S.goals = goals; S.notes = notes; S.ideas = ideas; S.members = members;
  S.groupExpenses = groupExpenses; S.transactions = transactions;
  if (settings) S.settings = { ...S.settings, ...settings };
  if (routine && routine.items) S.routine = routine.items;
  S.day = day || emptyDay(todayStr());
  S.security = security || { id: "security", enabled: false };
  S.locked = !!S.security.enabled;

  document.getElementById("splash").remove();
  render();
  registerSW();
  updateOnlineBanner();
  window.addEventListener("online", updateOnlineBanner);
  window.addEventListener("offline", updateOnlineBanner);
  window.addEventListener("auth-changed", () => { if (S.tab === "settings") render(); });
  document.addEventListener("visibilitychange", handleVisibility);
  if (S.settings.notifEnabled) scheduleAllNotifications();
  maybeShowBackupReminder();
}

let hiddenAt = null;
function handleVisibility() {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && S.security.enabled && Date.now() - hiddenAt > 15000) {
    S.locked = true; render();
  }
  hiddenAt = null;
}

function updateOnlineBanner() {
  const b = document.getElementById("offlineBanner");
  if (!navigator.onLine) { b.classList.add("show"); b.textContent = "You're offline — everything still works. Changes stay on this device."; }
  else b.classList.remove("show");
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW failed", e));
  }
}

/* ===================== Day log helpers ===================== */
async function loadDay(dateStr) {
  S.day = (await DB.get("dayLogs", dateStr)) || emptyDay(dateStr);
  render();
}
async function saveDay(patch) {
  S.day = { ...S.day, ...patch };
  await DB.put("dayLogs", S.day);
  render();
}
function setDate(d) { S.date = d; loadDay(d); }
function shiftDate(delta) {
  const d = new Date(S.date); d.setDate(d.getDate() + delta);
  setDate(todayStr(d));
}

/* ===================== Prayers & Notifications ===================== */
function todaysPrayerTimes() {
  if (S.settings.lat == null) return null;
  return computePrayerTimes(new Date(), S.settings.lat, S.settings.lng, S.settings.tz, S.settings.method, S.settings.hanafi);
}

async function enablePrayerAlerts() {
  if (!("geolocation" in navigator)) { toast("Location not supported on this device"); return; }
  toast("Locating…");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    S.settings.lat = pos.coords.latitude;
    S.settings.lng = pos.coords.longitude;
    S.settings.tz = -new Date().getTimezoneOffset() / 60;
    const perm = await Notification.requestPermission();
    S.settings.notifEnabled = perm === "granted";
    await DB.put("settings", { id: "prayer", ...S.settings });
    if (S.settings.notifEnabled) { scheduleAllNotifications(); toast("Alerts enabled — prayers, habits & routine"); }
    else toast("Notification permission denied");
    render();
  }, () => toast("Couldn't get location — set it manually in Settings"));
}

/* Builds today's full reminder list: prayers + timed habits + routine
   blocks marked to notify. Reschedules itself every midnight so it
   keeps working day after day without needing internet. */
let scheduledTimers = [];
function scheduleAllNotifications() {
  scheduledTimers.forEach(clearTimeout);
  scheduledTimers = [];
  if (!S.settings.notifEnabled) return;
  const now = new Date();
  const items = [];

  const times = todaysPrayerTimes();
  if (times) {
    const labels = { fajr: "Fajr", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" };
    Object.keys(labels).forEach((k) => items.push({
      tag: "prayer-" + k, time: times[k], title: `${labels[k]} — time to pray`, body: "May Allah accept it from you.",
    }));
  }

  S.habits.filter((h) => h.time).forEach((h) => items.push({
    tag: "habit-" + h.id, time: h.time, title: `Habit: ${h.name}`, body: "Time to keep the streak going.",
  }));

  (S.routine || []).filter((r) => r.notify !== false).forEach((r, i) => items.push({
    tag: "routine-" + i, time: r.time, title: r.activity, body: "It's on your daily routine for now.",
  }));

  items.forEach(({ tag, time, title, body }) => {
    if (!time) return;
    const [h, m] = time.split(":").map(Number);
    const t = new Date(); t.setHours(h, m, 0, 0);
    const ms = t - now;
    if (ms > 0) scheduledTimers.push(setTimeout(() => fireNotification(title, body, tag), ms));
  });

  // reschedule at next midnight for tomorrow's times
  const midnight = new Date(); midnight.setHours(24, 0, 5, 0);
  scheduledTimers.push(setTimeout(scheduleAllNotifications, midnight - now));
}

function fireNotification(title, body, tag) {
  const opts = { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", tag };
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "SHOW_NOTIFICATION", title, options: opts });
  } else if (Notification.permission === "granted") {
    new Notification(title, opts);
  }
}

/* ===================== Finance ===================== */
async function addTransaction(tx) {
  const obj = { id: uid(), date: S.date, ...tx };
  S.transactions = [obj, ...S.transactions];
  await DB.put("transactions", obj);
  render();
}
async function deleteTransaction(id) {
  S.transactions = S.transactions.filter((t) => t.id !== id);
  await DB.delete("transactions", id);
  render();
}
function monthTx(monthStr = S.date.slice(0, 7)) {
  return S.transactions.filter((t) => t.date.slice(0, 7) === monthStr);
}
function balanceTotal() {
  return S.transactions.reduce((s, t) => s + (t.type === "income" ? t.amount : -t.amount), 0);
}

async function addMember(name) {
  const obj = { id: uid(), name };
  S.members = [...S.members, obj]; await DB.put("members", obj); render();
}
async function removeMember(id) {
  S.members = S.members.filter((m) => m.id !== id); await DB.delete("members", id); render();
}
async function addGroupExpense(exp) {
  const obj = { id: uid(), date: S.date, settled: false, ...exp };
  S.groupExpenses = [obj, ...S.groupExpenses]; await DB.put("groupExpenses", obj); render();
}
async function deleteGroupExpense(id) {
  S.groupExpenses = S.groupExpenses.filter((e) => e.id !== id); await DB.delete("groupExpenses", id); render();
}
async function toggleSettled(id) {
  const e = S.groupExpenses.find((x) => x.id === id);
  e.settled = !e.settled;
  await DB.put("groupExpenses", e); render();
}
function memberBalances() {
  const bal = {};
  S.members.forEach((m) => (bal[m.id] = 0));
  S.groupExpenses.filter((e) => !e.settled).forEach((e) => {
    const share = e.amount / e.splitAmong.length;
    e.splitAmong.forEach((p) => {
      if (p === e.paidBy) return;
      if (e.paidBy === "me" && p !== "me") bal[p] = (bal[p] || 0) + share;
      else if (p === "me" && e.paidBy !== "me") bal[e.paidBy] = (bal[e.paidBy] || 0) - share;
    });
  });
  return bal;
}

/* ===================== Notes ===================== */
async function saveNote(note) {
  const obj = note.id ? note : { id: uid(), pinned: false, archived: false, color: 0, updatedAt: Date.now(), ...note };
  obj.updatedAt = Date.now();
  S.notes = [obj, ...S.notes.filter((n) => n.id !== obj.id)];
  await DB.put("notes", obj);
  render();
}
async function deleteNote(id) { S.notes = S.notes.filter((n) => n.id !== id); await DB.delete("notes", id); render(); }
async function togglePin(id) {
  const n = S.notes.find((x) => x.id === id); n.pinned = !n.pinned; await DB.put("notes", n); render();
}

/* ===================== Ideas ===================== */
async function addIdea(text, cat) {
  const obj = { id: uid(), text, cat, date: S.date };
  S.ideas = [obj, ...S.ideas]; await DB.put("ideas", obj); render();
}
async function deleteIdea(id) { S.ideas = S.ideas.filter((i) => i.id !== id); await DB.delete("ideas", id); render(); }

/* ===================== Goals ===================== */
async function addGoal(title, cat) {
  const obj = { id: uid(), title, cat, progress: 0, done: false };
  S.goals = [obj, ...S.goals]; await DB.put("goals", obj); render();
}
async function updateGoal(id, patch) {
  const g = S.goals.find((x) => x.id === id); Object.assign(g, patch); await DB.put("goals", g); render();
}
async function deleteGoal(id) { S.goals = S.goals.filter((g) => g.id !== id); await DB.delete("goals", id); render(); }

/* ===================== Habits ===================== */
async function addHabit(name, time) {
  const obj = { id: uid(), name, time: time || "" };
  S.habits = [...S.habits, obj]; await DB.put("habits", obj);
  if (S.settings.notifEnabled) scheduleAllNotifications();
  render();
}
async function removeHabit(id) {
  S.habits = S.habits.filter((h) => h.id !== id); await DB.delete("habits", id);
  if (S.settings.notifEnabled) scheduleAllNotifications();
  render();
}
async function setHabitTime(id, time) {
  const h = S.habits.find((x) => x.id === id); h.time = time; await DB.put("habits", h);
  if (S.settings.notifEnabled) scheduleAllNotifications();
  toast(time ? `Reminder set for ${time}` : "Reminder cleared");
}

/* ===================== Routine ===================== */
async function saveRoutine(items) {
  S.routine = items;
  await DB.put("settings", { id: "routine", items });
  if (S.settings.notifEnabled) scheduleAllNotifications();
  render();
}

/* ===================== Export / Backup / Restore =====================
   Everything lives only on this device (that's what makes it offline-first),
   which also means a stolen or wiped phone loses it unless a backup was
   exported. This is the safety net: one file with every store, restorable
   on any new device via "Restore backup" below. */
const ALL_STORES = ["transactions", "members", "groupExpenses", "notes", "ideas", "habits", "dayLogs", "goals", "settings"];

async function exportData(silent) {
  const out = {};
  for (const s of ALL_STORES) out[s] = await DB.all(s);
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `deen-discipline-backup-${todayStr()}.json`;
  a.click();
  S.settings.lastBackup = Date.now();
  await DB.put("settings", { id: "prayer", ...S.settings });
  if (!silent) toast("Backup downloaded — save it to Drive, email, or WhatsApp yourself so it survives a lost phone");
  render();
}

function triggerImport() { document.getElementById("importFile").click(); }

async function importData(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    for (const store of ALL_STORES) {
      if (!Array.isArray(data[store])) continue;
      for (const row of data[store]) await DB.put(store, row);
    }
    toast("Backup restored — reloading…");
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    toast("Couldn't read that backup file");
    console.error(e);
  }
}

function maybeShowBackupReminder() {
  const last = S.settings.lastBackup;
  const days = last ? (Date.now() - last) / 86400000 : Infinity;
  if (days > 14) {
    setTimeout(() => toast("It's been a while — back up your data from Settings so a lost phone can't erase it"), 2000);
  }
}

/* ===================== Utility UI ===================== */
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.style.display = "none"), 1800);
}
function fmtPKR(n) { return "Rs " + Number(n || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 }); }
function setTab(t) { S.tab = t; render(); window.scrollTo(0, 0); }
function esc(s = "") { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ===================== App lock (PIN) ===================== */
async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin + ":" + salt));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function setPin(pin) {
  if (!pin || pin.length < 4) return toast("Use at least 4 digits");
  const salt = uid();
  const hash = await hashPin(pin, salt);
  S.security = { id: "security", enabled: true, hash, salt };
  await DB.put("settings", S.security);
  toast("PIN lock turned on");
  render();
}
async function removePin() {
  S.security = { id: "security", enabled: false };
  await DB.put("settings", S.security);
  toast("PIN lock turned off");
  render();
}
async function submitPin() {
  const val = document.getElementById("pinInput").value;
  const hash = await hashPin(val, S.security.salt);
  if (hash === S.security.hash) { S.locked = false; render(); }
  else { toast("Wrong PIN"); document.getElementById("pinInput").value = ""; }
}
function viewLock() {
  return `<div style="max-width:320px;margin:60px auto 0;text-align:center">
    <p style="font-size:40px;margin-bottom:6px">🔒</p>
    <p class="serif" style="font-size:20px;margin-bottom:4px">Deen &amp; Discipline is locked</p>
    <p class="small" style="margin-bottom:18px">Enter your PIN to continue</p>
    <input id="pinInput" type="password" inputmode="numeric" maxlength="8" placeholder="••••"
      style="text-align:center;font-size:24px;letter-spacing:10px;margin-bottom:12px" autofocus
      onkeydown="if(event.key==='Enter')submitPin()">
    <button class="btn" style="width:100%" onclick="submitPin()">Unlock</button>
  </div>`;
}

/* ===================== Render ===================== */
function render() {
  if (S.locked) {
    document.getElementById("view").innerHTML = viewLock();
    document.getElementById("bottomNav").innerHTML = "";
    setTimeout(() => document.getElementById("pinInput") && document.getElementById("pinInput").focus(), 50);
    return;
  }
  document.getElementById("dateLabel").value = S.date;
  document.getElementById("view").innerHTML = VIEWS[S.tab]();
  renderNav();
}

function renderNav() {
  const tabs = [
    ["dashboard", "🕋", "Home"], ["prayers", "🌙", "Prayers"], ["habits", "✅", "Habits"],
    ["finance", "💰", "Finance"], ["friends", "🤝", "Friends"], ["notes", "🗒️", "Notes"],
    ["ideas", "💡", "Ideas"], ["goals", "🎯", "Goals"], ["health", "❤️", "Health"],
    ["journal", "🪶", "Journal"], ["routine", "📅", "Routine"], ["settings", "⚙️", "Settings"],
  ];
  document.getElementById("bottomNav").innerHTML = `<div class="inner">${tabs.map(([id, e, l]) =>
    `<button class="${S.tab === id ? "active" : ""}" onclick="setTab('${id}')"><span>${e}</span>${l}</button>`).join("")}</div>`;
}

const VIEWS = {
  dashboard: viewDashboard, prayers: viewPrayers, habits: viewHabits, finance: viewFinance,
  friends: viewFriends, notes: viewNotes, ideas: viewIdeas, goals: viewGoals, health: viewHealth,
  journal: viewJournal, routine: viewRoutine, settings: viewSettings,
};

function viewDashboard() {
  const prayerCount = Object.values(S.day.prayers).filter(Boolean).length;
  const habitCount = S.habits.filter((h) => S.day.habits[h.id]).length;
  const mIncome = monthTx().filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const mExpense = monthTx().filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const activeGoals = S.goals.filter((g) => !g.done).slice(0, 3);
  const reminder = REMINDERS[new Date().getDate() % REMINDERS.length];
  const backupDays = S.settings.lastBackup ? (Date.now() - S.settings.lastBackup) / 86400000 : Infinity;
  return `
    ${backupDays > 14 ? `<div class="card" style="border-color:var(--rose)"><span class="left" onclick="setTab('settings')" style="cursor:pointer">⚠️ ${!S.settings.lastBackup ? "No backup taken yet" : "Backup is over 2 weeks old"} — tap to back up your data</span></div>` : ""}
    <div class="card"><p class="small" style="color:var(--gold);text-transform:uppercase;letter-spacing:.15em;margin:0 0 6px">Reminder</p>
      <p style="font-style:italic;font-size:14px;line-height:1.5;margin:0">${esc(reminder)}</p></div>
    <div class="grid2">
      <a class="stat card" onclick="setTab('prayers')"><span class="label">Prayers today</span><span class="value">${prayerCount}/5</span></a>
      <a class="stat card" onclick="setTab('habits')"><span class="label">Habits done</span><span class="value">${habitCount}/${S.habits.length}</span></a>
      <a class="stat card" onclick="setTab('finance')"><span class="label">Balance</span><span class="value">${fmtPKR(balanceTotal())}</span></a>
      <a class="stat card" onclick="setTab('health')"><span class="label">Sleep last night</span><span class="value">${S.day.sleepHours || "—"}h</span></a>
    </div>
    <div class="card"><div class="section-title"><span class="left">💰 Cash flow</span><span class="right">this month</span></div>
      <div class="row"><span class="balance-pos">▲ ${fmtPKR(mIncome)}</span><span class="balance-neg" style="text-align:right">▼ ${fmtPKR(mExpense)}</span></div></div>
    ${activeGoals.length ? `<div class="card"><div class="section-title"><span class="left">🎯 Active goals</span></div>
      ${activeGoals.map((g) => `<div style="margin-bottom:8px"><div class="row" style="margin-bottom:4px"><span>${esc(g.title)}</span><span style="color:var(--gold)">${g.progress}%</span></div><div class="progress"><div style="width:${g.progress}%"></div></div></div>`).join("")}
    </div>` : ""}
  `;
}

function viewPrayers() {
  const times = todaysPrayerTimes();
  const labels = { fajr: "Fajr", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" };
  const emojis = { fajr: "🌙", dhuhr: "☀️", asr: "🌤️", maghrib: "🌇", isha: "✨" };
  const count = Object.values(S.day.prayers).filter(Boolean).length;
  return `
    <div class="card">
      <div class="section-title"><span class="left">🌙 Salah tracker</span><span class="right">${count}/5</span></div>
      ${!S.settings.lat ? `<button class="btn" style="width:100%;margin-bottom:12px" onclick="enablePrayerAlerts()">📍 Enable alerts (prayers, habits & routine)</button>` :
        `<p class="small" style="margin-bottom:10px">${times.method}${S.settings.notifEnabled ? " · alerts on for prayers, habits & routine" : ""} — <a onclick="setTab('settings')" style="color:var(--gold);cursor:pointer">edit in Settings</a></p>`}
      ${Object.keys(labels).map((k) => `
        <div class="list-row ${S.day.prayers[k] ? "done" : ""}" onclick="togglePrayer('${k}')">
          <span class="left"><span>${emojis[k]}</span><span class="serif">${labels[k]}</span>${times ? `<span class="small">${times[k]}</span>` : ""}</span>
          <span>${S.day.prayers[k] ? "✅" : "⭕"}</span>
        </div>`).join("")}
      <p class="small" style="margin-top:8px">Alerts fire while this app/tab is open or running as an installed PWA. For a guaranteed alarm even when your phone is fully closed, ask me in chat and I'll set a native phone alarm too.</p>
    </div>`;
}
async function togglePrayer(k) { await saveDay({ prayers: { ...S.day.prayers, [k]: !S.day.prayers[k] } }); }

function viewHabits() {
  const count = S.habits.filter((h) => S.day.habits[h.id]).length;
  return `<div class="card">
    <div class="section-title"><span class="left">✅ Daily habits</span><span class="right">${count}/${S.habits.length}</span></div>
    ${!S.settings.notifEnabled ? `<p class="small" style="margin-bottom:8px">Set a time on a habit below and it'll notify you — turn on alerts in <a onclick="setTab('settings')" style="color:var(--gold);cursor:pointer">Settings</a> first.</p>` : ""}
    ${S.habits.map((h) => `
      <div class="list-row ${S.day.habits[h.id] ? "done" : ""}" style="align-items:center">
        <span class="left" onclick="toggleHabit('${h.id}')" style="flex:1">${S.day.habits[h.id] ? "✅" : "⭕"} ${esc(h.name)}</span>
        <input type="time" value="${h.time || ""}" style="flex:0;width:auto;padding:5px 6px" onchange="setHabitTime('${h.id}', this.value)">
        <button class="btn-icon" onclick="removeHabit('${h.id}')">✕</button>
      </div>`).join("") || `<p class="empty">No habits yet</p>`}
    <div class="row" style="margin-top:8px">
      <input id="newHabit" placeholder="Add a habit…">
      <input type="time" id="newHabitTime" style="flex:0;width:auto">
      <button class="btn" onclick="addHabit(document.getElementById('newHabit').value, document.getElementById('newHabitTime').value); document.getElementById('newHabit').value=''">+</button>
    </div>
  </div>`;
}
async function toggleHabit(id) { await saveDay({ habits: { ...S.day.habits, [id]: !S.day.habits[id] } }); }

function viewFinance() {
  const list = monthTx();
  const mIncome = list.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const mExpense = list.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const months = [...new Set(S.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse();
  return `
  <div class="card">
    <div class="row" style="text-align:center">
      <div><p class="small">Balance</p><p class="serif" style="font-size:18px">${fmtPKR(balanceTotal())}</p></div>
      <div><p class="small balance-pos">In (month)</p><p class="balance-pos">${fmtPKR(mIncome)}</p></div>
      <div><p class="small balance-neg">Out (month)</p><p class="balance-neg">${fmtPKR(mExpense)}</p></div>
    </div>
  </div>
  <div class="card">
    <div class="section-title"><span class="left">💰 Add transaction</span></div>
    <div class="row" style="margin-bottom:8px">
      <button class="btn ${"secondary"}" id="typeExpBtn" onclick="setTxType('expense')" style="background:${S._txType!=='income'?'var(--gold)':'transparent'};color:${S._txType!=='income'?'var(--bg)':'var(--cream)'}">Expense</button>
      <button class="btn secondary" id="typeIncBtn" onclick="setTxType('income')" style="background:${S._txType==='income'?'var(--gold)':'transparent'};color:${S._txType==='income'?'var(--bg)':'var(--cream)'}">Income</button>
    </div>
    <input id="txAmount" type="number" placeholder="Amount (PKR)" style="margin-bottom:8px">
    <input id="txCat" placeholder="Category (food, tuition, freelance…)" style="margin-bottom:8px">
    <input id="txNote" placeholder="Note (optional)" style="margin-bottom:8px">
    <button class="btn" style="width:100%" onclick="submitTx()">Add for ${S.date}</button>
  </div>
  <div class="card">
    <div class="section-title"><span class="left">📅 History</span>
      <select onchange="filterMonth(this.value)">${months.map((m) => `<option value="${m}" ${m === S.date.slice(0,7) ? "selected" : ""}>${m}</option>`).join("")}</select>
    </div>
    <div>${list.length ? list.map((t) => `
      <div class="list-row">
        <span class="left"><span>${t.type === "income" ? "🟢" : "🔴"}</span><span>${esc(t.category)}${t.note ? " · " + esc(t.note) : ""}<br><span class="small">${t.date}</span></span></span>
        <span class="row" style="flex:0;gap:8px;align-items:center">
          <span class="${t.type === "income" ? "balance-pos" : "balance-neg"}">${t.type === "income" ? "+" : "-"}${fmtPKR(t.amount)}</span>
          <button class="btn-icon" onclick="deleteTransaction('${t.id}')">✕</button>
        </span>
      </div>`).join("") : `<p class="empty">No transactions this month</p>`}</div>
  </div>`;
}
S._txType = "expense";
function setTxType(t) { S._txType = t; render(); }
function filterMonth(m) { S.date = m + "-01"; render(); }
function submitTx() {
  const amount = Number(document.getElementById("txAmount").value);
  if (!amount) return toast("Enter an amount");
  const category = document.getElementById("txCat").value || (S._txType === "income" ? "Income" : "Misc");
  const note = document.getElementById("txNote").value;
  addTransaction({ type: S._txType, amount, category, note });
}

function viewFriends() {
  const bal = memberBalances();
  const list = S.groupExpenses;
  return `
  <div class="card">
    <div class="section-title"><span class="left">🤝 Hostel / friends</span></div>
    ${S.members.length ? S.members.map((m) => `
      <div class="list-row">
        <span class="left">👤 ${esc(m.name)}</span>
        <span class="row" style="flex:0;gap:8px;align-items:center">
          <span class="${(bal[m.id]||0) >= 0 ? "balance-pos" : "balance-neg"}">${(bal[m.id]||0) >= 0 ? "owes you " : "you owe "}${fmtPKR(Math.abs(bal[m.id]||0))}</span>
          <button class="btn-icon" onclick="removeMember('${m.id}')">✕</button>
        </span>
      </div>`).join("") : `<p class="empty">Add your hostel roommates to start splitting</p>`}
    <div class="row" style="margin-top:8px">
      <input id="newMember" placeholder="Friend's name…">
      <button class="btn" onclick="addMember(document.getElementById('newMember').value); document.getElementById('newMember').value=''">+</button>
    </div>
  </div>
  <div class="card">
    <div class="section-title"><span class="left">➕ Split an expense</span></div>
    <input id="expDesc" placeholder="What was it? (mess bill, grocery…)" style="margin-bottom:8px">
    <input id="expAmount" type="number" placeholder="Total amount (PKR)" style="margin-bottom:8px">
    <label class="small">Paid by</label>
    <select id="expPaidBy" style="margin-bottom:8px">
      <option value="me">Me</option>
      ${S.members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}
    </select>
    <label class="small">Split among</label>
    <div style="margin-bottom:8px">
      <label class="pill active" style="cursor:pointer"><input type="checkbox" value="me" checked style="width:auto;display:inline" class="splitChk"> Me</label>
      ${S.members.map((m) => `<label class="pill" style="cursor:pointer"><input type="checkbox" value="${m.id}" class="splitChk" style="width:auto;display:inline"> ${esc(m.name)}</label>`).join("")}
    </div>
    <button class="btn" style="width:100%" onclick="submitGroupExpense()">Add split expense</button>
  </div>
  <div class="card">
    <div class="section-title"><span class="left">📜 Shared expense history</span></div>
    ${list.length ? list.map((e) => `
      <div class="list-row ${e.settled ? "done" : ""}">
        <span class="left" onclick="toggleSettled('${e.id}')">${e.settled ? "✅" : "⭕"} ${esc(e.description)} <span class="small">· ${fmtPKR(e.amount)} paid by ${e.paidBy === "me" ? "you" : esc((S.members.find(m=>m.id===e.paidBy)||{}).name||"?")} · ${e.date}</span></span>
        <button class="btn-icon" onclick="deleteGroupExpense('${e.id}')">✕</button>
      </div>`).join("") : `<p class="empty">No shared expenses yet</p>`}
    <p class="small" style="margin-top:6px">Tap an entry to mark it settled once you've squared up — this is a lightweight MemoGo-style split tracker: equal shares among whoever you tick.</p>
  </div>`;
}
function submitGroupExpense() {
  const description = document.getElementById("expDesc").value.trim();
  const amount = Number(document.getElementById("expAmount").value);
  const paidBy = document.getElementById("expPaidBy").value;
  const splitAmong = [...document.querySelectorAll(".splitChk:checked")].map((c) => c.value);
  if (!description || !amount || splitAmong.length === 0) return toast("Fill in description, amount, and split");
  addGroupExpense({ description, amount, paidBy, splitAmong });
}

function viewNotes() {
  const q = S.noteSearch.toLowerCase();
  const filtered = S.notes.filter((n) => !n.archived && (n.title + n.body).toLowerCase().includes(q));
  filtered.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  return `
  <div class="card">
    <div class="section-title"><span class="left">🗒️ Notes</span></div>
    <div class="search-box"><span class="icon">🔍</span><input value="${esc(S.noteSearch)}" oninput="S.noteSearch=this.value;render()" placeholder="Search notes…"></div>
    <details style="margin-bottom:12px"><summary class="btn secondary" style="display:inline-block">+ New note</summary>
      <div style="margin-top:8px">
        <input id="noteTitle" placeholder="Title" style="margin-bottom:8px">
        <textarea id="noteBody" rows="3" placeholder="Note…" style="margin-bottom:8px"></textarea>
        <div class="row" style="margin-bottom:8px">${[0,1,2,3,4].map((c) => `<button class="btn-icon" style="background:var(--card)" onclick="document.getElementById('noteColor').value='${c}'">🎨${c+1}</button>`).join("")}</div>
        <input type="hidden" id="noteColor" value="0">
        <button class="btn" style="width:100%" onclick="submitNote()">Save note</button>
      </div>
    </details>
    <div class="note-grid">
      ${filtered.map((n) => `
        <div class="note color-${n.color || 0}">
          <div class="title">${n.pinned ? "📌 " : ""}${esc(n.title || "Untitled")}</div>
          <div class="body">${esc(n.body).slice(0, 140)}${n.body.length > 140 ? "…" : ""}</div>
          <div class="row" style="margin-top:8px;gap:6px">
            <button class="btn-icon" onclick="togglePin('${n.id}')">📌</button>
            <button class="btn-icon" onclick="deleteNote('${n.id}')">✕</button>
          </div>
        </div>`).join("") || `<p class="empty">No notes yet</p>`}
    </div>
  </div>`;
}
function submitNote() {
  const title = document.getElementById("noteTitle").value.trim();
  const body = document.getElementById("noteBody").value.trim();
  const color = Number(document.getElementById("noteColor").value);
  if (!title && !body) return;
  saveNote({ title, body, color });
  document.getElementById("noteTitle").value = ""; document.getElementById("noteBody").value = "";
}

function viewIdeas() {
  const q = S.ideaSearch.toLowerCase();
  const filtered = S.ideas.filter((i) => (S.ideaFilter === "all" || i.cat === S.ideaFilter) && i.text.toLowerCase().includes(q));
  return `
  <div class="card">
    <div class="section-title"><span class="left">💡 Ideas, projects &amp; principles</span></div>
    <div class="search-box"><span class="icon">🔍</span><input value="${esc(S.ideaSearch)}" oninput="S.ideaSearch=this.value;render()" placeholder="Search ideas, tags, categories…"></div>
    <div class="tabs-scroll">${IDEA_CATS.map((c) => `<button class="pill ${S.ideaFilter === c.key ? "active" : ""}" onclick="S.ideaFilter='${c.key}';render()">${c.emoji} ${c.label}</button>`).join("")}</div>
    <div class="row" style="margin:10px 0">
      <select id="ideaCat">${IDEA_CATS.filter((c) => c.key !== "all").map((c) => `<option value="${c.key}">${c.emoji} ${c.label}</option>`).join("")}</select>
    </div>
    <textarea id="ideaText" rows="2" placeholder="Plan, innovation, pitch, idea…" style="margin-bottom:8px"></textarea>
    <button class="btn" style="width:100%;margin-bottom:12px" onclick="submitIdea()">Capture</button>
    ${filtered.length ? filtered.map((i) => {
      const cat = IDEA_CATS.find((c) => c.key === i.cat) || IDEA_CATS[1];
      return `<div class="list-row" style="align-items:flex-start">
        <span class="left" style="flex-direction:column;align-items:flex-start;gap:4px"><span class="pill active">${cat.emoji} ${cat.label}</span><span>${esc(i.text)}</span><span class="small">${i.date}</span></span>
        <button class="btn-icon" onclick="deleteIdea('${i.id}')">✕</button>
      </div>`;
    }).join("") : `<p class="empty">No ideas here yet</p>`}
  </div>`;
}
function submitIdea() {
  const text = document.getElementById("ideaText").value.trim();
  const cat = document.getElementById("ideaCat").value;
  if (!text) return;
  addIdea(text, cat);
  document.getElementById("ideaText").value = "";
}

function viewGoals() {
  return `<div class="card">
    <div class="section-title"><span class="left">🎯 Goals</span></div>
    ${S.goals.map((g) => `
      <div style="border:1px solid var(--border);border-radius:12px;padding:10px;margin-bottom:8px">
        <div class="row" style="margin-bottom:6px"><span class="${g.done ? "small" : ""}">${esc(g.title)}</span><button class="btn-icon" onclick="deleteGoal('${g.id}')" style="flex:0">✕</button></div>
        <div class="progress" style="margin-bottom:6px"><div style="width:${g.progress}%"></div></div>
        <input type="range" min="0" max="100" value="${g.progress}" oninput="updateGoal('${g.id}',{progress:Number(this.value),done:Number(this.value)===100})">
      </div>`).join("") || `<p class="empty">No goals yet</p>`}
    <div class="row">
      <input id="goalTitle" placeholder="New goal…">
      <select id="goalCat"><option value="study">Study</option><option value="deen">Deen</option><option value="career">Career</option><option value="health">Health</option></select>
      <button class="btn" onclick="addGoal(document.getElementById('goalTitle').value, document.getElementById('goalCat').value); document.getElementById('goalTitle').value=''">+</button>
    </div>
  </div>`;
}

function viewHealth() {
  const d = S.day;
  return `<div class="card">
    <div class="section-title"><span class="left">❤️ Health &amp; body</span></div>
    <label class="small">Sleep last night (hours)</label>
    <input type="number" step="0.5" value="${d.sleepHours}" style="margin-bottom:10px" onchange="saveDay({sleepHours:this.value})">
    <div class="row" style="align-items:center;margin-bottom:10px">
      <span class="small">🏋️ Exercised today</span>
      <button class="btn ${d.exercise ? "" : "secondary"}" style="flex:0" onclick="saveDay({exercise:!S.day.exercise})">${d.exercise ? "Yes" : "No"}</button>
    </div>
    <label class="small">💧 Water: ${d.water || 0} glasses</label>
    <input type="range" min="0" max="15" value="${d.water || 0}" style="margin-bottom:10px" oninput="saveDay({water:Number(this.value)})">
    <label class="small">Mood / energy</label>
    <div class="row" style="margin-bottom:10px">${["Low","Okay","Good","Great"].map((m) => `<button class="btn ${d.mood===m?"":"secondary"}" onclick="saveDay({mood:'${m}'})">${m}</button>`).join("")}</div>
    <label class="small">Study log today</label>
    <div class="row">
      <input value="${esc(d.studySubject)}" placeholder="Subject" onchange="saveDay({studySubject:this.value})">
      <input type="number" value="${d.studyMinutes||''}" placeholder="Minutes" onchange="saveDay({studyMinutes:Number(this.value)})">
    </div>
    <p class="small" style="margin-top:10px">Tell me your specific health considerations any time and I'll tailor this section (custom reminders, things to track, things to avoid) around them.</p>
  </div>`;
}

function viewJournal() {
  return `<div class="card">
    <div class="section-title"><span class="left">🪶 Journal &amp; reflection</span></div>
    <textarea id="journalText" rows="10" placeholder="What happened today? Gratitude, dua, lesson, muhasabah…">${esc(S.day.journal || "")}</textarea>
    <button class="btn" style="width:100%;margin-top:8px" onclick="saveDay({journal:document.getElementById('journalText').value}); toast('Saved')">💾 Save entry</button>
  </div>`;
}

function viewRoutine() {
  return `<div class="card">
    <div class="section-title"><span class="left">📅 Daily routine template</span></div>
    ${!S.settings.notifEnabled ? `<p class="small" style="margin-bottom:8px">Turn on alerts in <a onclick="setTab('settings')" style="color:var(--gold);cursor:pointer">Settings</a> so each block below can notify you.</p>` : ""}
    ${S.routine.map((r, i) => `
      <div class="row" style="margin-bottom:8px;align-items:center">
        <input type="time" value="${r.time}" style="flex:0;width:auto" onchange="updateRoutineItem(${i},'time',this.value)">
        <input value="${esc(r.activity)}" onchange="updateRoutineItem(${i},'activity',this.value)">
        <button class="btn-icon" title="Notify" style="flex:0;background:${r.notify !== false ? "var(--gold)" : "var(--card)"};color:${r.notify !== false ? "var(--bg)" : "var(--cream)"}" onclick="updateRoutineItem(${i},'notify',${r.notify === false})">🔔</button>
        <button class="btn-icon" style="flex:0" onclick="removeRoutineItem(${i})">✕</button>
      </div>`).join("")}
    <div class="row">
      <input type="time" id="rTime" style="flex:0;width:auto">
      <input id="rAct" placeholder="Activity">
      <button class="btn" onclick="addRoutineItem()">+</button>
    </div>
    <p class="small" style="margin-top:8px">🔔 toggles whether that block notifies you. All blocks notify by default.</p>
  </div>`;
}
function updateRoutineItem(i, field, val) { const items = [...S.routine]; items[i] = { ...items[i], [field]: val }; saveRoutine(items); }
function removeRoutineItem(i) { saveRoutine(S.routine.filter((_, idx) => idx !== i)); }
function addRoutineItem() {
  const time = document.getElementById("rTime").value, activity = document.getElementById("rAct").value.trim();
  if (!time || !activity) return;
  saveRoutine([...S.routine, { time, activity, notify: true }].sort((a, b) => a.time.localeCompare(b.time)));
}

function viewSettings() {
  const st = S.settings;
  return `<div class="card">
    <div class="section-title"><span class="left">⚙️ Prayer settings</span></div>
    <button class="btn" style="width:100%;margin-bottom:10px" onclick="enablePrayerAlerts()">📍 Use my current location</button>
    <p class="small" style="margin-bottom:10px">${st.lat ? `Location set (${st.lat.toFixed(2)}, ${st.lng.toFixed(2)}) · alerts ${st.notifEnabled ? "on" : "off"}` : "No location set yet"}</p>
    <label class="small">Calculation method</label>
    <select onchange="setPrayerSetting('method', this.value)" style="margin-bottom:10px">
      ${Object.keys(METHODS).map((k) => `<option value="${k}" ${st.method===k?"selected":""}>${METHODS[k].name}</option>`).join("")}
    </select>
    <div class="row" style="align-items:center">
      <span class="small">Asr calculation</span>
      <button class="btn secondary" style="flex:0" onclick="setPrayerSetting('hanafi', !S.settings.hanafi)">${st.hanafi ? "Hanafi" : "Shafi/Maliki/Hanbali"}</button>
    </div>
  </div>
  <div class="card">
    <div class="section-title"><span class="left">💾 Backup &amp; recovery</span></div>
    <p class="small" style="margin-bottom:10px">Everything here lives only on this device — nothing is ever auto-deleted, so finance, ideas, and notes stay searchable indefinitely. But local-only also means a lost or wiped phone loses it too, unless you've exported a backup.</p>
    <p class="small" style="margin-bottom:10px;color:${backupAgeColor()}">${backupAgeLabel()}</p>
    <button class="btn" style="width:100%;margin-bottom:8px" onclick="exportData()">⬇️ Download full backup (JSON)</button>
    <button class="btn secondary" style="width:100%" onclick="triggerImport()">⬆️ Restore from backup file</button>
    <input type="file" id="importFile" accept="application/json" style="display:none" onchange="importData(this)">
    <p class="small" style="margin-top:10px">On a new phone: install this app, open Settings, tap "Restore from backup file," and pick the JSON you saved. Best practice: after exporting, upload the file to Google Drive, email it to yourself, or send it to WhatsApp "Message yourself" so it's off the device too.</p>
  </div>
  <div class="card">
    <div class="section-title"><span class="left">🔒 App lock</span></div>
    ${S.security.enabled ? `
      <p class="small" style="margin-bottom:10px">PIN lock is on — the app locks itself after being backgrounded for 15+ seconds.</p>
      <input id="newPin" type="password" inputmode="numeric" maxlength="8" placeholder="New PIN (4–8 digits)" style="margin-bottom:8px">
      <button class="btn secondary" style="width:100%;margin-bottom:8px" onclick="setPin(document.getElementById('newPin').value)">Change PIN</button>
      <button class="btn danger" style="width:100%" onclick="removePin()">Turn off PIN lock</button>
    ` : `
      <input id="newPin" type="password" inputmode="numeric" maxlength="8" placeholder="Choose a 4–8 digit PIN" style="margin-bottom:8px">
      <button class="btn" style="width:100%" onclick="setPin(document.getElementById('newPin').value)">Turn on PIN lock</button>
    `}
  </div>
  ${renderAccountSection()}`;
}
function renderAccountSection() {
  const cloud = window.Cloud;
  if (!cloud || !cloud.enabled) {
    return `<div class="card">
      <div class="section-title"><span class="left">☁️ Account &amp; cloud sync</span></div>
      <p class="small">Not set up yet. Everything still works fully offline on this device. Follow SETUP.md (in the project files) to add free login + sync in about 10 minutes, so uninstalling/reinstalling the app never loses your data.</p>
    </div>`;
  }
  const user = cloud.currentUser();
  if (user) {
    return `<div class="card">
      <div class="section-title"><span class="left">☁️ Account &amp; cloud sync</span></div>
      <p class="small" style="margin-bottom:10px">Signed in as ${esc(user.email || user.phoneNumber || user.uid)}${user.emailVerified === false ? " (email not verified yet)" : ""}. Your data syncs automatically.</p>
      <button class="btn secondary" style="width:100%;margin-bottom:8px" onclick="Cloud.pullAll()">🔄 Force sync now</button>
      <button class="btn danger" style="width:100%" onclick="Cloud.signOutUser()">Sign out</button>
    </div>`;
  }
  return `<div class="card">
    <div class="section-title"><span class="left">☁️ Account &amp; cloud sync</span></div>
    <p class="small" style="margin-bottom:10px">Sign in so uninstalling, resetting, or switching phones never loses your data.</p>
    <div class="tabs-scroll" style="margin-bottom:10px">
      <button class="pill ${S._authMode!=='phone'?'active':''}" onclick="S._authMode='email';render()">📧 Email</button>
      <button class="pill ${S._authMode==='phone'?'active':''}" onclick="S._authMode='phone';render()">📱 Phone OTP</button>
    </div>
    ${S._authMode === "phone" ? `
      <input id="phoneInput" type="tel" placeholder="+923001234567" style="margin-bottom:8px">
      <button class="btn secondary" style="width:100%;margin-bottom:8px" onclick="Cloud.startPhoneAuth(document.getElementById('phoneInput').value)">Send SMS code</button>
      <input id="otpInput" placeholder="6-digit code" style="margin-bottom:8px">
      <button class="btn" style="width:100%" onclick="Cloud.confirmPhoneCode(document.getElementById('otpInput').value)">Verify &amp; sign in</button>
    ` : `
      <input id="authEmail" type="email" placeholder="you@example.com" style="margin-bottom:8px">
      <input id="authPw" type="password" placeholder="Password (6+ characters)" style="margin-bottom:8px">
      <div class="row" style="margin-bottom:8px">
        <button class="btn secondary" onclick="Cloud.signInEmail(document.getElementById('authEmail').value, document.getElementById('authPw').value)">Log in</button>
        <button class="btn" onclick="Cloud.signUpEmail(document.getElementById('authEmail').value, document.getElementById('authPw').value)">Sign up</button>
      </div>
      <button class="btn-icon" style="width:100%" onclick="Cloud.sendReset(document.getElementById('authEmail').value)">Forgot password?</button>
    `}
  </div>`;
}
function backupAgeLabel() {
  const last = S.settings.lastBackup;
  if (!last) return "⚠️ No backup taken yet.";
  const days = Math.floor((Date.now() - last) / 86400000);
  if (days === 0) return "✅ Backed up today.";
  if (days < 14) return `✅ Last backup: ${days} day${days === 1 ? "" : "s"} ago.`;
  return `⚠️ Last backup: ${days} days ago — export a fresh one.`;
}
function backupAgeColor() {
  const last = S.settings.lastBackup;
  const days = last ? (Date.now() - last) / 86400000 : Infinity;
  return days > 14 ? "var(--rose)" : "var(--green)";
}
function setPrayerSetting(key, val) {
  S.settings[key] = val;
  DB.put("settings", { id: "prayer", ...S.settings });
  if (S.settings.notifEnabled) scheduleAllNotifications();
  render();
}

/* ===================== Boot ===================== */
init();
