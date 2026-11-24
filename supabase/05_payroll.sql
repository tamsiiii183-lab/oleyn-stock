-- 05_payroll.sql: HR and payroll lite for Rahman Group (spec 14), plus salary raises. Owner only. Run after 04_seed.sql.
-- Safe to run again for the structure; the demo staff are added only if there are none yet.

-- Staff: name, job, factory, monthly salary and normal working days per month.
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  designation text,
  factory text,                                   -- e.g. 'Gazipur Factory 1'
  phone text,
  joined_on date,
  monthly_salary numeric(12,2) not null check (monthly_salary > 0),
  working_days int not null default 26 check (working_days between 1 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Days present per employee per month (month = first day of the month).
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  month date not null check (extract(day from month) = 1),
  days_present int not null check (days_present between 0 and 31),
  created_at timestamptz not null default now(),
  unique (employee_id, month)
);

-- Salary advances; they are deducted in the payroll of the month they were given.
create table if not exists public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  amount numeric(12,2) not null check (amount > 0),
  given_on date not null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- One payroll run per month: draft until the Owner approves it; an approved run can't be regenerated.
create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  month date unique not null check (extract(day from month) = 1),
  status text not null default 'draft' check (status in ('draft','approved')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- The salary sheet: one line per employee per run.
create table if not exists public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs (id) on delete cascade,
  employee_id uuid not null references public.employees (id),
  gross numeric(12,2) not null,
  absence_deduction numeric(12,2) not null,
  advance_deduction numeric(12,2) not null,
  net numeric(12,2) not null,
  note text,
  created_at timestamptz not null default now()
);

-- Salary history: every raise (or cut) with the reason, so pay changes are traceable like stock.
create table if not exists public.salary_revisions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  old_salary numeric(12,2) not null,
  new_salary numeric(12,2) not null check (new_salary > 0),
  effective_month date not null,
  reason text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Security: Row Level Security on, and only the Owner can see or change any of these tables.
alter table public.employees enable row level security;
alter table public.attendance enable row level security;
alter table public.salary_advances enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.salary_revisions enable row level security;
-- Table permissions for logged-in users (the policies below then allow only the Owner).
grant select, insert, update on public.employees, public.attendance, public.salary_advances to authenticated;
-- Runs, lines and revisions are read-only for the app; only the functions below write them.
grant select on public.payroll_runs, public.payroll_lines, public.salary_revisions to authenticated;
-- The server key may do everything.
grant all on public.employees, public.attendance, public.salary_advances, public.payroll_runs, public.payroll_lines, public.salary_revisions to service_role;

