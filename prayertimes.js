/* Fully offline prayer time calculation using standard solar-position
   astronomy (no network call, no external API). Accurate to within a
   minute or two of published tables — always fine to double check
   against your local masjid's announced iqamah time. */

const METHODS = {
  karachi: { fajr: 18, isha: 18, name: "University of Islamic Sciences, Karachi" },
  mwl:     { fajr: 18, isha: 17, name: "Muslim World League" },
  isna:    { fajr: 15, isha: 15, name: "ISNA (North America)" },
  egypt:   { fajr: 19.5, isha: 17.5, name: "Egyptian General Authority" },
  makkah:  { fajr: 18.5, isha: null, ishaMinutes: 90, name: "Umm al-Qura, Makkah" },
};

const dsin = (d) => Math.sin((d * Math.PI) / 180);
const dcos = (d) => Math.cos((d * Math.PI) / 180);
const dtan = (d) => Math.tan((d * Math.PI) / 180);
const darcsin = (x) => (Math.asin(x) * 180) / Math.PI;
const darccos = (x) => (Math.acos(Math.max(-1, Math.min(1, x))) * 180) / Math.PI;
const darctan2 = (y, x) => (Math.atan2(y, x) * 180) / Math.PI;
const darccot = (x) => (Math.atan2(1, x) * 180) / Math.PI;
const fixAngle = (a) => ((a % 360) + 360) % 360;
const fixHour = (h) => ((h % 24) + 24) % 24;

function julianDate(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D);
  const q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * dsin(g) + 0.02 * dsin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = fixHour(darctan2(dcos(e) * dsin(L), dcos(L)) / 15);
  const eqt = q / 15 - RA;
  const decl = darcsin(dsin(e) * dsin(L));
  return { decl, eqt };
}

function hourAngle(angle, lat, decl) {
  const val = (-dsin(angle) - dsin(lat) * dsin(decl)) / (dcos(lat) * dcos(decl));
  return darccos(val) / 15;
}

function asrHourAngle(shadowFactor, lat, decl) {
  const elevation = darccot(shadowFactor + Math.abs(dtan(lat - decl)));
  return hourAngle(-elevation, lat, decl);
}

/**
 * Compute today's prayer times for a given date/location.
 * @param {Date} date
 * @param {number} lat  latitude, degrees
 * @param {number} lng  longitude, degrees (east positive)
 * @param {number} tzOffsetHours  e.g. 5 for Pakistan Standard Time
 * @param {string} methodKey one of METHODS keys
 * @param {boolean} hanafiAsr use shadow factor 2 (Hanafi) instead of 1 (Shafi/Maliki/Hanbali)
 * @returns {{fajr,sunrise,dhuhr,asr,maghrib,isha}} each as "HH:MM" 24h local time
 */
function computePrayerTimes(date, lat, lng, tzOffsetHours, methodKey = "karachi", hanafiAsr = true) {
  const method = METHODS[methodKey] || METHODS.karachi;
  const jd = julianDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const { decl, eqt } = sunPosition(jd);

  const noon = 12 - lng / 15 + tzOffsetHours - eqt;
  const fajrHA = hourAngle(method.fajr, lat, decl);
  const sunsetHA = hourAngle(0.833, lat, decl);
  const asrHA = asrHourAngle(hanafiAsr ? 2 : 1, lat, decl);
  const ishaHA = method.isha != null ? hourAngle(method.isha, lat, decl) : null;

  const fajr = noon - fajrHA;
  const sunrise = noon - sunsetHA;
  const dhuhr = noon + 1 / 60; // +1 minute convention
  const asr = noon + asrHA;
  const maghrib = noon + sunsetHA;
  const isha = ishaHA != null ? noon + ishaHA : maghrib + (method.ishaMinutes || 90) / 60;

  const fmt = (h) => {
    h = fixHour(h);
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    const carry = mm === 60;
    return `${String(carry ? hh + 1 : hh).padStart(2, "0")}:${String(carry ? 0 : mm).padStart(2, "0")}`;
  };

  return {
    fajr: fmt(fajr),
    sunrise: fmt(sunrise),
    dhuhr: fmt(dhuhr),
    asr: fmt(asr),
    maghrib: fmt(maghrib),
    isha: fmt(isha),
    method: method.name,
  };
}
