-- 02_security.sql: who may read or write what (Row Level Security). Run after 01_schema.sql.
-- Rule of thumb: nobody writes to the ledgers directly; only the functions in 03 do.

-- Helper used by every rule: true when the logged-in user is an Owner.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'owner') $$;

-- Start from zero: logged-out visitors (anon) and logged-in users get no table access until granted below.
revoke all on all tables in schema public from anon, authenticated;
-- Same for the number sequences (only the database functions use them).
revoke all on all sequences in schema public from anon, authenticated;
-- The server-side key (service_role, used only inside /api functions) may read and write everything.
grant all on all tables in schema public to service_role;
-- The server-side key may also use the number sequences.
grant usage, select on all sequences in schema public to service_role;
-- Only logged-in users may run is_owner() (the rules below need it).
revoke execute on function public.is_owner() from public, anon;
-- Allow logged-in users to run is_owner().
grant execute on function public.is_owner() to authenticated;

-- Turn on Row Level Security for every table: rows stay hidden unless a policy below allows them.
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.stock_movements enable row level security;
alter table public.customers enable row level security;
alter table public.sales_invoices enable row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.sale_line_costs enable row level security;
alter table public.customer_ledger enable row level security;
alter table public.ai_extractions enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
alter table public.api_keys enable row level security;

-- PROFILES: everyone may read; only the language column may be changed.
grant select, update (language) on public.profiles to authenticated;
-- Owner reads all profiles; a Salesperson reads only their own.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());
-- Each person may update only their own row (and, by the grant above, only its language).
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- PRODUCTS: both roles read; only the Owner adds or edits.
grant select, insert, update on public.products to authenticated;
-- Both roles may read products.
drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using (true);
-- Only the Owner may add a product.
drop policy if exists products_owner_insert on public.products;
create policy products_owner_insert on public.products for insert to authenticated with check (public.is_owner());
-- Only the Owner may edit a product.
drop policy if exists products_owner_update on public.products;
create policy products_owner_update on public.products for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- PRODUCT_COSTS: Owner only. A Salesperson's request returns zero rows.
grant select, insert, update on public.product_costs to authenticated;
-- Only the Owner may read costs.
drop policy if exists product_costs_owner_read on public.product_costs;
create policy product_costs_owner_read on public.product_costs for select to authenticated using (public.is_owner());
-- Only the Owner may add costs.
drop policy if exists product_costs_owner_insert on public.product_costs;
create policy product_costs_owner_insert on public.product_costs for insert to authenticated with check (public.is_owner());
-- Only the Owner may change costs.
drop policy if exists product_costs_owner_update on public.product_costs;
create policy product_costs_owner_update on public.product_costs for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- STOCK_MOVEMENTS: both roles read the history; nobody writes directly.
grant select on public.stock_movements to authenticated;
-- Both roles may read stock history.
drop policy if exists stock_movements_read on public.stock_movements;
create policy stock_movements_read on public.stock_movements for select to authenticated using (true);

-- CUSTOMERS: both roles read and add (the Salesperson meets new shops); only the Owner edits.
grant select, insert, update on public.customers to authenticated;
-- Both roles may read customers.
drop policy if exists customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated using (true);
-- Both roles may add a customer, recorded under their own name.
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated with check (created_by = auth.uid());
-- Only the Owner may edit a customer.
drop policy if exists customers_owner_update on public.customers;
create policy customers_owner_update on public.customers for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- CUSTOMER_LEDGER: both roles read (needed to collect money); nobody writes directly.
grant select on public.customer_ledger to authenticated;
-- Both roles may read the dues ledger.
drop policy if exists customer_ledger_read on public.customer_ledger;
create policy customer_ledger_read on public.customer_ledger for select to authenticated using (true);

-- SALES_INVOICES: the Owner reads all; a Salesperson reads only invoices they made.
grant select on public.sales_invoices to authenticated;
-- Owner sees every invoice; Salesperson only their own.
drop policy if exists sales_invoices_read on public.sales_invoices;
create policy sales_invoices_read on public.sales_invoices for select to authenticated
  using (public.is_owner() or created_by = auth.uid());

-- SALES_INVOICE_LINES: visible only when the person can see the invoice itself.
grant select on public.sales_invoice_lines to authenticated;
-- A line is visible when its invoice is visible (the invoice rule above applies inside).
drop policy if exists sales_invoice_lines_read on public.sales_invoice_lines;
create policy sales_invoice_lines_read on public.sales_invoice_lines for select to authenticated
  using (exists (select 1 from public.sales_invoices i where i.id = invoice_id));

-- SALE_LINE_COSTS: Owner only.
grant select on public.sale_line_costs to authenticated;
-- Only the Owner may read the cost of sold lines.
drop policy if exists sale_line_costs_owner_read on public.sale_line_costs;
create policy sale_line_costs_owner_read on public.sale_line_costs for select to authenticated using (public.is_owner());

-- PURCHASES and PURCHASE_LINES: Owner only (they reveal cost).
grant select on public.purchases, public.purchase_lines to authenticated;
-- Only the Owner may read purchases.
drop policy if exists purchases_owner_read on public.purchases;
create policy purchases_owner_read on public.purchases for select to authenticated using (public.is_owner());
-- Only the Owner may read purchase lines.
drop policy if exists purchase_lines_owner_read on public.purchase_lines;
create policy purchase_lines_owner_read on public.purchase_lines for select to authenticated using (public.is_owner());

-- AI_EXTRACTIONS: Owner only.
grant select on public.ai_extractions to authenticated;
-- Only the Owner may read AI extraction logs.
drop policy if exists ai_extractions_owner_read on public.ai_extractions;
create policy ai_extractions_owner_read on public.ai_extractions for select to authenticated using (public.is_owner());

-- API_KEYS: no grants and no policies, so the app can never see them. Only /api/v1/stock (service_role) can.

-- VIEWS: allow reading; the table rules above still apply because the views are security_invoker.
grant select on public.product_stock, public.customer_balances, public.product_profit to authenticated;
