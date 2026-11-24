-- 10_hr_extras_godowns.sql: HR extras (leave, overtime, festival/year-end bonus) and multi-godown & branch stock with
-- transfers. Run after 09. Assumptions (change to company policy): leave a year casual 10 / sick 14 / annual 18 days;
-- overtime pays 2 x hourly rate (salary / (working days x 8)); festival bonus only after 1 year of service.

-- ===== HR extras =====
-- Factory worker or office staff (overtime applies to workers).
alter table public.employees add column if not exists employee_type text not null default 'staff' check (employee_type in ('worker','staff'));
-- The three shop-floor roles in the demo are factory workers.
update public.employees set employee_type = 'worker' where designation in ('Machine Operator','Quality Inspector','Store Keeper');

-- Leave taken: type, dates and number of days (calculated from the dates).
create table if not exists public.leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  leave_type text not null check (leave_type in ('casual','sick','annual')),
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  days int generated always as ((to_date - from_date) + 1) stored,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Overtime hours per worker per month.
create table if not exists public.overtime (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  month date not null check (extract(day from month) = 1),
  hours numeric(6,2) not null check (hours between 0 and 200),
  created_at timestamptz not null default now(),
  unique (employee_id, month)
);

-- Bonuses paid with a month's salary: Eid-ul-Fitr, Eid-ul-Adha or year-end.
create table if not exists public.bonuses (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  month date not null check (extract(day from month) = 1),
  kind text not null check (kind in ('eid_ul_fitr','eid_ul_adha','year_end')),
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, month, kind)
);

-- Salary sheet gets two more columns: overtime pay and bonus (both part of gross).
alter table public.payroll_lines add column if not exists overtime_pay numeric(12,2) not null default 0;
-- Bonus column on the salary sheet.
alter table public.payroll_lines add column if not exists bonus numeric(12,2) not null default 0;

-- View: leave taken this year (times and days) and days remaining, per employee and type.
create or replace view public.leave_balances with (security_invoker = true) as
select e.id as employee_id, t.leave_type, t.allowed,
       count(l.id) as times_taken, coalesce(sum(l.days), 0) as days_taken, t.allowed - coalesce(sum(l.days), 0) as days_left
from public.employees e
cross join (values ('casual', 10), ('sick', 14), ('annual', 18)) as t(leave_type, allowed)
left join public.leaves l on l.employee_id = e.id and l.leave_type = t.leave_type
  and extract(year from l.from_date) = extract(year from (now() at time zone 'Asia/Dhaka'))
group by e.id, t.leave_type, t.allowed;

