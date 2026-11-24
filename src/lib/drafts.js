// Safe save (spec 7.6): keeps each form's draft and its client_ref on the phone, so a retry never makes a duplicate.
export function newRef() {
  return crypto.randomUUID();
}

export function loadDraft(key, empty) {
  try {
    const d = JSON.parse(localStorage.getItem(`oleyn_draft_${key}`));
    if (d && d.client_ref) return { ...empty, ...d };
  } catch { /* no saved draft */ }
  return { ...empty, client_ref: newRef() };
}

export function saveDraft(key, draft) {
  try { localStorage.setItem(`oleyn_draft_${key}`, JSON.stringify(draft)); } catch { /* storage full or blocked */ }
}

export function clearDraft(key) {
  try { localStorage.removeItem(`oleyn_draft_${key}`); } catch { /* ignore */ }
}

// True when the save failed because of the network (offline, timeout), not because of a business rule.
export function isNetworkError(err) {
  if (!navigator.onLine) return true;
  const msg = String(err?.message || err || '');
  return /failed to fetch|networkerror|load failed|network request failed|timeout|fetch/i.test(msg) && !/^[A-Z_]+(:|$)/.test(msg);
}

// Money rounding to 2 decimals, the same as the database.
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
