// Turns a database error code (spec 7.7) into a message in the user's language.
import { errorCode } from './supabase.js';

export function errorText(t, error, extra = {}) {
  const { code, parts, message } = errorCode(error);
  if (code === 'INSUFFICIENT_STOCK') return t('err_INSUFFICIENT_STOCK', { product: extra.productName || parts[0], available: parts[1] });
  if (code === 'PAYMENT_EXCEEDS_DUE') return t('err_PAYMENT_EXCEEDS_DUE', { due: parts[0] });
  if (/duplicate key/i.test(message)) return t('sku_taken');
  const key = `err_${code}`;
  const text = t(key);
  return text === key ? t('something_wrong') : text;
}