-- Security: Owner only, like the rest of HR.
alter table public.leaves enable row level security;
alter table public.overtime enable row level security;
alter table public.bonuses enable row level security;
-- Table permissions; the policies below allow only the Owner.
grant select, insert, update on public.leaves, public.overtime to authenticated;
-- Bonuses are written only by add_bonus.
grant select on public.bonuses, public.leave_balances to authenticated;
-- The server key may do everything.
grant all on public.leaves, public.overtime, public.bonuses to service_role;
-- One "Owner only" policy per table and action.
do $$
declare t text;
begin
  foreach t in array array['leaves','overtime','bonuses'] loop
    execute format('drop policy if exists %1$s_owner_read on public.%1$s', t);
    execute format('create policy %1$s_owner_read on public.%1$s for select to authenticated using (public.is_owner())', t);
  end loop;
  foreach t in array array['leaves','overtime'] loop
    execute format('drop policy if exists %1$s_owner_insert on public.%1$s', t);
    execute format('create policy %1$s_owner_insert on public.%1$s for insert to authenticated with check (public.is_owner())', t);
    execute format('drop policy if exists %1$s_owner_update on public.%1$s', t);
    execute format('create policy %1$s_owner_update on public.%1$s for update to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

-- add_bonus (Owner): gives every eligible active employee p_percent % of their salary as a bonus in that month.
create or replace function public.add_bonus(p_month date, p_kind text, p_percent numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := current_app_role();
  v_month date := date_trunc('month', p_month)::date;
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if p_kind not in ('eid_ul_fitr','eid_ul_adha','year_end') then raise exception 'INVALID_REASON'; end if;
  if p_percent is null or p_percent <= 0 or p_percent > 200 then raise exception 'INVALID_AMOUNT'; end if;
  if exists (select 1 from payroll_runs where month = v_month and status = 'approved') then raise exception 'PAYROLL_APPROVED'; end if;
  insert into bonuses (employee_id, month, kind, amount)
  select e.id, v_month, p_kind, round(e.monthly_salary * p_percent / 100)
  from employees e
  where e.is_active and (p_kind = 'year_end' or e.joined_on is null or e.joined_on <= v_month - interval '1 year')
  on conflict (employee_id, month, kind) do update set amount = excluded.amount;
  return jsonb_build_object('month', v_month, 'kind', p_kind,
    'employees', (select count(*) from bonuses where month = v_month and kind = p_kind),
    'total', (select coalesce(sum(amount), 0) from bonuses where month = v_month and kind = p_kind));
end $$;

-- generate_payroll, now with overtime (workers only) and bonuses in gross.
create or replace function public.generate_payroll(p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := current_app_role();
  v_month date := date_trunc('month', p_month)::date;
  v_run payroll_runs%rowtype;
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  select * into v_run from payroll_runs where month = v_month for update;
  if found and v_run.status = 'approved' then raise exception 'PAYROLL_APPROVED'; end if;
  if not found then insert into payroll_runs (month) values (v_month) returning * into v_run; end if;
  delete from payroll_lines where run_id = v_run.id;
  insert into payroll_lines (run_id, employee_id, gross, overtime_pay, bonus, absence_deduction, advance_deduction, net, note)
  select v_run.id, e.id, e.monthly_salary + x.ot + x.bonus, x.ot, x.bonus, x.absence, x.advance,
         greatest(e.monthly_salary + x.ot + x.bonus - x.absence - x.advance, 0),
         case when e.monthly_salary + x.ot + x.bonus - x.absence - x.advance < 0
              then 'Advance remainder ৳' || trim_scale(-(e.monthly_salary + x.ot + x.bonus - x.absence - x.advance)) || ' to recover next month' end
  from employees e
  cross join lateral (
    select round(e.monthly_salary / e.working_days
                 * greatest(e.working_days - coalesce((select days_present from attendance a where a.employee_id = e.id and a.month = v_month), e.working_days), 0)) as absence,
           coalesce((select sum(amount) from salary_advances s where s.employee_id = e.id
                     and s.given_on >= v_month and s.given_on < (v_month + interval '1 month')), 0) as advance,
           case when e.employee_type = 'worker'
                then round(coalesce((select hours from overtime o where o.employee_id = e.id and o.month = v_month), 0)
                           * e.monthly_salary / (e.working_days * 8) * 2) else 0 end as ot,
           coalesce((select sum(amount) from bonuses b where b.employee_id = e.id and b.month = v_month), 0) as bonus
  ) x
  where e.is_active;
  return jsonb_build_object('run_id', v_run.id, 'month', v_month, 'status', 'draft',
    'employees', (select count(*) from payroll_lines where run_id = v_run.id),
    'total_net', (select coalesce(sum(net), 0) from payroll_lines where run_id = v_run.id));
end $$;

-- ===== Multi-godown & branch stock =====
-- Stock locations: the main godown and branches. Movements with no location belong to the main godown.
create table if not exists public.godowns (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  name_bn text,
  kind text not null default 'branch' check (kind in ('godown','branch')),
  area text,
  is_main boolean not null default false,
  created_at timestamptz not null default now()
);
-- Every stock movement can say where it happened (empty = main godown, so old rows need no change).
alter table public.stock_movements add column if not exists godown_id uuid references public.godowns (id);
-- Allow transfer reasons alongside the existing ones.
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
-- Re-add the reason rule with transfers included.
alter table public.stock_movements add constraint stock_movements_reason_check check (reason in ('opening','purchase','sale','sale_cancel',
  'adjust_damage','adjust_expired','adjust_lost','adjust_sample','adjust_count','production_in','production_out','transfer_in','transfer_out'));
-- Allow 'transfer' as a source.
alter table public.stock_movements drop constraint if exists stock_movements_source_type_check;
-- Re-add the source rule with transfers included.
alter table public.stock_movements add constraint stock_movements_source_type_check
  check (source_type in ('seed','purchase','invoice','adjustment','production','transfer'));

-- Transfers between locations (total stock never changes; only where it sits).
create sequence if not exists public.transfer_no_seq;
-- One row per transfer.
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_no text unique not null,
  client_ref uuid unique not null,
  product_id uuid not null references public.products (id),
  from_godown uuid not null references public.godowns (id),
  to_godown uuid not null references public.godowns (id),
  qty numeric(12,2) not null check (qty > 0),
  note text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (from_godown <> to_godown)
);

-- View: stock per location per product (from the one shared ledger, so branches are always in sync).
create or replace view public.godown_stock with (security_invoker = true) as
select coalesce(m.godown_id, (select g.id from public.godowns g where g.is_main limit 1)) as godown_id, m.product_id,
       sum(m.qty_change)::numeric(12,2) as qty, max(m.created_at) as last_movement_at
from public.stock_movements m
group by 1, 2;

-- Security: everyone logged in can see locations and branch stock (no cost in them); only the Owner moves stock.
alter table public.godowns enable row level security;
alter table public.stock_transfers enable row level security;
-- Read access for logged-in users.
grant select on public.godowns, public.stock_transfers, public.godown_stock to authenticated;
-- The server key may do everything.
grant all on public.godowns, public.stock_transfers to service_role;
-- Both roles may read locations.
drop policy if exists godowns_read on public.godowns;
create policy godowns_read on public.godowns for select to authenticated using (true);
-- Both roles may read transfers.
drop policy if exists stock_transfers_read on public.stock_transfers;
create policy stock_transfers_read on public.stock_transfers for select to authenticated using (true);

-- transfer_stock (Owner): moves qty of a product from one location to another as two ledger rows (out and in).
create or replace function public.transfer_stock(p_client_ref uuid, p_product_id uuid, p_from uuid, p_to uuid, p_qty numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := current_app_role();
  v_existing stock_transfers%rowtype;
  v_main uuid := (select id from godowns where is_main limit 1);
  v_avail numeric; v_id uuid; v_no text; v_label text;
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if p_client_ref is null then raise exception 'CLIENT_REF_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));
  select * into v_existing from stock_transfers where client_ref = p_client_ref;
  if found then return jsonb_build_object('transfer_id', v_existing.id, 'transfer_no', v_existing.transfer_no, 'duplicate', true); end if;
  if p_qty is null or p_qty <= 0 then raise exception 'INVALID_QTY'; end if;
  if p_from = p_to or not exists (select 1 from godowns where id = p_from) or not exists (select 1 from godowns where id = p_to) then
    raise exception 'INVALID_GODOWN';
  end if;
  perform 1 from products where id = p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  select coalesce(sum(qty_change), 0) into v_avail from stock_movements
  where product_id = p_product_id and coalesce(godown_id, v_main) = p_from;
  if p_qty > v_avail then
    raise exception 'INSUFFICIENT_STOCK:%:%', (select sku from products where id = p_product_id), trim_scale(greatest(v_avail, 0));
  end if;
  v_no := 'TRF-' || lpad(nextval('transfer_no_seq')::text, 6, '0');
  v_label := v_no || ': ' || (select name from godowns where id = p_from) || ' → ' || (select name from godowns where id = p_to)
             || coalesce(' · ' || nullif(btrim(coalesce(p_note, '')), ''), '');
  insert into stock_transfers (transfer_no, client_ref, product_id, from_godown, to_godown, qty, note, created_by)
  values (v_no, p_client_ref, p_product_id, p_from, p_to, p_qty, nullif(btrim(coalesce(p_note, '')), ''), v_uid) returning id into v_id;
  insert into stock_movements (product_id, qty_change, reason, source_type, source_id, note, godown_id, created_by) values
    (p_product_id, -p_qty, 'transfer_out', 'transfer', v_id, v_label, p_from, v_uid),
    (p_product_id, p_qty, 'transfer_in', 'transfer', v_id, v_label, p_to, v_uid);
  return jsonb_build_object('transfer_id', v_id, 'transfer_no', v_no, 'duplicate', false);
end $$;

-- Logged-out visitors may not call the new functions; logged-in users may (each checks the role itself).
revoke execute on function public.add_bonus(date, text, numeric), public.transfer_stock(uuid, uuid, uuid, uuid, numeric, text) from public, anon;
-- Allow logged-in users and the server key.
grant execute on function public.add_bonus(date, text, numeric), public.transfer_stock(uuid, uuid, uuid, uuid, numeric, text),
  public.generate_payroll(date) to authenticated, service_role;

-- ===== Demo data =====
do $$
declare
  v_owner uuid := (select id from auth.users where email = 'owner@oleyn-demo.com');
  v_last date := (date_trunc('month', (now() at time zone 'Asia/Dhaka')::date) - interval '1 month')::date;
  v_year int := extract(year from (now() at time zone 'Asia/Dhaka'))::int;
  v_main uuid; v_nar uuid; v_dha uuid;
begin
  -- Leave history this year (only if none yet).
  if not exists (select 1 from public.leaves) then
    insert into public.leaves (employee_id, leave_type, from_date, to_date, note, created_by)
    select e.id, t.lt, make_date(v_year, t.m, t.d1), make_date(v_year, t.m, t.d2), t.note, v_owner
    from public.employees e join (values
      ('Abdul Karim', 'sick', 3, 10, 12, 'Fever'), ('Abdul Karim', 'casual', 7, 2, 2, 'Family event'),
      ('Fatema Begum', 'annual', 4, 14, 18, 'Pohela Boishakh holiday'), ('Nasrin Akter', 'sick', 9, 22, 25, 'Doctor advised rest'),
      ('Nasrin Akter', 'casual', 10, 6, 7, 'Personal'), ('Shahidul Islam', 'casual', 6, 1, 1, 'Bank work'),
      ('Mitu Rani Das', 'annual', 10, 20, 24, 'Durga Puja leave')) as t(n, lt, m, d1, d2, note) on t.n = e.full_name;
  end if;
  -- Last month's overtime for the three factory workers.
  insert into public.overtime (employee_id, month, hours)
  select e.id, v_last, t.h from public.employees e join (values ('Abdul Karim', 18), ('Fatema Begum', 10), ('Nasrin Akter', 6)) as t(n, h)
    on t.n = e.full_name
  on conflict (employee_id, month) do nothing;
  -- Three locations; the main godown holds everything until something is transferred.
  if not exists (select 1 from public.godowns) then
    insert into public.godowns (name, name_bn, kind, area, is_main) values
      ('Main Godown', 'প্রধান গোডাউন', 'godown', 'Gazipur', true),
      ('Narayanganj Branch', 'নারায়ণগঞ্জ শাখা', 'branch', 'Narayanganj', false),
      ('Dhaka Shop', 'ঢাকা দোকান', 'branch', 'Dhaka', false);
    select id into v_main from public.godowns where is_main;
    select id into v_nar from public.godowns where name = 'Narayanganj Branch';
    select id into v_dha from public.godowns where name = 'Dhaka Shop';
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    perform public.transfer_stock(gen_random_uuid(), (select id from public.products where sku = 'MUM-WATER-500'), v_main, v_nar, 48, 'Weekly branch stock');
    perform public.transfer_stock(gen_random_uuid(), (select id from public.products where sku = 'ACI-SALT-1KG'), v_main, v_nar, 30, 'Weekly branch stock');
    perform public.transfer_stock(gen_random_uuid(), (select id from public.products where sku = 'TEER-SOY-1L'), v_main, v_nar, 12, 'Weekly branch stock');
    perform public.transfer_stock(gen_random_uuid(), (select id from public.products where sku = 'COCA-COLA-1L'), v_main, v_dha, 24, 'Shop refill');
    perform public.transfer_stock(gen_random_uuid(), (select id from public.products where sku = 'MAGGI-NOODLES-8'), v_main, v_dha, 10, 'Shop refill');
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;

-- Checks (rolled back): overtime and bonus reach payroll; a transfer keeps total stock; Salesperson can't transfer.
create or replace function pg_temp.extra_checks() returns table (test text, passed boolean, detail text) language plpgsql as $$
declare n text[] := '{}'; ok boolean[] := '{}'; d text[] := '{}'; r jsonb; v numeric; v2 numeric; v_err text;
  v_owner uuid := (select id from auth.users where email = 'owner@oleyn-demo.com');
  v_sales uuid := (select id from auth.users where email = 'sales@oleyn-demo.com');
  v_last date := (date_trunc('month', (now() at time zone 'Asia/Dhaka')::date) - interval '1 month')::date;
  v_p uuid := (select id from products where sku = 'ACI-SALT-1KG');
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    delete from payroll_runs where month = v_last;   -- start this month's test sheet fresh (rolled back)
    perform public.add_bonus(v_last, 'eid_ul_fitr', 100);
    r := public.generate_payroll(v_last);
    select overtime_pay into v from payroll_lines l join employees e on e.id = l.employee_id where l.run_id = (r->>'run_id')::uuid and e.full_name = 'Abdul Karim';
    n := n || 'Overtime: 18 h x (12000 / 208) x 2 = 2077'::text; ok := ok || (v = 2077); d := d || v::text;
    select bonus into v from payroll_lines l join employees e on e.id = l.employee_id where l.run_id = (r->>'run_id')::uuid and e.full_name = 'Fatema Begum';
    n := n || 'Eid bonus 100% for 1+ year staff (Fatema 16000)'::text; ok := ok || (v = 16000); d := d || v::text;
    select current_stock into v from product_stock where product_id = v_p;
    perform public.transfer_stock(gen_random_uuid(), v_p, (select id from godowns where is_main), (select id from godowns where name = 'Dhaka Shop'), 5);
    select current_stock into v2 from product_stock where product_id = v_p;
    n := n || 'Transfer keeps total stock the same'::text; ok := ok || (v = v2); d := d || (v || ' = ' || v2);
    select coalesce(sum(qty), 0) into v from godown_stock where product_id = v_p;
    n := n || 'Branch stock adds up to total stock'::text; ok := ok || (v = v2); d := d || (v || ' = ' || v2);
    perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
    begin perform public.transfer_stock(gen_random_uuid(), v_p, (select id from godowns where is_main), (select id from godowns where name = 'Dhaka Shop'), 1); v_err := 'allowed (wrong)';
    exception when others then v_err := sqlerrm; end;
    n := n || 'Salesperson cannot transfer'::text; ok := ok || (v_err = 'NOT_ALLOWED'); d := d || v_err;
    raise exception 'DONE';
  exception when others then
    if sqlerrm <> 'DONE' then n := n || 'stopped early'::text; ok := ok || false; d := d || sqlerrm; end if;
  end;
  return query select * from unnest(n, ok, d);
end $$;
-- Run the checks: every row must pass.
select count(*) filter (where passed) as passed, count(*) as total,
       string_agg(test || ' => ' || coalesce(detail, ''), ' | ') filter (where passed is not true) as failures
from pg_temp.extra_checks();
