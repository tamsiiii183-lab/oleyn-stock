-- 03_functions.sql: the business rules (sell, collect payment, buy, adjust, cancel). Run after 02_security.sql.
-- Each function runs as ONE transaction: everything saves or nothing does. They run with the database
-- owner's rights (security definer) and check the caller's role themselves, so the rules hold even if
-- someone bypasses the app.

-- Helper: the logged-in user's role, or stop with NOT_AUTHENTICATED.
create or replace function public.current_app_role() returns text
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select role into v_role from profiles where id = auth.uid();
  if v_role is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return v_role;
end $$;

-- Helper: what one customer owes right now (sum of their ledger).
create or replace function public.customer_due(p_customer_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from customer_ledger where customer_id = p_customer_id
$$;

-- Helper: current stock for a list of products, as [{product_id, current_stock}].
create or replace function public.stock_snapshot(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('product_id', s.product_id, 'current_stock', s.current_stock)), '[]'::jsonb)
  from product_stock s where s.product_id = any(p_ids)
$$;

-- Names of all staff (id and name only, no role) so history pages can show "who" to both roles.
create or replace function public.staff_names() returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from profiles p where auth.uid() is not null
$$;

-- 7.1 create_sale: saves an invoice, its lines, costs, stock-out movements and any due, in one go.
create or replace function public.create_sale(
  p_client_ref uuid, p_customer_id uuid, p_lines jsonb,
  p_discount numeric default 0, p_vat_rate numeric default 0, p_paid_now numeric default 0,
  p_due_date date default null, p_override_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := current_app_role();
  v_inv sales_invoices%rowtype;
  v_line jsonb; v_items jsonb := '[]'::jsonb; v_ids uuid[] := '{}';
  v_pid uuid; v_qty numeric; v_price numeric; v_need record; v_available numeric;
  v_override_ids uuid[] := '{}';
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_discount numeric := coalesce(p_discount, 0);
  v_vat_rate numeric := coalesce(p_vat_rate, 0);
  v_paid numeric := coalesce(p_paid_now, 0);
  v_subtotal numeric := 0; v_vat numeric; v_total numeric; v_due numeric;
  v_credit_days int; v_due_date date; v_first boolean;
  v_invoice_id uuid; v_invoice_no text; v_line_id uuid;
begin
  if p_client_ref is null then raise exception 'CLIENT_REF_REQUIRED'; end if;
  -- Two arrivals of the same draft wait for each other instead of racing.
  perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));

  -- Step 1: this draft was already saved, so return that invoice and write nothing.
  select * into v_inv from sales_invoices where client_ref = p_client_ref;
  if found then
    return jsonb_build_object('invoice_id', v_inv.id, 'invoice_no', v_inv.invoice_no, 'total', v_inv.total,
      'paid_now', v_inv.paid_now, 'due_added', v_inv.due_amount,
      'customer_due', case when v_inv.customer_id is not null then customer_due(v_inv.customer_id) end,
      'stock', stock_snapshot(array(select product_id from sales_invoice_lines where invoice_id = v_inv.id)),
      'duplicate', true);
  end if;

  -- Step 2: at least one line, every qty a number above 0, every product id well formed.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_INVOICE';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line->>'qty', '') !~ '^[0-9]+(\.[0-9]+)?$' or (v_line->>'qty')::numeric <= 0 then
      raise exception 'INVALID_QTY';
    end if;
    if coalesce(v_line->>'product_id', '') !~* '^[0-9a-f-]{36}$' then raise exception 'PRODUCT_NOT_FOUND'; end if;
    v_ids := v_ids || (v_line->>'product_id')::uuid;
  end loop;

  -- Step 4: lock these products so two people can't sell the last unit at the same moment.
  perform 1 from products where id = any(v_ids) order by id for update;
  if (select count(*) from products where id = any(v_ids) and is_active)
     <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  -- Step 3: a Salesperson always sells at the list price with no discount; the Owner may change price.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pid := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    select sale_price into v_price from products where id = v_pid;
    if v_role = 'owner' and v_line->>'unit_price' is not null then
      if (v_line->>'unit_price') !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'INVALID_PRICE'; end if;
      v_price := (v_line->>'unit_price')::numeric;
    end if;
    v_price := round(v_price, 2);
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', v_pid, 'qty', v_qty,
      'unit_price', v_price, 'line_total', round(v_qty * v_price, 2)));
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
  end loop;
  if v_role <> 'owner' then v_discount := 0; end if;

  -- Step 5: the oversell rule (7.2), checked per product against the ledger.
  for v_need in select (i->>'product_id')::uuid as product_id, sum((i->>'qty')::numeric) as qty
                from jsonb_array_elements(v_items) i group by 1 loop
    select coalesce(sum(qty_change), 0) into v_available from stock_movements where product_id = v_need.product_id;
    if v_need.qty > v_available then
      if v_role <> 'owner' then
        raise exception 'INSUFFICIENT_STOCK:%:%', (select sku from products where id = v_need.product_id),
          trim_scale(greatest(v_available, 0));
      elsif v_reason is null then
        raise exception 'OVERRIDE_REASON_REQUIRED';
      end if;
      v_override_ids := v_override_ids || v_need.product_id;
    end if;
  end loop;

  -- Step 6: totals, stored exactly as shown on screen and print.
  if v_discount < 0 or v_discount > v_subtotal then raise exception 'INVALID_DISCOUNT'; end if;
  if v_vat_rate < 0 or v_vat_rate > 100 then raise exception 'INVALID_VAT'; end if;
  v_vat := round((v_subtotal - v_discount) * v_vat_rate / 100, 2);
  v_total := round(v_subtotal - v_discount + v_vat, 2);

  -- Step 7: paid must be between 0 and total; any unpaid part needs a customer and a due date.
  if v_paid < 0 or v_paid > v_total then raise exception 'PAID_EXCEEDS_TOTAL'; end if;
  v_due := v_total - v_paid;
  if p_customer_id is not null then
    select credit_days into v_credit_days from customers where id = p_customer_id;
    if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  end if;
  if v_due > 0 then
    if p_customer_id is null then raise exception 'CUSTOMER_REQUIRED_FOR_CREDIT'; end if;
    v_due_date := coalesce(p_due_date, (now() at time zone 'Asia/Dhaka')::date + v_credit_days);
  end if;

  -- Activation: is this the user's first posted invoice?
  v_first := not exists (select 1 from sales_invoices where created_by = v_uid and status = 'posted');

  -- Step 8: the invoice, then per line: the line, its cost at this moment, and a stock-out movement.
  v_invoice_no := 'INV-' || lpad(nextval('invoice_no_seq')::text, 6, '0');
  insert into sales_invoices (invoice_no, client_ref, customer_id, subtotal, discount, vat_rate, vat_amount,
                              total, paid_now, due_amount, due_date, created_by)
  values (v_invoice_no, p_client_ref, p_customer_id, v_subtotal, v_discount, v_vat_rate, v_vat,
          v_total, v_paid, v_due, v_due_date, v_uid)
  returning id into v_invoice_id;
  for v_line in select * from jsonb_array_elements(v_items) loop
    v_pid := (v_line->>'product_id')::uuid;
    insert into sales_invoice_lines (invoice_id, product_id, qty, unit_price, line_total)
    values (v_invoice_id, v_pid, (v_line->>'qty')::numeric, (v_line->>'unit_price')::numeric,
            (v_line->>'line_total')::numeric)
    returning id into v_line_id;
    insert into sale_line_costs (line_id, unit_cost)
    values (v_line_id, coalesce((select cost_price from product_costs where product_id = v_pid), 0));
    insert into stock_movements (product_id, qty_change, reason, source_type, source_id, note, oversell_override, created_by)
    values (v_pid, -(v_line->>'qty')::numeric, 'sale', 'invoice', v_invoice_id,
            case when v_pid = any(v_override_ids) then 'Oversell: ' || v_reason end,
            v_pid = any(v_override_ids), v_uid);
  end loop;

  -- Step 9: the unpaid part goes on the customer's dues ledger.
  if v_due > 0 then
    insert into customer_ledger (customer_id, amount, entry_type, invoice_id, note, created_by)
    values (p_customer_id, v_due, 'credit_sale', v_invoice_id, v_invoice_no, v_uid);
  end if;

  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_no', v_invoice_no, 'total', v_total,
    'paid_now', v_paid, 'due_added', v_due,
    'customer_due', case when p_customer_id is not null then customer_due(p_customer_id) end,
    'stock', stock_snapshot(v_ids), 'oversell_override', cardinality(v_override_ids) > 0,
    'is_first_real_invoice', v_first, 'duplicate', false);
