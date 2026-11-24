-- 01_schema.sql: creates every table, number sequence and view for Oleyn Stock. Run this first.
-- Safe to run again: it only creates what is missing.

-- One row per login: the person's name, role (owner or salesperson) and app language.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('owner','salesperson')),
  language text not null default 'en' check (language in ('en','bn')),
  created_at timestamptz not null default now()
);

-- The product list. Stock is NOT stored here; it is the sum of stock_movements.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  barcode text unique,
  name text not null,
  name_bn text,
  unit text not null default 'pcs',
  sale_price numeric(12,2) not null check (sale_price >= 0),
  low_stock_at int not null default 10,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Purchase cost per product, kept in its own table so it can be locked to Owners only.
create table if not exists public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  cost_price numeric(12,2) not null check (cost_price >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- The stock ledger: every stock change ever made (+ in, - out). Rows are only ever added.
create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id),
  qty_change numeric(12,2) not null check (qty_change <> 0),
  reason text not null check (reason in ('opening','purchase','sale','sale_cancel',
    'adjust_damage','adjust_expired','adjust_lost','adjust_sample','adjust_count')),
  source_type text not null check (source_type in ('seed','purchase','invoice','adjustment')),
  source_id uuid,
  note text,
  oversell_override boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
-- Speeds up "stock of one product" and its history page.
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at);

-- Shops that buy from the business, many of them on credit.
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_bn text,
  phone text,
  area text,
  credit_days int not null default 30 check (credit_days >= 0),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Invoice numbers INV-000001, INV-000002 ... and purchase numbers PUR-000001 ...
create sequence if not exists public.invoice_no_seq;
create sequence if not exists public.purchase_no_seq;

-- One row per sales invoice. client_ref is unique so a retried save can never make a second invoice.
create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text unique not null,
  client_ref uuid unique not null,
  customer_id uuid references public.customers (id),
  subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  paid_now numeric(12,2) not null default 0 check (paid_now >= 0 and paid_now <= total),
  due_amount numeric(12,2) not null default 0 check (due_amount >= 0),
  due_date date,
  status text not null default 'posted' check (status in ('posted','cancelled')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint credit_needs_customer check (due_amount = 0 or customer_id is not null)
);
-- Speeds up "today's sales" and "my sales today".
create index if not exists sales_invoices_created_idx on public.sales_invoices (created_at);
create index if not exists sales_invoices_creator_idx on public.sales_invoices (created_by, created_at);

-- The items on each invoice.
create table if not exists public.sales_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sales_invoices (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty numeric(12,2) not null check (qty > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now()
);
-- Speeds up loading the lines of one invoice.
create index if not exists sales_invoice_lines_invoice_idx on public.sales_invoice_lines (invoice_id);

-- Cost of each sold line at the moment of sale (for profit). Owner only.
create table if not exists public.sale_line_costs (
  line_id uuid primary key references public.sales_invoice_lines (id) on delete cascade,
  unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- The dues ledger: + raises what a customer owes, - lowers it. Rows are only ever added.
create table if not exists public.customer_ledger (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers (id),
  amount numeric(12,2) not null check (amount <> 0),
  entry_type text not null check (entry_type in ('opening','credit_sale','payment','sale_cancel')),
  invoice_id uuid references public.sales_invoices (id),
  method text check (method in ('cash','bkash','bank')),
  trx_ref text,
  note text,
  client_ref uuid unique,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
-- Speeds up one customer's statement and balance.
create index if not exists customer_ledger_customer_idx on public.customer_ledger (customer_id, created_at);

-- Every AI memo reading attempt: model, speed, outcome and raw answer. Owner only.
create table if not exists public.ai_extractions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id),
  model text,
  latency_ms int,
  status text check (status in ('ok','timeout','error','invalid_json')),
  raw_output jsonb,
  fields_total int,
  fields_edited int,
  purchase_id uuid,
  created_at timestamptz not null default now()
);

-- Stock bought from suppliers (stock in). Owner only.
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_no text unique not null,
  client_ref uuid unique not null,
  supplier_name text,
  source text not null default 'manual' check (source in ('manual','ai')),
  ai_extraction_id uuid references public.ai_extractions (id),
  total_cost numeric(12,2) not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- The items on each purchase.
create table if not exists public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty numeric(12,2) not null check (qty > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

-- Keys for the public stock API. Only the SHA-256 hash is stored, never the key itself.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  label text,
  key_hash text unique not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Guard function: refuses any change or delete, so the two ledgers can only grow.
create or replace function public.forbid_ledger_change() returns trigger
language plpgsql as $$
begin
  raise exception 'LEDGER_IS_APPEND_ONLY: rows in % can only be added', tg_table_name;
end $$;

-- Attach the guard to the stock ledger.
drop trigger if exists stock_movements_append_only on public.stock_movements;
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function public.forbid_ledger_change();

-- Attach the guard to the dues ledger.
drop trigger if exists customer_ledger_append_only on public.customer_ledger;
create trigger customer_ledger_append_only before update or delete on public.customer_ledger
  for each row execute function public.forbid_ledger_change();

-- View: current stock per product = sum of all its movements, plus low and negative flags.
create or replace view public.product_stock with (security_invoker = true) as
select p.id as product_id,
       coalesce(sum(m.qty_change), 0)::numeric(12,2) as current_stock,
       coalesce(sum(m.qty_change), 0) <= p.low_stock_at as is_low,
       coalesce(sum(m.qty_change), 0) < 0 as is_negative
from public.products p
left join public.stock_movements m on m.product_id = p.id
group by p.id, p.low_stock_at;

-- View: what each customer owes = sum of their ledger, last payment, and an overdue flag.
create or replace view public.customer_balances with (security_invoker = true) as
select c.id as customer_id,
       coalesce(sum(l.amount), 0)::numeric(12,2) as due,
       max(l.created_at) filter (where l.entry_type = 'payment') as last_payment_at,
       coalesce(sum(l.amount), 0) > 0
         and coalesce(max(l.created_at) filter (where l.entry_type = 'payment'),
                       min(l.created_at) filter (where l.entry_type in ('credit_sale','opening')))
             < now() - make_interval(days => c.credit_days) as is_overdue
from public.customers c
left join public.customer_ledger l on l.customer_id = c.id
group by c.id, c.credit_days;

-- View: revenue, cost and profit per sold line (posted invoices only). Owner only, because
-- it reads sale_line_costs; a Salesperson gets zero rows. Invoice discount is shared across lines.
create or replace view public.product_profit with (security_invoker = true) as
select l.id as line_id, i.id as invoice_id, i.invoice_no, l.product_id, i.created_by, i.created_at as sold_at,
       l.qty,
       round(l.line_total * case when i.subtotal > 0 then (i.subtotal - i.discount) / i.subtotal else 1 end, 2) as revenue,
       round(l.qty * c.unit_cost, 2) as cost,
       round(l.line_total * case when i.subtotal > 0 then (i.subtotal - i.discount) / i.subtotal else 1 end, 2)
         - round(l.qty * c.unit_cost, 2) as profit
from public.sales_invoice_lines l
join public.sale_line_costs c on c.line_id = l.id
join public.sales_invoices i on i.id = l.invoice_id
where i.status = 'posted';
