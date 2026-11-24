// AI: supplier memo photo -> suggested purchase lines (Owner only). Calls Gemini with a 20 s timeout, checks the
// maths, matches products, and logs every attempt in ai_extractions. Nothing is saved as a purchase here.
import { createClient } from '@supabase/supabase-js';

const PROMPT = `You read supplier purchase memos from wholesale and retail shops in Bangladesh.
The memo may be printed or handwritten, in Bangla or English, and may use Bangla digits (০-৯).
Extract every line item. Rules:
- Convert Bangla digits to Western digits.
- qty is a number only; put the unit (pcs, carton, kg, litre, dozen, bag) in "unit".
- Prices are in BDT: no ৳ sign, no commas.
- If a value is unreadable, return null for it and give the line a confidence below 0.5.
- Never invent items that are not on the memo.
- confidence is 0 to 1: how sure you are the whole line was read correctly.
Return only JSON that matches the schema.`;

// Output schema from spec 8.4 (OpenAPI-style, as Gemini's responseSchema expects).
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    supplier_name: { type: 'STRING', nullable: true },
    memo_date: { type: 'STRING', nullable: true },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item_name: { type: 'STRING' }, qty: { type: 'NUMBER', nullable: true }, unit: { type: 'STRING', nullable: true },
          unit_price: { type: 'NUMBER', nullable: true }, line_total: { type: 'NUMBER', nullable: true }, confidence: { type: 'NUMBER' },
        },
        required: ['item_name', 'confidence'],
      },
    },
    memo_total: { type: 'NUMBER', nullable: true },
  },
  required: ['lines'],
};

const TIMEOUT_MS = 20000;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9ঀ-৿]+/g, ' ').trim();

// Spec 8.5: match item_name to products.name, name_bn or sku (case-insensitive contains, both directions).
function matchProduct(item, products) {
  const n = norm(item);
  if (!n) return null;
  const hit = products.find((p) => [p.sku, p.name, p.name_bn].some((v) => {
    const pv = norm(v);
    return pv && (pv.includes(n) || n.includes(pv));
  }));
  if (hit) return hit.id;
  // Fallback: two or more shared words (e.g. "Fresh Chini 1kg" vs "Fresh Sugar 1kg" shares "fresh", "1kg").
  const words = new Set(n.split(' ').filter((w) => w.length > 1));
  let best = null; let bestScore = 1;
  for (const p of products) {
    const score = norm(`${p.name} ${p.name_bn || ''}`).split(' ').filter((w) => words.has(w)).length;
    if (score > bestScore) { best = p.id; bestScore = score; }
  }
  return best;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1. Who is calling? Only a logged-in Owner may use the AI (and spend the API quota).
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const { data: userData } = token ? await admin.auth.getUser(token) : { data: null };
  const user = userData?.user;
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'owner') return res.status(403).json({ error: 'not_allowed' });

  const { image_base64: image, mime_type: mime = 'image/jpeg' } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image_required' });
  const model = process.env.GEMINI_MODEL || 'unset';
  const started = Date.now();

  // Logs one ai_extractions row and returns its id.
  async function log(status, raw, fieldsTotal = null) {
    const { data } = await admin.from('ai_extractions').insert({
      created_by: user.id, model, latency_ms: Date.now() - started, status, raw_output: raw, fields_total: fieldsTotal,
    }).select('id').single();
    return data?.id || null;
  }
  async function fail(status, reason, detail) {
    console.error('extract-memo failed:', reason, detail);
    const id = await log(status, { reason, detail: String(detail || '').slice(0, 500) });
    return res.status(reason === 'timeout' ? 504 : 502).json({ error: 'ai_failed', reason, extraction_id: id });
  }

  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) return fail('error', 'error', 'Gemini key or model not set');

  // 2. Ask Gemini, giving up after 20 seconds.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let parsed;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: image } }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
      }),
    });
    if (r.status === 429) return fail('error', 'rate_limit', await r.text());
    if (!r.ok) return fail('error', 'error', `${r.status} ${await r.text()}`);
    const body = await r.json();
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    try { parsed = JSON.parse(text); } catch { return fail('invalid_json', 'invalid_json', text); }
    if (!parsed || !Array.isArray(parsed.lines)) return fail('invalid_json', 'invalid_json', text);
  } catch (e) {
    return fail(e.name === 'AbortError' ? 'timeout' : 'error', e.name === 'AbortError' ? 'timeout' : 'error', e.message);
  } finally {
    clearTimeout(timer);
  }

  // 3. Server checks (spec 8.5): product match, line maths, memo total.
  const { data: products } = await admin.from('products').select('id, sku, name, name_bn').eq('is_active', true);
  const warnings = [];
  const lines = parsed.lines.map((l, i) => {
    let confidence = Number.isFinite(Number(l.confidence)) ? Number(l.confidence) : 0;
    const qty = l.qty == null ? null : Number(l.qty);
    const unitCost = l.unit_price == null ? null : Number(l.unit_price);
    const lineTotal = l.line_total == null ? null : Number(l.line_total);
    if (qty != null && unitCost != null && lineTotal != null && Math.abs(qty * unitCost - lineTotal) > Math.abs(lineTotal) * 0.01) {
      warnings.push(`Line ${i + 1}: ${qty} × ${unitCost} ≠ ${lineTotal}`);
      confidence = Math.min(confidence, 0.5);
    }
    return { item_name: l.item_name || '', product_id: matchProduct(l.item_name, products || []), qty, unit: l.unit || null,
      unit_cost: unitCost, line_total: lineTotal, confidence };
  });
  const sum = lines.reduce((s, l) => s + (l.line_total || 0), 0);
  if (parsed.memo_total != null && Math.abs(sum - Number(parsed.memo_total)) > Math.max(1, Number(parsed.memo_total) * 0.01)) {
    warnings.push(`Line totals add up to ${sum}, but the memo total is ${parsed.memo_total}`);
  }

  const id = await log('ok', parsed, lines.length * 5);
  return res.status(200).json({ extraction_id: id, supplier_name: parsed.supplier_name || null, memo_date: parsed.memo_date || null,
    lines, memo_total: parsed.memo_total ?? null, warnings, latency_ms: Date.now() - started, model });
}
