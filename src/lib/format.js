// Number, money (৳) and date formatting in English or Bangla digits.
export function num(n, lang = 'en') {
  return new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-IN', { maximumFractionDigits: 2 }).format(Number(n || 0));
}

export function money(n, lang = 'en') {
  const v = Number(n || 0);
  return (v < 0 ? '−৳' : '৳') + num(Math.abs(v), lang);
}

export function dateTime(iso, lang = 'en') {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));
}

// Start of today in Dhaka (UTC+6), as an ISO string for database filters.
export function startOfDhakaDay() {
  const d = new Date(Date.now() + 6 * 3600e3);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 6 * 3600e3).toISOString();
}

// Product or customer name in the current language (Bangla name when it exists).
export function localName(row, lang) {
  return (lang === 'bn' && row?.name_bn) || row?.name || '';
}

// A date N days after today in Dhaka, as YYYY-MM-DD (for due dates).
export function dhakaDatePlus(days = 0) {
  const d = new Date(Date.now() + 6 * 3600e3 + days * 86400e3);
  return d.toISOString().slice(0, 10);
}