-- One "Owner only" policy per table and action.
do $$
declare t text;
begin
  foreach t in array array['employees','attendance','salary_advances','payroll_runs','payroll_lines','salary_revisions'] loop
    execute format('drop policy if exists %1$s_owner_read on public.%1$s', t);
    execute format('create policy %1$s_owner_read on public.%1$s for select to authenticated using (public.is_owner())', t);
  end loop;
  foreach t in array array['employees','attendance','salary_advances'] loop
    execute format('drop policy if exists %1$s_owner_insert on public.%1$s', t);
    execute format('create policy %1$s_owner_insert on public.%1$s for insert to authenticated with check (public.is_owner())', t);
    execute format('drop policy if exists %1$s_owner_update on public.%1$s', t);
    execute format('create policy %1$s_owner_update on public.%1$s for update to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

-- generate_payroll (spec 14.3): creates or replaces the DRAFT salary sheet for a month.
-- gross = salary; absence = salary / working_days x days absent; advances = given that month; net never below 0.
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
  if not found then
    insert into payroll_runs (month) values (v_month) returning * into v_run;
  end if;
  delete from payroll_lines where run_id = v_run.id;
  insert into payroll_lines (run_id, employee_id, gross, absence_deduction, advance_deduction, net, note)
  select v_run.id, e.id, e.monthly_salary, x.absence, x.advance,
         greatest(e.monthly_salary - x.absence - x.advance, 0),
         case when e.monthly_salary - x.absence - x.advance < 0
              then 'Advance remainder ৳' || trim_scale(-(e.monthly_salary - x.absence - x.advance)) || ' to recover next month' end
  from employees e
  cross join lateral (
    select round(e.monthly_salary / e.working_days
                 * greatest(e.working_days - coalesce((select days_present from attendance a where a.employee_id = e.id and a.month = v_month), e.working_days), 0)) as absence,
           coalesce((select sum(amount) from salary_advances s where s.employee_id = e.id
                     and s.given_on >= v_month and s.given_on < (v_month + interval '1 month')), 0) as advance
  ) x
  where e.is_active;
  return jsonb_build_object('run_id', v_run.id, 'month', v_month, 'status', 'draft',
    'employees', (select count(*) from payroll_lines where run_id = v_run.id),
    'total_net', (select coalesce(sum(net), 0) from payroll_lines where run_id = v_run.id));
end $$;

-- approve_payroll: locks the month's salary sheet; it can't be regenerated afterwards.
create or replace function public.approve_payroll(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := current_app_role();
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  update payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_run_id and status = 'draft';
  if not found then raise exception 'PAYROLL_NOT_DRAFT'; end if;
  return jsonb_build_object('run_id', p_run_id, 'status', 'approved');
end $$;

-- give_raise: changes an employee's salary and records the old and new amount with a reason.
create or replace function public.give_raise(p_employee_id uuid, p_new_salary numeric, p_reason text, p_effective_month date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := current_app_role();
  v_old numeric;
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if p_new_salary is null or p_new_salary <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'REASON_REQUIRED'; end if;
  select monthly_salary into v_old from employees where id = p_employee_id for update;
  if not found then raise exception 'EMPLOYEE_NOT_FOUND'; end if;
  insert into salary_revisions (employee_id, old_salary, new_salary, effective_month, reason)
  values (p_employee_id, v_old, round(p_new_salary, 2),
          date_trunc('month', coalesce(p_effective_month, (now() at time zone 'Asia/Dhaka')::date))::date, btrim(p_reason));
  update employees set monthly_salary = round(p_new_salary, 2) where id = p_employee_id;
  return jsonb_build_object('employee_id', p_employee_id, 'old_salary', v_old, 'new_salary', round(p_new_salary, 2));
end $$;

-- Only logged-in users may call these (each checks for the Owner role itself); nobody logged out.
revoke execute on function public.generate_payroll(date), public.approve_payroll(uuid), public.give_raise(uuid, numeric, text, date) from public, anon;
-- Allow logged-in users to call them.
grant execute on function public.generate_payroll(date), public.approve_payroll(uuid), public.give_raise(uuid, numeric, text, date) to authenticated, service_role;

-- Demo staff for Rahman Group: 6 people in 2 Gazipur factories, last month's attendance, 2 advances, 1 past raise.
do $$
declare
  v_last date := (date_trunc('month', (now() at time zone 'Asia/Dhaka')::date) - interval '1 month')::date;
  v_owner uuid := (select id from auth.users where email = 'owner@oleyn-demo.com');
begin
  if exists (select 1 from public.employees) then return; end if;
  insert into public.employees (full_name, designation, factory, phone, joined_on, monthly_salary) values
    ('Abdul Karim', 'Machine Operator', 'Gazipur Factory 1', '01800-000001', '2023-02-01', 12000),
    ('Fatema Begum', 'Quality Inspector', 'Gazipur Factory 1', '01800-000002', '2022-07-15', 16000),
    ('Shahidul Islam', 'Line Supervisor', 'Gazipur Factory 1', '01800-000003', '2021-01-10', 22000),
    ('Nasrin Akter', 'Store Keeper', 'Gazipur Factory 2', '01800-000004', '2023-09-01', 14000),
    ('Rafiqul Hasan', 'Accountant', 'Gazipur Factory 2', '01800-000005', '2020-03-01', 28000),
    ('Mitu Rani Das', 'Production Manager', 'Gazipur Factory 2', '01800-000006', '2019-05-20', 35000);
  insert into public.attendance (employee_id, month, days_present)
  select id, v_last, d from public.employees join (values
    ('Abdul Karim', 24), ('Fatema Begum', 26), ('Shahidul Islam', 25),
    ('Nasrin Akter', 22), ('Rafiqul Hasan', 26), ('Mitu Rani Das', 26)) as t(n, d) on t.n = full_name;
  insert into public.salary_advances (employee_id, amount, given_on, note, created_by)
  select id, amt, v_last + off, 'Advance for family need', v_owner from public.employees join (values
    ('Abdul Karim', 2000, 9), ('Nasrin Akter', 3000, 17)) as t(n, amt, off) on t.n = full_name;
  insert into public.salary_revisions (employee_id, old_salary, new_salary, effective_month, reason, created_by)
  select id, 20000, 22000, (v_last - interval '2 months')::date, 'Yearly raise: promoted to Line Supervisor', v_owner
  from public.employees where full_name = 'Shahidul Islam';
end $$;

-- Show what exists now.
select (select count(*) from public.employees) as employees, (select count(*) from public.attendance) as attendance_rows,
       (select count(*) from public.salary_advances) as advances, (select count(*) from public.salary_revisions) as raises;
