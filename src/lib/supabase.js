// The one Supabase connection for the browser. Uses only the PUBLIC key; the database rules protect the data.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// Turns a database error like "INSUFFICIENT_STOCK:PRAN-MANGO-250:12" into { code, parts }.
export function errorCode(error) {
  const msg = (error && (error.message || String(error))) || 'UNKNOWN';
  const [code, ...parts] = msg.split(':');
  return { code: code.trim(), parts, message: msg };
}
