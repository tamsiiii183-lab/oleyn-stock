-- 06_tests.sql: automatic checks of the business rules and security. Run in the SQL Editor after 03.
-- Uses throw-away test users and products; EVERYTHING is rolled back at the end, so real data is untouched.
-- Part B checks the demo data from 04_seed.sql (read-only). Every row in the result must say passed = true.

-- A temporary test function; it disappears when the SQL Editor session ends.
create or replace function pg_temp.oleyn_rule_tests() returns table (test text, passed boolean, detail text)
language plpgsql as $$
declare
  n text[] := '{}'; ok boolean[] := '{}'; d text[] := '{}';
  v_owner uuid := gen_random_uuid(); v_sales uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_c uuid; v_cust uuid; v_ref uuid; v_inv uuid;
  r jsonb; v_num numeric; v_num2 numeric; v_cnt int; v_err text;
begin
  begin
    -- Throw-away Owner and Salesperson logins, three products and one customer.
    insert into auth.users (id, email, aud, role) values
      (v_owner, 'owner-' || v_owner || '@example.test', 'authenticated', 'authenticated'),
      (v_sales, 'sales-' || v_sales || '@example.test', 'authenticated', 'authenticated');
    insert into profiles (id, full_name, role) values (v_owner, 'Test Owner', 'owner'), (v_sales, 'Test Sales', 'salesperson');
    insert into products (sku, name, sale_price, created_by) values ('ZZTEST-A', 'Test A', 100, v_owner) returning id into v_a;
    insert into products (sku, name, sale_price, created_by) values ('ZZTEST-B', 'Test B', 1000, v_owner) returning id into v_b;
    insert into products (sku, name, sale_price, created_by) values ('ZZTEST-C', 'Test C', 50, v_owner) returning id into v_c;
    insert into customers (name, credit_days, created_by) values ('Test Shop', 30, v_owner) returning id into v_cust;

    -- Act as the Owner.
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

    -- T04: buy 10, sell 3, stock 7.
    r := create_purchase(gen_random_uuid(), 'Test Supplier', jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 10, 'unit_cost', 60)), 'manual');
    r := create_sale(p_client_ref => gen_random_uuid(), p_customer_id => null,
      p_lines => jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 3, 'unit_price', 100)), p_paid_now => 300);
    select current_stock into v_num from product_stock where product_id = v_a;
    n := n || 'T04 buy 10, sell 3 -> stock 7'::text; ok := ok || (v_num = 7); d := d || ('stock ' || v_num);
    select count(*) into v_cnt from stock_movements where product_id = v_a and created_by = v_owner
      and ((reason = 'purchase' and qty_change = 10) or (reason = 'sale' and qty_change = -3));
    n := n || 'T04 history has +10 purchase and -3 sale with who'::text; ok := ok || (v_cnt = 2); d := d || (v_cnt || ' rows');

    -- T05: adjust -2 damaged with a note, stock 5.
    r := adjust_stock(v_a, -2, 'adjust_damage', 'Carton torn');
    select current_stock into v_num from product_stock where product_id = v_a;
    n := n || 'T05 adjust -2 damaged -> stock 5'::text; ok := ok || (v_num = 5); d := d || ('stock ' || v_num);

    -- T10: credit sale 5,000 with 0 paid, then 2,000 cash and 1,000 bKash, due 2,000.
    r := create_purchase(gen_random_uuid(), 'Test Supplier', jsonb_build_array(jsonb_build_object('product_id', v_b, 'qty', 20, 'unit_cost', 800)), 'manual');
    r := create_sale(p_client_ref => gen_random_uuid(), p_customer_id => v_cust,
      p_lines => jsonb_build_array(jsonb_build_object('product_id', v_b, 'qty', 5)), p_paid_now => 0);
    r := record_payment(gen_random_uuid(), v_cust, 2000, 'cash');
    r := record_payment(gen_random_uuid(), v_cust, 1000, 'bkash', 'TRX123');
    select due into v_num from customer_balances where customer_id = v_cust;
    select count(*) into v_cnt from customer_ledger where customer_id = v_cust;
    n := n || 'T10 credit 5000, pay 2000 cash + 1000 bKash -> due 2000, 3 ledger lines'::text;
    ok := ok || (v_num = 2000 and v_cnt = 3); d := d || ('due ' || v_num || ', lines ' || v_cnt);

    -- T11: paying more than the due is refused, and the message carries the due.
    begin r := record_payment(gen_random_uuid(), v_cust, 2500, 'cash'); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'T11 payment above due refused'::text; ok := ok || (v_err = 'PAYMENT_EXCEEDS_DUE:2000'); d := d || v_err;

    -- T12: bKash payment without a transaction ID is refused.
    begin r := record_payment(gen_random_uuid(), v_cust, 100, 'bkash'); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'T12 bKash without trx ID refused'::text; ok := ok || (v_err = 'TRX_REF_REQUIRED'); d := d || v_err;

    -- T07: with 12 in stock, a Salesperson selling 20 is blocked.
    r := create_purchase(gen_random_uuid(), 'Test Supplier', jsonb_build_array(jsonb_build_object('product_id', v_c, 'qty', 12, 'unit_cost', 40)), 'manual');
    perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
    begin r := create_sale(p_client_ref => gen_random_uuid(), p_customer_id => null,
      p_lines => jsonb_build_array(jsonb_build_object('product_id', v_c, 'qty', 20)), p_paid_now => 1000); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'T07 Salesperson oversell 20 of 12 blocked'::text; ok := ok || (v_err = 'INSUFFICIENT_STOCK:ZZTEST-C:12'); d := d || v_err;

    -- Salesperson price and discount are forced to the list price and 0.
    r := create_sale(p_client_ref => gen_random_uuid(), p_customer_id => null,
      p_lines => jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 1, 'unit_price', 1)), p_discount => 10, p_paid_now => 100);
    n := n || 'Salesperson cannot change price or discount'::text; ok := ok || ((r->>'total')::numeric = 100); d := d || ('total ' || (r->>'total'));

    -- Salesperson may not buy stock.
    begin r := create_purchase(gen_random_uuid(), 'X', jsonb_build_array(jsonb_build_object('product_id', v_c, 'qty', 1, 'unit_cost', 1)), 'manual'); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'Salesperson create_purchase refused'::text; ok := ok || (v_err = 'NOT_ALLOWED'); d := d || v_err;

    -- T02: as a Salesperson through the real API role, cost and profit tables return zero rows.
    set local role authenticated;
    select (select count(*) from product_costs) + (select count(*) from sale_line_costs)
         + (select count(*) from purchases) + (select count(*) from product_profit) into v_cnt;
    select count(*) into v_num from sales_invoices where created_by = v_owner;
    reset role;
    n := n || 'T02 Salesperson sees 0 cost/profit/purchase rows'::text; ok := ok || (v_cnt = 0); d := d || (v_cnt || ' rows');
    n := n || 'Salesperson sees none of the Owner''s invoices'::text; ok := ok || (v_num = 0); d := d || (v_num || ' rows');

    -- Back to the Owner. T08: no reason refused; with a reason saved, stock -8 and flagged.
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    select current_stock into v_num2 from product_stock where product_id = v_c;
    begin r := create_sale(p_client_ref => gen_random_uuid(), p_customer_id => null,
      p_lines => jsonb_build_array(jsonb_build_object('product_id', v_c, 'qty', 20)), p_paid_now => 1000); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'T08 Owner oversell without reason refused'::text; ok := ok || (v_err = 'OVERRIDE_REASON_REQUIRED'); d := d || v_err;
    r := create_sale(p_client_ref => gen_random_uuid(), p_customer_id => null,
      p_lines => jsonb_build_array(jsonb_build_object('product_id', v_c, 'qty', 20)), p_paid_now => 1000,
      p_override_reason => 'Goods arrived, purchase not entered yet');
    select current_stock into v_num from product_stock where product_id = v_c;
    select count(*) into v_cnt from stock_movements where product_id = v_c and oversell_override and note like 'Oversell:%';
    n := n || 'T08 Owner oversell with reason -> stock -8, override in history'::text;
    ok := ok || (v_num = v_num2 - 20 and v_num = -8 and v_cnt = 1 and (select is_negative from product_stock where product_id = v_c));
    d := d || ('stock ' || v_num || ', override rows ' || v_cnt);

    -- Safe save: sending the same client_ref twice makes one invoice, not two.
    v_ref := gen_random_uuid();
    r := create_sale(p_client_ref => v_ref, p_customer_id => null, p_lines => jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 1)), p_paid_now => 100);
    r := create_sale(p_client_ref => v_ref, p_customer_id => null, p_lines => jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 1)), p_paid_now => 100);
    select count(*) into v_cnt from sales_invoices where client_ref = v_ref;
    n := n || 'T13 retry with same client_ref -> one invoice'::text; ok := ok || (v_cnt = 1 and (r->>'duplicate')::boolean); d := d || (v_cnt || ' invoice(s)');

    -- Input checks.
    begin r := create_sale(gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 1)), 0, 0, 0); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'Credit sale without customer refused'::text; ok := ok || (v_err = 'CUSTOMER_REQUIRED_FOR_CREDIT'); d := d || v_err;
    begin r := create_sale(gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 1)), 0, 0, 999); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'Paid more than total refused'::text; ok := ok || (v_err = 'PAID_EXCEEDS_TOTAL'); d := d || v_err;
    begin r := create_sale(gen_random_uuid(), null, '[]'::jsonb, 0, 0, 0); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'Empty invoice refused'::text; ok := ok || (v_err = 'EMPTY_INVOICE'); d := d || v_err;
    begin r := create_sale(gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 0)), 0, 0, 0); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'T19 quantity 0 refused'::text; ok := ok || (v_err = 'INVALID_QTY'); d := d || v_err;
    begin r := create_sale(gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 'abc')), 0, 0, 0); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'T19 quantity in letters refused'::text; ok := ok || (v_err = 'INVALID_QTY'); d := d || v_err;

    -- T06: cancelling an invoice returns its stock and removes its due.
    select current_stock into v_num2 from product_stock where product_id = v_a;
    r := create_sale(p_client_ref => gen_random_uuid(), p_customer_id => v_cust,
      p_lines => jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 2)), p_paid_now => 0);
    v_inv := (r->>'invoice_id')::uuid;
    r := cancel_invoice(v_inv, 'Customer returned goods');
    select current_stock into v_num from product_stock where product_id = v_a;
    n := n || 'T06 cancel invoice -> stock back, due back'::text;
    ok := ok || (v_num = v_num2 and customer_due(v_cust) = 2000); d := d || ('stock ' || v_num || ', due ' || customer_due(v_cust));

    -- Ledgers are append-only: editing a movement is refused even for the database owner.
    begin update stock_movements set note = 'edited' where product_id = v_a; v_err := 'edited (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'Stock ledger cannot be edited'::text; ok := ok || (v_err like 'LEDGER_IS_APPEND_ONLY%'); d := d || v_err;

    -- Nobody logged in: refused.
    perform set_config('request.jwt.claims', '', true);
    begin r := create_sale(gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 1)), 0, 0, 100); v_err := 'saved (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'Not logged in refused'::text; ok := ok || (v_err = 'NOT_AUTHENTICATED'); d := d || v_err;

    raise exception 'OLEYN_TESTS_DONE';
  exception when others then
    if sqlerrm <> 'OLEYN_TESTS_DONE' then
      n := n || 'Tests stopped early'::text; ok := ok || false; d := d || sqlerrm;
    end if;
  end;
  return query select * from unnest(n, ok, d);
