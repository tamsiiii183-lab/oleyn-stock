// Turns one audit_log row into a short sentence for the Supervision screen, plus the list of changed fields.
const AREA = {
  sales_invoices: 'sales', customer_ledger: 'money', purchases: 'stock', stock_movements: 'stock', stock_transfers: 'stock',
  purchase_requests: 'stock', products: 'stock', product_costs: 'stock', customers: 'customers',
  employees: 'hr', salary_revisions: 'hr', salary_advances: 'hr', leaves: 'hr', payroll_runs: 'hr',
};
const HIDE = new Set(['created_at', 'updated_at', 'id', 'client_ref', 'created_by']);

export function areaOf(row) {
  return AREA[row.table_name] || 'stock';
}

// Fields whose value changed in an update: [{ key, from, to }].
export function changes(row) {
  if (row.action !== 'update' || !row.old_data || !row.new_data) return [];
  return Object.keys(row.new_data).filter((k) => !HIDE.has(k) && JSON.stringify(row.old_data[k]) !== JSON.stringify(row.new_data[k]))
    .map((k) => ({ key: k, from: row.old_data[k], to: row.new_data[k] }));
}

// Plain-English summary; names come from lookups { product, customer, employee }.
export function describe(row, n, money) {
  const d = row.new_data || row.old_data || {};
  const p = n.product[d.product_id] || d.name || '';
  const c = n.customer[d.customer_id] || '';
  const e = n.employee[d.employee_id] || d.full_name || '';
  const upd = row.action === 'update';
  switch (row.table_name) {
    case 'sales_invoices':
      if (upd && d.status === 'cancelled') return `Cancelled invoice ${d.invoice_no}`;
      return `Sale ${d.invoice_no} · ${money(d.total)}${Number(d.due_amount) > 0 ? ` (due ${money(d.due_amount)}${c ? `, ${c}` : ''})` : ''}`;
    case 'customer_ledger':
      return d.entry_type === 'payment' ? `Payment ${money(-d.amount)} by ${d.method}${d.trx_ref ? ` (${d.trx_ref})` : ''} from ${c}` : `Due ${money(d.amount)} · ${c}`;
    case 'purchases': return `Purchase ${d.purchase_no} · ${money(d.total_cost)} (${d.source})${d.supplier_name ? ` from ${d.supplier_name}` : ''}`;
    case 'stock_movements': return `${d.reason === 'production_in' ? 'Produced' : d.reason === 'production_out' ? 'Used in production' : 'Adjusted stock'}: ${p} ${Number(d.qty_change) > 0 ? '+' : ''}${d.qty_change}${d.note ? ` · ${d.note}` : ''}`;
    case 'stock_transfers': return `Transfer ${d.transfer_no}: ${p} × ${d.qty}`;
    case 'purchase_requests': return upd ? `Stock request ${d.request_no} ${d.status}` : `Sent stock request ${d.request_no} (${(d.lines || []).length} items)`;
    case 'products': return upd ? `Edited product ${d.name}` : `Added product ${d.name}`;
    case 'product_costs': return `${upd ? 'Changed' : 'Set'} cost of ${p}`;
    case 'customers': return upd ? `Edited customer ${d.name}` : `Added customer ${d.name}`;
    case 'employees': return upd ? `Edited employee ${d.full_name}` : `Added employee ${d.full_name}`;
    case 'salary_revisions': return `Raise for ${e}: ${money(d.old_salary)} → ${money(d.new_salary)} (${d.reason})`;
    case 'salary_advances': return `Advance ${money(d.amount)} to ${e}`;
    case 'leaves': return `Leave for ${e}: ${d.leave_type}, ${d.days} day(s)`;
    case 'payroll_runs': return upd && d.status === 'approved' ? `Approved payroll ${String(d.month).slice(0, 7)}` : `Generated payroll ${String(d.month).slice(0, 7)}`;
    default: return `${row.action} ${row.table_name}`;
  }
}
