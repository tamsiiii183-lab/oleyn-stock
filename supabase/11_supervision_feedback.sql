-- 11_supervision_feedback.sql: Supervision (who did what, when; Owner only) and Feedback entry (both roles).
-- The activity log is written by database triggers, so every change is recorded even if someone bypasses the app.
-- Run after 10.

-- One row per recorded change: who, when, which table, what action, and the row before/after.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                                   -- auth.uid(); empty = system / seed
  table_name text not null,
  action text not null check (action in ('insert','update','delete')),
  row_id text,
  old_data jsonb,
  new_data jsonb
);
-- Speeds up "latest first" and "by person".
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor, at desc);

-- Trigger function: records the change (skips updates where nothing actually changed).
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then return new; end if;
  insert into audit_log (actor, table_name, action, row_id, old_data, new_data)
  values (auth.uid(), tg_table_name, lower(tg_op),
          coalesce(case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'id', ''),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- Attach the recorder to every table where staff actions matter.
do $$
declare t text;
begin
  foreach t in array array['products','product_costs','customers','sales_invoices','customer_ledger','purchases',
                           'employees','salary_revisions','salary_advances','leaves','payroll_runs','purchase_requests','stock_transfers'] loop
    execute format('drop trigger if exists %1$s_audit on public.%1$s', t);
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;
-- Stock movements: record only hand-made changes (adjustments and production); sales and purchases are logged above.
drop trigger if exists stock_movements_audit on public.stock_movements;
-- Recorder for stock adjustments and production runs.
create trigger stock_movements_audit after insert on public.stock_movements
  for each row when (new.source_type in ('adjustment','production')) execute function public.audit_row();

-- Owner only: a Salesperson cannot read the log (it contains costs and salaries).
alter table public.audit_log enable row level security;
-- Read permission for logged-in users; the policy below allows only the Owner.
grant select on public.audit_log to authenticated;
-- The server key may do everything.
grant all on public.audit_log to service_role;
-- Only the Owner reads the activity log.
drop policy if exists audit_log_owner_read on public.audit_log;
create policy audit_log_owner_read on public.audit_log for select to authenticated using (public.is_owner());

-- Backfill once: past activity already in the ledgers, so Supervision is useful from day one.
do $$
begin
  if exists (select 1 from public.audit_log) then return; end if;
  insert into public.audit_log (at, actor, table_name, action, row_id, new_data)
  select created_at, created_by, 'sales_invoices', 'insert', id::text, to_jsonb(s) from public.sales_invoices s
  union all select created_at, created_by, 'customer_ledger', 'insert', id::text, to_jsonb(l) from public.customer_ledger l where entry_type = 'payment'
  union all select created_at, created_by, 'purchases', 'insert', id::text, to_jsonb(p) from public.purchases p
  union all select created_at, created_by, 'stock_movements', 'insert', id::text, to_jsonb(m) from public.stock_movements m where source_type in ('adjustment','production')
  union all select created_at, created_by, 'stock_transfers', 'insert', id::text, to_jsonb(x) from public.stock_transfers x
  union all select created_at, created_by, 'salary_revisions', 'insert', id::text, to_jsonb(r) from public.salary_revisions r
  union all select created_at, created_by, 'salary_advances', 'insert', id::text, to_jsonb(a) from public.salary_advances a
  union all select created_at, created_by, 'purchase_requests', 'insert', id::text, to_jsonb(q) from public.purchase_requests q
  union all select created_at, created_by, 'products', 'insert', id::text, to_jsonb(pr) from public.products pr
  union all select created_at, created_by, 'customers', 'insert', id::text, to_jsonb(c) from public.customers c
  order by 1;
end $$;

-- Feedback from staff: bug, idea, question or other, with an optional 1-5 rating.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references public.profiles (id),
  kind text not null check (kind in ('bug','idea','question','other')),
  message text not null check (char_length(message) between 3 and 2000),
  rating int check (rating between 1 and 5),
  page text,
  status text not null default 'new' check (status in ('new','seen','done')),
  created_at timestamptz not null default now()
);
-- Security: everyone can send feedback as themselves; the Owner reads all and updates status; staff read their own.
alter table public.feedback enable row level security;
-- Table permissions for logged-in users.
grant select, insert on public.feedback to authenticated;
-- Only the status column can be changed (by the Owner, per the policy below).
grant update (status) on public.feedback to authenticated;
-- The server key may do everything.
grant all on public.feedback to service_role;
-- Anyone logged in may send feedback, only under their own name.
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert to authenticated with check (created_by = auth.uid());
-- Owner reads all feedback; staff read only their own.
drop policy if exists feedback_read on public.feedback;
create policy feedback_read on public.feedback for select to authenticated using (public.is_owner() or created_by = auth.uid());
-- Only the Owner may change status (new / seen / done).
drop policy if exists feedback_owner_update on public.feedback;
create policy feedback_owner_update on public.feedback for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- Checks (rolled back): an edit by the Salesperson's account is recorded with who and old -> new; Salesperson can't read the log.
create or replace function pg_temp.supervision_checks() returns table (test text, passed boolean, detail text) language plpgsql as $$
declare n text[] := '{}'; ok boolean[] := '{}'; d text[] := '{}'; v int; v_before bigint;
  v_owner uuid := (select id from auth.users where email = 'owner@oleyn-demo.com');
  v_sales uuid := (select id from auth.users where email = 'sales@oleyn-demo.com');
begin
  begin
    select count(*) into v_before from audit_log;
    n := n || 'Backfill: past activity is in the log'::text; ok := ok || (v_before > 30); d := d || (v_before || ' rows');
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    update products set sale_price = 26 where sku = 'PRAN-MANGO-250';
    select count(*) into v from audit_log where table_name = 'products' and action = 'update' and actor = v_owner
      and (old_data->>'sale_price')::numeric = 25 and (new_data->>'sale_price')::numeric = 26;
    n := n || 'Price edit recorded with who and 25 -> 26'::text; ok := ok || (v = 1); d := d || (v || ' row');
    perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
    insert into customers (name, created_by) values ('Supervision Test Shop', v_sales);
    select count(*) into v from audit_log where table_name = 'customers' and actor = v_sales and new_data->>'name' = 'Supervision Test Shop';
    n := n || 'Salesperson adding a customer is recorded'::text; ok := ok || (v = 1); d := d || (v || ' row');
    set local role authenticated;
    select count(*) into v from audit_log;
    insert into feedback (kind, message) values ('idea', 'Test feedback message');
    reset role;
    n := n || 'Salesperson sees 0 log rows but can send feedback'::text; ok := ok || (v = 0 and exists (select 1 from feedback where message = 'Test feedback message' and created_by = v_sales)); d := d || (v || ' rows visible');
    raise exception 'DONE';
  exception when others then
    if sqlerrm <> 'DONE' then n := n || 'stopped early'::text; ok := ok || false; d := d || sqlerrm; end if;
  end;
  return query select * from unnest(n, ok, d);
end $$;
-- Run the checks: every row must pass.
select count(*) filter (where passed) as passed, count(*) as total,
       string_agg(test || ' => ' || coalesce(detail, ''), ' | ') filter (where passed is not true) as failures
from pg_temp.supervision_checks();
