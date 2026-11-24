-- 08_module_tests.sql: checks for payroll, raises and production (rolled back). Run after 05 and 07.
-- Payroll + module checks (everything rolled back). Expected: Abdul Karim net 9077, Nasrin Akter net 8846, Salesperson sees 0 staff rows.
create or replace function pg_temp.erp_checks() returns table (test text, passed boolean, detail text) language plpgsql as $$
declare n text[] := '{}'; ok boolean[] := '{}'; d text[] := '{}'; r jsonb; v_last date; v_cnt int; v_err text; v_sales uuid;
begin
  v_last := (date_trunc('month', (now() at time zone 'Asia/Dhaka')::date) - interval '1 month')::date;
  v_sales := (select id from auth.users where email = 'sales@oleyn-demo.com');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email='owner@oleyn-demo.com'), 'role','authenticated')::text, true);
    r := public.generate_payroll(v_last);
    n := n || 'Payroll: 6 lines generated'::text; ok := ok || ((r->>'employees')::int = 6); d := d || (r->>'employees');
    select (select net from payroll_lines l join employees e on e.id = l.employee_id where l.run_id = (r->>'run_id')::uuid and e.full_name = 'Abdul Karim')
      into v_err;
    n := n || 'Abdul Karim: 12000 - absence 923 - advance 2000 = 9077'::text; ok := ok || (v_err::numeric = 9077); d := d || v_err;
    select (select net from payroll_lines l join employees e on e.id = l.employee_id where l.run_id = (r->>'run_id')::uuid and e.full_name = 'Nasrin Akter') into v_err;
    n := n || 'Nasrin Akter: 14000 - 2154 - 3000 = 8846'::text; ok := ok || (v_err::numeric = 8846); d := d || v_err;
    perform public.approve_payroll((r->>'run_id')::uuid);
    begin perform public.generate_payroll(v_last); v_err := 'regenerated (wrong)'; exception when others then v_err := sqlerrm; end;
    n := n || 'Approved payroll cannot be regenerated'::text; ok := ok || (v_err = 'PAYROLL_APPROVED'); d := d || v_err;
    r := public.give_raise((select id from employees where full_name='Abdul Karim'), 13000, 'Test raise');
    n := n || 'Raise recorded with old and new salary'::text; ok := ok || ((r->>'old_salary')::numeric = 12000 and (select monthly_salary from employees where full_name='Abdul Karim') = 13000); d := d || r::text;
    perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role','authenticated')::text, true);
    begin perform public.generate_payroll(v_last); v_err := 'allowed (wrong)'; exception when others then v_err := sqlerrm; end;
    n := n || 'Salesperson cannot run payroll'::text; ok := ok || (v_err = 'NOT_ALLOWED'); d := d || v_err;
    begin perform public.complete_production(gen_random_uuid(), (select id from products where sku='RG-SNACK-BOX'), 1); v_err := 'allowed (wrong)'; exception when others then v_err := sqlerrm; end;
    n := n || 'Salesperson cannot run production'::text; ok := ok || (v_err = 'NOT_ALLOWED'); d := d || v_err;
    set local role authenticated;
    select (select count(*) from employees) + (select count(*) from payroll_lines) + (select count(*) from salary_revisions) + (select count(*) from boms) + (select count(*) from production_orders) into v_cnt;
    reset role;
    n := n || 'Salesperson sees 0 HR, payroll or production rows'::text; ok := ok || (v_cnt = 0); d := d || (v_cnt || ' rows');
    raise exception 'DONE';
  exception when others then
    if sqlerrm <> 'DONE' then n := n || 'stopped early'::text; ok := ok || false; d := d || sqlerrm; end if;
  end;
  return query select * from unnest(n, ok, d);
end $$;
select count(*) filter (where passed) as passed, count(*) as total, string_agg(test || ' => ' || coalesce(detail,''), ' | ') filter (where passed is not true) as failures from pg_temp.erp_checks();