end $$;

-- Part B: checks of the demo data (read-only).
create or replace function pg_temp.oleyn_seed_checks() returns table (test text, passed boolean, detail text)
language sql as $$
  -- Row counts match spec section 15.
  select 'Seed: 20 products, 8 customers, 15 sales, 9 payments, 2 purchases, 3 adjustments',
    (select count(*) from products where sku not like 'ZZTEST%' and sku not like 'RG-%') = 20 and (select count(*) from customers) = 8
    and (select count(*) from sales_invoices) = 15 and (select count(*) from customer_ledger where entry_type = 'payment') = 9
    and (select count(*) from purchases) = 2 and (select count(*) from stock_movements where source_type = 'adjustment') = 3,
    concat_ws(', ', (select count(*) from products), (select count(*) from customers), (select count(*) from sales_invoices),
      (select count(*) from customer_ledger where entry_type = 'payment'), (select count(*) from purchases),
      (select count(*) from stock_movements where source_type = 'adjustment'))
  -- Every product's stock equals the sum of its movements.
  union all select 'Seed: every product stock = sum of its movements',
    not exists (select 1 from product_stock s where s.current_stock <> (select coalesce(sum(qty_change), 0) from stock_movements m where m.product_id = s.product_id)),
    'checked ' || (select count(*) from product_stock) || ' products'
  -- Every customer's due equals the sum of their ledger, and invoice dues match credit entries.
  union all select 'Seed: every customer due = sum of ledger; invoice dues = credit entries',
    not exists (select 1 from customer_balances b where b.due <> (select coalesce(sum(amount), 0) from customer_ledger l where l.customer_id = b.customer_id))
    and (select sum(due_amount) from sales_invoices where status = 'posted') = (select sum(amount) from customer_ledger where entry_type = 'credit_sale'),
    'credit on invoices ' || (select sum(due_amount) from sales_invoices) || ' = ledger ' || (select sum(amount) from customer_ledger where entry_type = 'credit_sale')
  -- Dues and overdue flags as described in spec 15.3.
  union all select 'Seed: dues and overdue flags per customer',
    (select bool_and(b.due = t.due and b.is_overdue = t.od) from customer_balances b join customers c on c.id = b.customer_id
       join (values ('Rahim Store',12020,false),('Karim Traders',8500,true),('Shapla General Store',0,false),('Maa Enterprise',4200,false),
                    ('Bismillah Store',6800,true),('Shah Ali Market Shop',0,false),('Sonar Bangla Mart',3100,false),('Haque Brothers Retail',9600,true))
         as t(name, due, od) on t.name = c.name),
    (select string_agg(c.name || ' ' || b.due || case when b.is_overdue then ' overdue' else '' end, '; ' order by c.name)
       from customer_balances b join customers c on c.id = b.customer_id)
  -- Lux and Pepsodent start low; nothing is negative; Pran Mango is 136 as in the API example.
  union all select 'Seed: low stock = Lux and Pepsodent only, none negative, Pran Mango 136',
    (select string_agg(p.sku, ',' order by p.sku) from product_stock s join products p on p.id = s.product_id where s.is_low) = 'LUX-SOAP-100,PEPSODENT-100'
    and not exists (select 1 from product_stock where is_negative)
    and (select s.current_stock from product_stock s join products p on p.id = s.product_id where p.sku = 'PRAN-MANGO-250') = 136,
    'low: ' || coalesce((select string_agg(p.sku, ',') from product_stock s join products p on p.id = s.product_id where s.is_low), 'none')
  -- Demo logins, the AI purchase link and the API key are in place.
  union all select 'Seed: Kamal = owner, Rubel = salesperson, AI purchase linked, API key stored',
    exists (select 1 from profiles p join auth.users u on u.id = p.id where u.email = 'owner@oleyn-demo.com' and p.role = 'owner')
    and exists (select 1 from profiles p join auth.users u on u.id = p.id where u.email = 'sales@oleyn-demo.com' and p.role = 'salesperson')
    and exists (select 1 from purchases pu join ai_extractions a on a.id = pu.ai_extraction_id and a.purchase_id = pu.id where pu.source = 'ai')
    and exists (select 1 from api_keys where revoked_at is null),
    'profiles ' || (select count(*) from profiles)
$$;

-- Run everything: one row per check. Part B rows appear only once the demo data exists.
select * from pg_temp.oleyn_rule_tests()
union all select * from pg_temp.oleyn_seed_checks() where exists (select 1 from customers);
