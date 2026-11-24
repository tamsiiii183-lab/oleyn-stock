// Public JSON API (spec 9): GET /api/v1/stock?sku=... or ?barcode=... with header x-api-key.
// Returns the current stock of one product. Never returns cost or profit.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key, content-type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    // 1. The key: only its SHA-256 hash is stored, so compare hashes. Revoked keys don't count.
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'invalid_api_key' });
    const hash = createHash('sha256').update(String(key)).digest('hex');
    const { data: apiKey } = await admin.from('api_keys').select('id').eq('key_hash', hash).is('revoked_at', null).maybeSingle();
    if (!apiKey) return res.status(401).json({ error: 'invalid_api_key' });

    // 2. Which product?
    const sku = typeof req.query.sku === 'string' ? req.query.sku.trim() : '';
    const barcode = typeof req.query.barcode === 'string' ? req.query.barcode.trim() : '';
    if (!sku && !barcode) return res.status(400).json({ error: 'sku_or_barcode_required' });
    let q = admin.from('products').select('id, sku, name, unit').eq('is_active', true);
    q = sku ? q.ilike('sku', sku) : q.eq('barcode', barcode);
    const { data: product } = await q.maybeSingle();
    if (!product) return res.status(404).json({ error: 'product_not_found' });

    // 3. Current stock = sum of the stock ledger (product_stock view).
    const { data: stock } = await admin.from('product_stock').select('current_stock, is_low').eq('product_id', product.id).single();
    return res.status(200).json({
      sku: product.sku, name: product.name, unit: product.unit,
      current_stock: Number(stock?.current_stock || 0), low_stock: Boolean(stock?.is_low), as_of: new Date().toISOString(),
    });
  } catch (e) {
    console.error('stock api error', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