end $$;

-- 7.3 record_payment: a customer pays part or all of their due (both roles).
create or replace function public.record_payment(
  p_client_ref uuid, p_customer_id uuid, p_amount numeric, p_method text,
  p_trx_ref text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := current_app_role();
  v_existing customer_ledger%rowtype;
  v_due numeric; v_id bigint;
  v_trx text := nullif(btrim(coalesce(p_trx_ref, '')), '');
begin
  if p_client_ref is null then raise exception 'CLIENT_REF_REQUIRED'; end if;
  -- Two arrivals of the same payment draft wait for each other instead of racing.
  perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));
  -- Same draft already saved: return it and write nothing.
  select * into v_existing from customer_ledger where client_ref = p_client_ref;
  if found then
    return jsonb_build_object('entry_id', v_existing.id, 'new_due', customer_due(v_existing.customer_id), 'duplicate', true);
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_method is null or p_method not in ('cash', 'bkash', 'bank') then raise exception 'INVALID_METHOD'; end if;
  -- Lock the customer so two payments at once can't both pass the "not more than due" check.
  perform 1 from customers where id = p_customer_id for update;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  v_due := customer_due(p_customer_id);
  if round(p_amount, 2) > v_due then raise exception 'PAYMENT_EXCEEDS_DUE:%', trim_scale(v_due); end if;
  if p_method in ('bkash', 'bank') and v_trx is null then raise exception 'TRX_REF_REQUIRED'; end if;
  insert into customer_ledger (customer_id, amount, entry_type, method, trx_ref, note, client_ref, created_by)
  values (p_customer_id, -round(p_amount, 2), 'payment', p_method, v_trx, nullif(btrim(coalesce(p_note, '')), ''),
          p_client_ref, v_uid)
  returning id into v_id;
  return jsonb_build_object('entry_id', v_id, 'new_due', customer_due(p_customer_id), 'duplicate', false);
