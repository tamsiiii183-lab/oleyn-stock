// Shrobon (শ্রবণ): the in-app assistant. Answers "how do I..." questions and simple questions about the user's data,
// in English or Bangla. Data is read WITH THE USER'S OWN LOGIN, so database rules apply: a Salesperson's assistant
// never receives cost, profit, purchases or payroll. Nothing is saved or changed by the assistant.
import { createClient } from '@supabase/supabase-js';

const GUIDE = `Oleyn Stock app guide (bottom bar: Home, Sell, Customers, Products, More):
- New sale: Sell > search or scan barcode > set quantity with - / + > choose customer > type Paid now (empty = paid in full) > Save invoice. The unpaid part becomes the customer's due. Share on WhatsApp or Print from the invoice.
- A Salesperson cannot sell more than stock ("Only N in stock"). The Owner can, only after typing a reason; it is flagged in Stock history.
- If the network fails, a peach banner says "Not saved yet. Your draft is safe." Tap Retry; it never creates a duplicate.
- Record payment: Home > Record payment (or Customers > shop > Record payment) > amount > Cash / bKash / Bank. bKash and Bank need the transaction ID. You cannot take more than the due.
- Customers: sorted by due; orange "Overdue" badge when the credit days have passed. Open a shop to see its ledger with running balance.
- Products: price and stock; tap a product for Stock history (who, when, why, how much). Stock by location shows each godown/branch.
- Owner only: More > New purchase (Scan memo with AI or Enter by hand), Adjust stock (reason + note), HR (raises, leave, advances, increment due), Payroll (attendance, overtime, bonus, salary sheet, approve, payslip), Accounts, Production, Godowns transfers, Supervision (who did what), API key info.
- Salesperson: Home > Receive stock (scan memo) sends items and quantities to the Owner for approval; prices are hidden.
- Language: EN / বাংলা switch in the top bar. Feedback: More > Feedback.`;

const TIMEOUT_MS = 15000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not_authenticated' });
  // A database client that acts AS THIS USER (their token), so Row Level Security filters everything.
  const db = createClient(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return res.status(401).json({ error: 'not_authenticated' });
  const { data: me } = await db.from('profiles').select('full_name, role').eq('id', u.user.id).maybeSingle();
  if (!me) return res.status(403).json({ error: 'not_allowed' });

  const { question = '', lang = 'en', history = [] } = req.body || {};
  if (!String(question).trim()) return res.status(400).json({ error: 'question_required' });
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) return res.status(502).json({ error: 'ai_failed' });

  // Role-safe facts: only what this user is allowed to read anyway.
  const since = new Date(Date.now() + 6 * 3600e3); since.setUTCHours(0, 0, 0, 0);
  const [prods, stock, custs, bals, mine] = await Promise.all([
    db.from('products').select('id, sku, name, name_bn, unit, sale_price').eq('is_active', true),
    db.from('product_stock').select('product_id, current_stock, is_low'),
    db.from('customers').select('id, name, name_bn, area, credit_days'),
    db.from('customer_balances').select('customer_id, due, is_overdue'),
    db.from('sales_invoices').select('total, due_amount').eq('created_by', u.user.id).eq('status', 'posted')
      .gte('created_at', new Date(since.getTime() - 6 * 3600e3).toISOString()),
  ]);
  const st = Object.fromEntries((stock.data || []).map((s) => [s.product_id, s]));
  const bl = Object.fromEntries((bals.data || []).map((b) => [b.customer_id, b]));
  const facts = {
    me: { name: me.full_name, role: me.role },
    products: (prods.data || []).slice(0, 80).map((p) => ({ name: p.name, bn: p.name_bn, sku: p.sku, unit: p.unit, price: Number(p.sale_price),
      stock: Number(st[p.id]?.current_stock || 0), low: Boolean(st[p.id]?.is_low) })),
    customers: (custs.data || []).slice(0, 60).map((c) => ({ name: c.name, bn: c.name_bn, area: c.area, credit_days: c.credit_days,
      due: Number(bl[c.id]?.due || 0), overdue: Boolean(bl[c.id]?.is_overdue) })),
    my_sales_today: { invoices: (mine.data || []).length, total: (mine.data || []).reduce((s, r) => s + Number(r.total), 0) },
  };
  const rules = `You are Shrobon, the friendly assistant inside the Oleyn Stock app for small wholesalers in Bangladesh.
Answer in ${lang === 'bn' ? 'Bangla (বাংলা), using simple words' : 'simple English'}; at most 6 short lines. Money uses ৳.
Use ONLY the app guide and the data below. If the data does not contain the answer, say so and tell the user which screen to open.
Never invent numbers. The user is a ${me.role}; ${me.role === 'salesperson' ? 'never discuss cost price, profit, purchases, salaries or payroll.' : 'the data below has no cost or profit; for those, point to Home or Accounts.'}
You cannot change anything in the app; explain the steps instead.`;
  const turns = (Array.isArray(history) ? history.slice(-4) : []).flatMap((h) => [
    { role: 'user', parts: [{ text: String(h.q || '').slice(0, 500) }] }, { role: 'model', parts: [{ text: String(h.a || '').slice(0, 800) }] },
  ]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL}:generateContent`, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${rules}\n\n${GUIDE}\n\nDATA (JSON):\n${JSON.stringify(facts)}` }] },
        contents: [...turns, { role: 'user', parts: [{ text: String(question).slice(0, 800) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
      }),
    });
    if (!r.ok) { console.error('assistant gemini', r.status, await r.text()); return res.status(502).json({ error: 'ai_failed' }); }
    const body = await r.json();
    const answer = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
    if (!answer) return res.status(502).json({ error: 'ai_failed' });
    return res.status(200).json({ answer });
  } catch (e) {
    console.error('assistant error', e.name, e.message);
    return res.status(e.name === 'AbortError' ? 504 : 502).json({ error: 'ai_failed' });
  } finally {
    clearTimeout(timer);
  }
}
