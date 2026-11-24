-- 04_seed.sql: demo data (spec section 15). Run ONCE on an empty database, after creating the two demo
-- logins in Authentication. Sales, payments, purchases and adjustments go through the real functions
-- (create_sale, record_payment, ...) so the ledgers stay consistent; afterwards their dates are moved
-- back to spread them over the last few weeks.

-- Helper: a time N days ago at a given Dhaka clock time.
create or replace function pg_temp.ts(p_days int, p_time time) returns timestamptz language sql as $$
  select ((((now() at time zone 'Asia/Dhaka')::date - p_days) + p_time) at time zone 'Asia/Dhaka')
$$;

-- Helper: act as one of the demo users (what auth.uid() returns inside the functions).
create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

-- Helper: one invoice line {product_id, qty} from a SKU.
create or replace function pg_temp.l(p_sku text, p_qty numeric) returns jsonb language sql as $$
  select jsonb_build_object('product_id', (select id from public.products where sku = p_sku), 'qty', p_qty)
$$;

-- Helper: a customer's id from their name.
create or replace function pg_temp.c(p_name text) returns uuid language sql as $$
  select id from public.customers where name = p_name
$$;

-- Helper: make a sale through create_sale, then move it (and its ledger rows) back to the given time.
create or replace function pg_temp.sale(p_user uuid, p_at timestamptz, p_customer uuid, p_lines jsonb, p_paid numeric)
returns void language plpgsql as $$
declare r jsonb; v_inv uuid;
begin
  perform pg_temp.act_as(p_user);
  r := public.create_sale(p_client_ref => gen_random_uuid(), p_customer_id => p_customer, p_lines => p_lines, p_paid_now => p_paid);
  v_inv := (r->>'invoice_id')::uuid;
  update public.sales_invoices i set created_at = p_at,
    due_date = case when i.due_amount > 0 then (p_at at time zone 'Asia/Dhaka')::date
                    + (select credit_days from public.customers where id = i.customer_id) end
  where i.id = v_inv;
  update public.sales_invoice_lines set created_at = p_at where invoice_id = v_inv;
  update public.sale_line_costs set created_at = p_at where line_id in (select id from public.sales_invoice_lines where invoice_id = v_inv);
  update public.stock_movements set created_at = p_at where source_id = v_inv;
  update public.customer_ledger set created_at = p_at where invoice_id = v_inv;
end $$;

-- Helper: record a payment through record_payment, then move it back to the given time.
create or replace function pg_temp.pay(p_user uuid, p_at timestamptz, p_customer uuid, p_amount numeric, p_method text, p_trx text)
returns void language plpgsql as $$
declare v_ref uuid := gen_random_uuid();
begin
  perform pg_temp.act_as(p_user);
  perform public.record_payment(v_ref, p_customer, p_amount, p_method, p_trx);
  update public.customer_ledger set created_at = p_at where client_ref = v_ref;
end $$;

-- Helper: an opening due carried over from the paper khata.
create or replace function pg_temp.opening(p_owner uuid, p_at timestamptz, p_customer uuid, p_amount numeric)
returns void language sql as $$
  insert into public.customer_ledger (customer_id, amount, entry_type, note, created_by, created_at)
  values (p_customer, p_amount, 'opening', 'Opening due carried over from khata', p_owner, p_at)
$$;

do $$
declare
  v_owner uuid := (select id from auth.users where email = 'owner@oleyn-demo.com');
  v_sales uuid := (select id from auth.users where email = 'sales@oleyn-demo.com');
  r jsonb; v_ai uuid; v_ref uuid;