end $$;

-- 7.4 create_purchase: stock bought from a supplier (Owner only). Updates latest cost and adds stock.
create or replace function public.create_purchase(
  p_client_ref uuid, p_supplier_name text, p_lines jsonb, p_source text default 'manual',
  p_ai_extraction_id uuid default null, p_fields_edited int default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := current_app_role();
  v_existing purchases%rowtype;
  v_line jsonb; v_ids uuid[] := '{}'; v_pid uuid; v_qty numeric; v_cost numeric;
  v_total numeric := 0; v_purchase_id uuid; v_purchase_no text;
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if p_client_ref is null then raise exception 'CLIENT_REF_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));
  -- Same draft already saved: return it and write nothing.
  select * into v_existing from purchases where client_ref = p_client_ref;
  if found then
    return jsonb_build_object('purchase_id', v_existing.id, 'purchase_no', v_existing.purchase_no,
      'total_cost', v_existing.total_cost,
      'stock', stock_snapshot(array(select product_id from purchase_lines where purchase_id = v_existing.id)),
      'duplicate', true);
  end if;
  if coalesce(p_source, '') not in ('manual', 'ai') then raise exception 'INVALID_SOURCE'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_INVOICE';
  end if;
  -- Check every line before writing anything.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line->>'qty', '') !~ '^[0-9]+(\.[0-9]+)?$' or (v_line->>'qty')::numeric <= 0 then
      raise exception 'INVALID_QTY';
    end if;
    if coalesce(v_line->>'unit_cost', '') !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'INVALID_PRICE'; end if;
    if coalesce(v_line->>'product_id', '') !~* '^[0-9a-f-]{36}$' then raise exception 'PRODUCT_NOT_FOUND'; end if;
    v_ids := v_ids || (v_line->>'product_id')::uuid;
  end loop;
  if (select count(*) from products where id = any(v_ids)) <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  v_purchase_no := 'PUR-' || lpad(nextval('purchase_no_seq')::text, 6, '0');
  insert into purchases (purchase_no, client_ref, supplier_name, source, ai_extraction_id, total_cost, created_by)
  values (v_purchase_no, p_client_ref, nullif(btrim(coalesce(p_supplier_name, '')), ''), p_source,
          p_ai_extraction_id, 0, v_uid)
  returning id into v_purchase_id;
  -- Per line: the purchase line, the latest cost for the product, and a stock-in movement.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pid := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_cost := round((v_line->>'unit_cost')::numeric, 2);
    insert into purchase_lines (purchase_id, product_id, qty, unit_cost, line_total)
    values (v_purchase_id, v_pid, v_qty, v_cost, round(v_qty * v_cost, 2));
    insert into product_costs (product_id, cost_price, updated_at) values (v_pid, v_cost, now())
    on conflict (product_id) do update set cost_price = excluded.cost_price, updated_at = now();
    insert into stock_movements (product_id, qty_change, reason, source_type, source_id, note, created_by)
    values (v_pid, v_qty, 'purchase', 'purchase', v_purchase_id, v_purchase_no, v_uid);
    v_total := v_total + round(v_qty * v_cost, 2);
  end loop;
  update purchases set total_cost = v_total where id = v_purchase_id;
  -- If the AI filled this form, link the extraction and record how many fields the Owner corrected.
  if p_source = 'ai' and p_ai_extraction_id is not null then
    update ai_extractions set purchase_id = v_purchase_id, fields_edited = p_fields_edited where id = p_ai_extraction_id;
  end if;
  return jsonb_build_object('purchase_id', v_purchase_id, 'purchase_no', v_purchase_no, 'total_cost', v_total,
    'stock', stock_snapshot(v_ids), 'duplicate', false);
