-- 07_modules.sql: manufacturing & production lite (bill of materials + production orders). Owner only.
-- Production uses up components and adds finished goods through the SAME stock ledger, so it shows in Stock history.
-- (Accounts needs no new tables: it is calculated from sales, payments, purchases and payroll.) Run after 05.

-- Allow two new stock reasons (production used / production made) and a new source type.
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
-- Re-add the reason rule with the two production reasons included.
alter table public.stock_movements add constraint stock_movements_reason_check check (reason in ('opening','purchase','sale','sale_cancel',
  'adjust_damage','adjust_expired','adjust_lost','adjust_sample','adjust_count','production_in','production_out'));
-- Same for where a movement came from.
alter table public.stock_movements drop constraint if exists stock_movements_source_type_check;
-- Re-add the source rule with 'production' included.
alter table public.stock_movements add constraint stock_movements_source_type_check
  check (source_type in ('seed','purchase','invoice','adjustment','production'));

-- Bill of materials: to make 1 unit of product_id you need qty_per_unit of component_id.
create table if not exists public.boms (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  component_id uuid not null references public.products (id),
  qty_per_unit numeric(12,2) not null check (qty_per_unit > 0),
  created_at timestamptz not null default now(),
  unique (product_id, component_id),
  check (product_id <> component_id)
);

-- Production orders ("we made 10 snack boxes"), with safe save like sales.
create sequence if not exists public.production_no_seq;
-- One row per completed production run.
create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  client_ref uuid unique not null,
  product_id uuid not null references public.products (id),
  qty numeric(12,2) not null check (qty > 0),
  unit_cost numeric(12,2) not null default 0,
  note text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Security: Owner only (production reveals cost).
alter table public.boms enable row level security;
alter table public.production_orders enable row level security;
-- Table permissions for logged-in users; the policies below then allow only the Owner.
grant select, insert, update, delete on public.boms to authenticated;
-- Orders are written only by complete_production.
grant select on public.production_orders to authenticated;
-- The server key may do everything.
grant all on public.boms, public.production_orders to service_role;
-- Owner may read recipes.
drop policy if exists boms_owner_all on public.boms;
create policy boms_owner_all on public.boms for all to authenticated using (public.is_owner()) with check (public.is_owner());
-- Owner may read production orders.
drop policy if exists production_orders_owner_read on public.production_orders;
create policy production_orders_owner_read on public.production_orders for select to authenticated using (public.is_owner());

-- complete_production: uses up components (production_out) and adds the finished product (production_in) in one go.
-- The finished product's cost becomes the sum of its components' costs.
create or replace function public.complete_production(p_client_ref uuid, p_product_id uuid, p_qty numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := current_app_role();
  v_existing production_orders%rowtype;
  v_c record; v_available numeric; v_cost numeric := 0; v_id uuid; v_no text;
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if p_client_ref is null then raise exception 'CLIENT_REF_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));
  select * into v_existing from production_orders where client_ref = p_client_ref;
  if found then return jsonb_build_object('order_id', v_existing.id, 'order_no', v_existing.order_no, 'duplicate', true); end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID_QTY'; end if;
  if not exists (select 1 from boms where product_id = p_product_id) then raise exception 'NO_RECIPE'; end if;
  -- Lock the finished product and its components so stock can't change under us.
  perform 1 from products where id = p_product_id or id in (select component_id from boms where product_id = p_product_id) order by id for update;
  for v_c in select b.component_id, b.qty_per_unit * p_qty as need, p.sku from boms b join products p on p.id = b.component_id
             where b.product_id = p_product_id loop
    select coalesce(sum(qty_change), 0) into v_available from stock_movements where product_id = v_c.component_id;
    if v_c.need > v_available then raise exception 'INSUFFICIENT_STOCK:%:%', v_c.sku, trim_scale(greatest(v_available, 0)); end if;
    v_cost := v_cost + coalesce((select cost_price from product_costs where product_id = v_c.component_id), 0) * v_c.need / p_qty;
  end loop;
  v_no := 'PRD-' || lpad(nextval('production_no_seq')::text, 6, '0');
  insert into production_orders (order_no, client_ref, product_id, qty, unit_cost, note, created_by)
  values (v_no, p_client_ref, p_product_id, p_qty, round(v_cost, 2), nullif(btrim(coalesce(p_note, '')), ''), v_uid)
  returning id into v_id;
  insert into stock_movements (product_id, qty_change, reason, source_type, source_id, note, created_by)
  select b.component_id, -(b.qty_per_unit * p_qty), 'production_out', 'production', v_id, v_no, v_uid from boms b where b.product_id = p_product_id;
  insert into stock_movements (product_id, qty_change, reason, source_type, source_id, note, created_by)
  values (p_product_id, p_qty, 'production_in', 'production', v_id, v_no, v_uid);
  insert into product_costs (product_id, cost_price, updated_at) values (p_product_id, round(v_cost, 2), now())
  on conflict (product_id) do update set cost_price = excluded.cost_price, updated_at = now();
  return jsonb_build_object('order_id', v_id, 'order_no', v_no, 'unit_cost', round(v_cost, 2),
    'stock', stock_snapshot(array[p_product_id]), 'duplicate', false);
end $$;

-- Logged-in users may call it (it checks for the Owner itself); logged-out visitors may not.
revoke execute on function public.complete_production(uuid, uuid, numeric, text) from public, anon;
-- Allow logged-in users and the server key to call it.
grant execute on function public.complete_production(uuid, uuid, numeric, text) to authenticated, service_role;

-- Demo: a "Rahman Snack Box" made from 4 products already in stock (not Pran Mango, so the API example stays 136), and one past run of 10 boxes.
do $$
declare
  v_owner uuid := (select id from auth.users where email = 'owner@oleyn-demo.com');
  v_box uuid; r jsonb;
begin
  if exists (select 1 from public.products where sku = 'RG-SNACK-BOX') then return; end if;
  insert into public.products (sku, barcode, name, name_bn, unit, sale_price, low_stock_at, created_by)
  values ('RG-SNACK-BOX', '2000000000215', 'Rahman Snack Box', 'রহমান স্ন্যাক বক্স', 'box', 150, 5, v_owner) returning id into v_box;
  insert into public.boms (product_id, component_id, qty_per_unit)
  select v_box, p.id, t.q from public.products p join (values
    ('MUM-WATER-500', 2), ('OLYMPIC-ENERGY', 2), ('PRAN-CHANACHUR-150', 1), ('PRAN-JHALMURI-40', 2)) as t(sku, q) on t.sku = p.sku;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  r := public.complete_production(gen_random_uuid(), v_box, 10, 'First trial batch for Rahman Group');
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Show the recipe and current stock of the snack box.
select p.name, s.current_stock, (select count(*) from public.boms b where b.product_id = p.id) as components,
       (select cost_price from public.product_costs c where c.product_id = p.id) as unit_cost
from public.products p join public.product_stock s on s.product_id = p.id where p.sku = 'RG-SNACK-BOX';