begin
  if v_owner is null or v_sales is null then
    raise exception 'DEMO_USERS_MISSING: create owner@oleyn-demo.com and sales@oleyn-demo.com in Authentication first';
  end if;
  if exists (select 1 from public.products) then raise exception 'ALREADY_SEEDED: run 04_seed.sql only on an empty database'; end if;

  -- Ledger guards are paused only while dates are moved back, and switched on again at the end.
  alter table public.stock_movements disable trigger stock_movements_append_only;
  alter table public.customer_ledger disable trigger customer_ledger_append_only;
  -- Invoice and purchase numbers start again at 000001 (the tests used some numbers).
  perform setval('public.invoice_no_seq', 1, false);
  perform setval('public.purchase_no_seq', 1, false);

  -- The two demo people.
  insert into public.profiles (id, full_name, role) values (v_owner, 'Kamal Hossain', 'owner'), (v_sales, 'Rubel Mia', 'salesperson');

  -- 20 products with Bangla names, sale price and low-stock level.
  insert into public.products (sku, barcode, name, name_bn, unit, sale_price, low_stock_at, created_by, created_at)
  select sku, barcode, name, name_bn, unit, sale, low, v_owner, pg_temp.ts(30, '09:00') from (values
    ('PRAN-MANGO-250','2000000000017','Pran Mango Juice 250ml','প্রাণ ম্যাঙ্গো জুস ২৫০ মি.লি.','pcs',25,24),
    ('ACI-SALT-1KG','2000000000024','ACI Pure Salt 1kg','এসিআই পিওর লবণ ১ কেজি','pcs',42,30),
    ('TEER-SOY-1L','2000000000031','Teer Soybean Oil 1L','তীর সয়াবিন তেল ১ লিটার','pcs',175,15),
    ('RADHUNI-HALUD-200','2000000000048','Radhuni Turmeric Powder 200g','রাঁধুনী হলুদ গুঁড়া ২০০ গ্রাম','pcs',95,10),
    ('FRESH-SUGAR-1KG','2000000000055','Fresh Sugar 1kg','ফ্রেশ চিনি ১ কেজি','pcs',130,20),
    ('MINIKET-RICE-25','2000000000062','Miniket Rice 25kg','মিনিকেট চাল ২৫ কেজি','bag',1950,5),
    ('LUX-SOAP-100','2000000000079','Lux Soap 100g','লাক্স সাবান ১০০ গ্রাম','pcs',55,20),
    ('RIN-POWDER-500','2000000000086','Rin Washing Powder 500g','রিন ওয়াশিং পাউডার ৫০০ গ্রাম','pcs',70,15),
    ('MAGGI-NOODLES-8','2000000000093','Maggi Noodles 8-pack','ম্যাগি নুডলস ৮ প্যাক','pack',160,10),
    ('PRAN-CHANACHUR-150','2000000000109','Pran Chanachur 150g','প্রাণ চানাচুর ১৫০ গ্রাম','pcs',35,25),
    ('MUM-WATER-500','2000000000116','Mum Drinking Water 500ml','মাম পানি ৫০০ মি.লি.','pcs',15,48),
    ('OLYMPIC-ENERGY','2000000000123','Olympic Energy Plus Biscuit','অলিম্পিক এনার্জি প্লাস বিস্কুট','pcs',20,30),
    ('DANO-MILK-500','2000000000130','Dano Milk Powder 500g','ডানো গুঁড়া দুধ ৫০০ গ্রাম','pcs',450,5),
    ('PEPSODENT-100','2000000000147','Pepsodent Toothpaste 100g','পেপসোডেন্ট টুথপেস্ট ১০০ গ্রাম','pcs',85,12),
    ('SURF-EXCEL-1KG','2000000000154','Surf Excel 1kg','সার্ফ এক্সেল ১ কেজি','pcs',240,8),
    ('MOSUR-DAL-1KG','2000000000161','Mosur Dal 1kg','মসুর ডাল ১ কেজি','kg',135,20),
    ('PRAN-MURI-500','2000000000178','Pran Puffed Rice 500g','প্রাণ মুড়ি ৫০০ গ্রাম','pcs',60,12),
    ('ISPAHANI-TEA-400','2000000000185','Ispahani Mirzapore Tea 400g','ইস্পাহানি মির্জাপুর চা ৪০০ গ্রাম','pcs',260,8),
    ('COCA-COLA-1L','2000000000192','Coca-Cola 1L','কোকা-কোলা ১ লিটার','pcs',80,24),
    ('PRAN-JHALMURI-40','2000000000208','Pran Jhal Muri 40g','প্রাণ ঝালমুড়ি ৪০ গ্রাম','pcs',10,50)
  ) as t(sku, barcode, name, name_bn, unit, sale, low);

  -- Purchase cost per product (Owner only) and opening stock as an 'opening' movement.
  insert into public.product_costs (product_id, cost_price)
  select p.id, t.cost from public.products p join (values
    ('PRAN-MANGO-250',20),('ACI-SALT-1KG',36),('TEER-SOY-1L',162),('RADHUNI-HALUD-200',80),('FRESH-SUGAR-1KG',120),
    ('MINIKET-RICE-25',1820),('LUX-SOAP-100',46),('RIN-POWDER-500',60),('MAGGI-NOODLES-8',140),('PRAN-CHANACHUR-150',28),
    ('MUM-WATER-500',11),('OLYMPIC-ENERGY',16),('DANO-MILK-500',410),('PEPSODENT-100',72),('SURF-EXCEL-1KG',215),
    ('MOSUR-DAL-1KG',120),('PRAN-MURI-500',50),('ISPAHANI-TEA-400',235),('COCA-COLA-1L',68),('PRAN-JHALMURI-40',7)
  ) as t(sku, cost) on t.sku = p.sku;
  insert into public.stock_movements (product_id, qty_change, reason, source_type, note, created_by, created_at)
  select p.id, t.qty, 'opening', 'seed', 'Opening stock', v_owner, pg_temp.ts(30, '09:30') from public.products p join (values
    ('PRAN-MANGO-250',140),('ACI-SALT-1KG',200),('TEER-SOY-1L',90),('RADHUNI-HALUD-200',60),('FRESH-SUGAR-1KG',120),
    ('MINIKET-RICE-25',30),('LUX-SOAP-100',8),('RIN-POWDER-500',75),('MAGGI-NOODLES-8',45),('PRAN-CHANACHUR-150',150),
    ('MUM-WATER-500',300),('OLYMPIC-ENERGY',180),('DANO-MILK-500',25),('PEPSODENT-100',6),('SURF-EXCEL-1KG',40),
    ('MOSUR-DAL-1KG',100),('PRAN-MURI-500',70),('ISPAHANI-TEA-400',35),('COCA-COLA-1L',96),('PRAN-JHALMURI-40',400)
  ) as t(sku, qty) on t.sku = p.sku;

  -- 8 customers (phone numbers are fake).
  insert into public.customers (name, name_bn, phone, area, credit_days, created_by, created_at) values
    ('Rahim Store','রহিম স্টোর','01700-000001','Narayanganj',30,v_owner,pg_temp.ts(45,'10:00')),
    ('Karim Traders','করিম ট্রেডার্স','01700-000002','Gazipur',15,v_owner,pg_temp.ts(45,'10:00')),
    ('Shapla General Store','শাপলা জেনারেল স্টোর','01700-000003','Dhaka',7,v_owner,pg_temp.ts(45,'10:00')),
    ('Maa Enterprise','মা এন্টারপ্রাইজ','01700-000004','Bogura',30,v_owner,pg_temp.ts(45,'10:00')),
    ('Bismillah Store','বিসমিল্লাহ স্টোর','01700-000005','Chattogram',15,v_owner,pg_temp.ts(45,'10:00')),
    ('Shah Ali Market Shop','শাহ আলী মার্কেট শপ','01700-000006','Dhaka',30,v_owner,pg_temp.ts(45,'10:00')),
    ('Sonar Bangla Mart','সোনার বাংলা মার্ট','01700-000007','Khulna',15,v_owner,pg_temp.ts(45,'10:00')),
    ('Haque Brothers Retail','হক ব্রাদার্স রিটেইল','01700-000008','Sylhet',30,v_owner,pg_temp.ts(45,'10:00'));

  -- Opening dues carried over from the paper khata.
  perform pg_temp.opening(v_owner, pg_temp.ts(40,'10:00'), pg_temp.c('Haque Brothers Retail'), 9600);
  perform pg_temp.opening(v_owner, pg_temp.ts(28,'10:00'), pg_temp.c('Maa Enterprise'), 2000);
  perform pg_temp.opening(v_owner, pg_temp.ts(25,'10:00'), pg_temp.c('Karim Traders'), 7000);
  perform pg_temp.opening(v_owner, pg_temp.ts(22,'10:00'), pg_temp.c('Bismillah Store'), 5500);
  perform pg_temp.opening(v_owner, pg_temp.ts(20,'10:00'), pg_temp.c('Rahim Store'), 8000);

  -- Early payments (before the last two weeks).
  perform pg_temp.pay(v_owner, pg_temp.ts(20,'16:00'), pg_temp.c('Karim Traders'), 1000, 'cash', null);
  perform pg_temp.pay(v_sales, pg_temp.ts(18,'15:30'), pg_temp.c('Karim Traders'), 1000, 'bkash', 'BK7Q2M9X4L');
  perform pg_temp.pay(v_sales, pg_temp.ts(17,'12:00'), pg_temp.c('Bismillah Store'), 500, 'cash', null);

  -- Purchase 1 (manual), 12 days ago.
  perform pg_temp.act_as(v_owner);
  v_ref := gen_random_uuid();
  r := public.create_purchase(v_ref, 'Hossain Distribution', jsonb_build_array(
    jsonb_build_object('product_id', (select id from public.products where sku = 'PRAN-CHANACHUR-150'), 'qty', 50, 'unit_cost', 28),
    jsonb_build_object('product_id', (select id from public.products where sku = 'PRAN-MURI-500'), 'qty', 24, 'unit_cost', 50)), 'manual');
  update public.purchases set created_at = pg_temp.ts(12,'09:15') where client_ref = v_ref;
  update public.purchase_lines set created_at = pg_temp.ts(12,'09:15') where purchase_id = (r->>'purchase_id')::uuid;
  update public.stock_movements set created_at = pg_temp.ts(12,'09:15') where source_id = (r->>'purchase_id')::uuid;

  -- 15 sales over the last two weeks by both users: cash, credit and partial.
  perform pg_temp.sale(v_owner, pg_temp.ts(13,'10:15'), pg_temp.c('Rahim Store'), jsonb_build_array(pg_temp.l('MINIKET-RICE-25',2), pg_temp.l('TEER-SOY-1L',6)), 0);
  perform pg_temp.sale(v_sales, pg_temp.ts(12,'11:40'), pg_temp.c('Shah Ali Market Shop'), jsonb_build_array(pg_temp.l('PRAN-MANGO-250',4), pg_temp.l('PRAN-CHANACHUR-150',10), pg_temp.l('MUM-WATER-500',24)), 810);
  perform pg_temp.sale(v_sales, pg_temp.ts(12,'15:05'), pg_temp.c('Karim Traders'), jsonb_build_array(pg_temp.l('FRESH-SUGAR-1KG',20), pg_temp.l('MOSUR-DAL-1KG',10)), 450);
  perform pg_temp.sale(v_owner, pg_temp.ts(11,'12:30'), pg_temp.c('Shapla General Store'), jsonb_build_array(pg_temp.l('ISPAHANI-TEA-400',5), pg_temp.l('SURF-EXCEL-1KG',3)), 0);
  perform pg_temp.sale(v_sales, pg_temp.ts(10,'10:50'), pg_temp.c('Sonar Bangla Mart'), jsonb_build_array(pg_temp.l('TEER-SOY-1L',10), pg_temp.l('ACI-SALT-1KG',20), pg_temp.l('MAGGI-NOODLES-8',5)), 0);
  perform pg_temp.pay(v_owner, pg_temp.ts(9,'11:00'), pg_temp.c('Rahim Store'), 3000, 'bank', 'DBBL-448812');
  perform pg_temp.pay(v_sales, pg_temp.ts(9,'17:20'), pg_temp.c('Shapla General Store'), 2020, 'bkash', 'BK3T8R1V6N');
  perform pg_temp.sale(v_sales, pg_temp.ts(9,'13:10'), null, jsonb_build_array(pg_temp.l('COCA-COLA-1L',12), pg_temp.l('PRAN-JHALMURI-40',30)), 1260);
  perform pg_temp.sale(v_owner, pg_temp.ts(8,'10:05'), pg_temp.c('Maa Enterprise'), jsonb_build_array(pg_temp.l('MINIKET-RICE-25',2), pg_temp.l('RADHUNI-HALUD-200',4)), 0);
  perform pg_temp.sale(v_sales, pg_temp.ts(7,'14:45'), pg_temp.c('Bismillah Store'), jsonb_build_array(pg_temp.l('DANO-MILK-500',4), pg_temp.l('OLYMPIC-ENERGY',30)), 600);
  perform pg_temp.sale(v_owner, pg_temp.ts(6,'11:25'), pg_temp.c('Rahim Store'), jsonb_build_array(pg_temp.l('FRESH-SUGAR-1KG',10), pg_temp.l('RIN-POWDER-500',10), pg_temp.l('PRAN-MURI-500',10)), 600);
  perform pg_temp.pay(v_sales, pg_temp.ts(6,'16:10'), pg_temp.c('Rahim Store'), 2000, 'bkash', 'BK5H9D2C7P');
  perform pg_temp.sale(v_sales, pg_temp.ts(5,'12:15'), pg_temp.c('Shah Ali Market Shop'), jsonb_build_array(pg_temp.l('MUM-WATER-500',48), pg_temp.l('PRAN-CHANACHUR-150',12), pg_temp.l('PRAN-JHALMURI-40',40)), 540);
  perform pg_temp.pay(v_sales, pg_temp.ts(5,'17:00'), pg_temp.c('Sonar Bangla Mart'), 290, 'cash', null);
  perform pg_temp.sale(v_sales, pg_temp.ts(4,'10:40'), pg_temp.c('Rahim Store'), jsonb_build_array(pg_temp.l('TEER-SOY-1L',5), pg_temp.l('MOSUR-DAL-1KG',5), pg_temp.l('ISPAHANI-TEA-400',2)), 0);
  perform pg_temp.pay(v_owner, pg_temp.ts(4,'15:30'), pg_temp.c('Maa Enterprise'), 2080, 'cash', null);
  perform pg_temp.sale(v_owner, pg_temp.ts(3,'11:55'), null, jsonb_build_array(pg_temp.l('SURF-EXCEL-1KG',2), pg_temp.l('RIN-POWDER-500',5)), 830);
  perform pg_temp.pay(v_owner, pg_temp.ts(3,'16:45'), pg_temp.c('Shah Ali Market Shop'), 1000, 'bank', 'CITY-772031');
  perform pg_temp.sale(v_sales, pg_temp.ts(2,'13:20'), pg_temp.c('Shapla General Store'), jsonb_build_array(pg_temp.l('MAGGI-NOODLES-8',3), pg_temp.l('COCA-COLA-1L',6)), 960);
  perform pg_temp.sale(v_sales, now() - interval '50 minutes', null, jsonb_build_array(pg_temp.l('OLYMPIC-ENERGY',20), pg_temp.l('ACI-SALT-1KG',10)), 820);
  perform pg_temp.sale(v_owner, now() - interval '20 minutes', pg_temp.c('Shah Ali Market Shop'), jsonb_build_array(pg_temp.l('PRAN-MURI-500',5), pg_temp.l('RADHUNI-HALUD-200',2)), 490);

  -- Purchase 2 (read from a memo by AI, then checked by the Owner), 6 days ago, with its AI log row.
  insert into public.ai_extractions (created_by, model, latency_ms, status, raw_output, fields_total, fields_edited, created_at)
  values (v_owner, 'gemini-flash (seed)', 4300, 'ok',
    '{"supplier_name":"Bhai Bhai Traders","memo_date":null,"lines":[{"item_name":"Fresh Chini 1kg","qty":50,"unit":"pcs","unit_price":120,"line_total":6000,"confidence":0.93},{"item_name":"Mosur Dal","qty":40,"unit":"kg","unit_price":120,"line_total":4800,"confidence":0.71}],"memo_total":10800}'::jsonb,
    12, null, pg_temp.ts(6,'09:40'))
  returning id into v_ai;
  perform pg_temp.act_as(v_owner);
  v_ref := gen_random_uuid();
  r := public.create_purchase(v_ref, 'Bhai Bhai Traders', jsonb_build_array(
    jsonb_build_object('product_id', (select id from public.products where sku = 'FRESH-SUGAR-1KG'), 'qty', 50, 'unit_cost', 120),
    jsonb_build_object('product_id', (select id from public.products where sku = 'MOSUR-DAL-1KG'), 'qty', 40, 'unit_cost', 120)),
    'ai', v_ai, 1);
  update public.purchases set created_at = pg_temp.ts(6,'09:45') where client_ref = v_ref;
  update public.purchase_lines set created_at = pg_temp.ts(6,'09:45') where purchase_id = (r->>'purchase_id')::uuid;
  update public.stock_movements set created_at = pg_temp.ts(6,'09:45') where source_id = (r->>'purchase_id')::uuid;

  -- 3 stock adjustments by the Owner, each with a note.
  perform pg_temp.act_as(v_owner);
  r := public.adjust_stock((select id from public.products where sku = 'RIN-POWDER-500'), -2, 'adjust_damage', 'Rain water got into 2 packets in the godown');
  update public.stock_movements set created_at = pg_temp.ts(8,'18:00') where id = (r->>'movement_id')::bigint;
  r := public.adjust_stock((select id from public.products where sku = 'PRAN-JHALMURI-40'), -10, 'adjust_expired', 'Batch expired, returned to supplier');
  update public.stock_movements set created_at = pg_temp.ts(4,'18:10') where id = (r->>'movement_id')::bigint;
  r := public.adjust_stock((select id from public.products where sku = 'MUM-WATER-500'), -3, 'adjust_count', 'Monthly count: 3 bottles short');
  update public.stock_movements set created_at = pg_temp.ts(1,'19:00') where id = (r->>'movement_id')::bigint;

  -- Demo key for the public stock API: only its SHA-256 hash is stored. The key itself is in the README.
  insert into public.api_keys (label, key_hash) values
    ('Demo key (README)', '6bbb6737206142eb3a7d5208ad8029a831ef42709ccb2e80bee39216ea1bd2f0');

  -- Switch the ledger guards back on.
  alter table public.stock_movements enable trigger stock_movements_append_only;
  alter table public.customer_ledger enable trigger customer_ledger_append_only;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Show a short summary of what was created.
select (select count(*) from public.products) as products, (select count(*) from public.customers) as customers,
       (select count(*) from public.sales_invoices) as sales, (select count(*) from public.customer_ledger where entry_type = 'payment') as payments,
       (select count(*) from public.purchases) as purchases, (select count(*) from public.stock_movements where source_type = 'adjustment') as adjustments;