end $$;

-- 7.5 adjust_stock: damaged, expired, lost, free sample or count correction (Owner only, note required).
create or replace function public.adjust_stock(
  p_product_id uuid, p_qty_change numeric, p_reason text, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := current_app_role();
  v_id bigint;
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if p_qty_change is null or p_qty_change = 0 then raise exception 'INVALID_QTY'; end if;
  if coalesce(p_reason, '') not in ('adjust_damage', 'adjust_expired', 'adjust_lost', 'adjust_sample', 'adjust_count') then
    raise exception 'INVALID_REASON';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'NOTE_REQUIRED'; end if;
  perform 1 from products where id = p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  insert into stock_movements (product_id, qty_change, reason, source_type, note, created_by)
  values (p_product_id, round(p_qty_change, 2), p_reason, 'adjustment', btrim(p_note), v_uid)
  returning id into v_id;
  return jsonb_build_object('movement_id', v_id, 'stock', stock_snapshot(array[p_product_id]));
end $$;

-- 7.5 cancel_invoice: marks an invoice cancelled, returns its stock and removes its due (Owner only).
-- Fixes v0 bug FB-011 (deleting an invoice did not return stock). Nothing is deleted.
create or replace function public.cancel_invoice(p_invoice_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := current_app_role();
  v_inv sales_invoices%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED'; end if;
  select * into v_inv from sales_invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_inv.status = 'cancelled' then raise exception 'ALREADY_CANCELLED'; end if;
  update sales_invoices set status = 'cancelled' where id = p_invoice_id;
  -- Put every sold item back in stock.
  insert into stock_movements (product_id, qty_change, reason, source_type, source_id, note, created_by)
  select l.product_id, l.qty, 'sale_cancel', 'invoice', p_invoice_id, 'Cancelled ' || v_inv.invoice_no || ': ' || v_reason, v_uid
  from sales_invoice_lines l where l.invoice_id = p_invoice_id;
  -- Remove the credit this invoice added to the customer's due.
  if v_inv.due_amount > 0 then
    insert into customer_ledger (customer_id, amount, entry_type, invoice_id, note, created_by)
    values (v_inv.customer_id, -v_inv.due_amount, 'sale_cancel', p_invoice_id,
            'Cancelled ' || v_inv.invoice_no || ': ' || v_reason, v_uid);
  end if;
  return jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled',
    'customer_due', case when v_inv.customer_id is not null then customer_due(v_inv.customer_id) end,
    'stock', stock_snapshot(array(select product_id from sales_invoice_lines where invoice_id = p_invoice_id)));
end $$;

-- Lock down: by default Postgres lets anyone run a function. Remove that for everything in public...
revoke execute on all functions in schema public from public, anon, authenticated;
-- ...then allow logged-in users to call only the app's entry points (each checks the role itself).
grant execute on function public.is_owner(), public.staff_names(),
  public.create_sale(uuid, uuid, jsonb, numeric, numeric, numeric, date, text),
  public.record_payment(uuid, uuid, numeric, text, text, text),
  public.create_purchase(uuid, text, jsonb, text, uuid, int),
  public.adjust_stock(uuid, numeric, text, text),
  public.cancel_invoice(uuid, text)
to authenticated;
-- The server key (used by /api functions) may run everything.
grant execute on all functions in schema public to service_role;
