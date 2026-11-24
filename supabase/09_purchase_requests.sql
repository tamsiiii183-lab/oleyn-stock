-- 09_purchase_requests.sql: a Salesperson can receive stock with the AI memo reader WITHOUT seeing any cost.
-- They send items + quantities as a request; the Owner adds/confirms costs and approves, and only then stock goes up.
-- Run after 07_modules.sql.

-- Numbering for requests: REQ-000001 ...
create sequence if not exists public.request_no_seq;

-- A stock receipt waiting for the Owner. Lines hold product, qty and what the memo said, never a price.
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text unique not null,
  client_ref uuid unique not null,
  supplier_name text,
  lines jsonb not null,                               -- [{product_id, qty, item_name, ai_index}]
  ai_extraction_id uuid references public.ai_extractions (id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  purchase_id uuid references public.purchases (id),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Security: the Owner sees every request; a Salesperson sees only their own. Nobody writes directly.
alter table public.purchase_requests enable row level security;
-- Logged-in users may read (filtered by the policy below).
grant select on public.purchase_requests to authenticated;
-- The server key may do everything.
grant all on public.purchase_requests to service_role;
-- Owner sees all requests; a Salesperson only the ones they sent.
drop policy if exists purchase_requests_read on public.purchase_requests;
create policy purchase_requests_read on public.purchase_requests for select to authenticated
  using (public.is_owner() or created_by = auth.uid());

-- submit_purchase_request (both roles): saves items + quantities for the Owner to approve. Safe save via client_ref.
create or replace function public.submit_purchase_request(p_client_ref uuid, p_supplier_name text, p_lines jsonb, p_ai_extraction_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text := current_app_role();
  v_existing purchase_requests%rowtype;
  v_line jsonb; v_clean jsonb := '[]'::jsonb; v_id uuid; v_no text;
begin
  if p_client_ref is null then raise exception 'CLIENT_REF_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));
  select * into v_existing from purchase_requests where client_ref = p_client_ref;
  if found then return jsonb_build_object('request_id', v_existing.id, 'request_no', v_existing.request_no, 'duplicate', true); end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'EMPTY_INVOICE'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(v_line->>'qty', '') !~ '^[0-9]+(\.[0-9]+)?$' or (v_line->>'qty')::numeric <= 0 then raise exception 'INVALID_QTY'; end if;
    if coalesce(v_line->>'product_id', '') !~* '^[0-9a-f-]{36}$'
       or not exists (select 1 from products where id = (v_line->>'product_id')::uuid) then raise exception 'PRODUCT_NOT_FOUND'; end if;
    -- Keep only safe fields: any price sent by the app is dropped.
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('product_id', v_line->>'product_id', 'qty', (v_line->>'qty')::numeric,
      'item_name', v_line->>'item_name', 'ai_index', v_line->'ai_index'));
  end loop;
  v_no := 'REQ-' || lpad(nextval('request_no_seq')::text, 6, '0');
  insert into purchase_requests (request_no, client_ref, supplier_name, lines, ai_extraction_id, created_by)
  values (v_no, p_client_ref, nullif(btrim(coalesce(p_supplier_name, '')), ''), v_clean, p_ai_extraction_id, v_uid)
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'request_no', v_no, 'duplicate', false);
end $$;

-- approve_purchase_request (Owner): creates the real purchase with the Owner's costs and marks the request approved.
create or replace function public.approve_purchase_request(p_request_id uuid, p_client_ref uuid, p_supplier_name text, p_lines jsonb,
  p_fields_edited int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := current_app_role();
  v_req purchase_requests%rowtype;
  r jsonb;
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  select * into v_req from purchase_requests where id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_req.status = 'approved' then
    return jsonb_build_object('request_id', v_req.id, 'purchase_id', v_req.purchase_id, 'duplicate', true);
  end if;
  if v_req.status <> 'pending' then raise exception 'REQUEST_NOT_PENDING'; end if;
  r := create_purchase(p_client_ref, coalesce(nullif(btrim(coalesce(p_supplier_name, '')), ''), v_req.supplier_name), p_lines,
                       case when v_req.ai_extraction_id is null then 'manual' else 'ai' end, v_req.ai_extraction_id, p_fields_edited);
  update purchase_requests set status = 'approved', purchase_id = (r->>'purchase_id')::uuid, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id;
  return r || jsonb_build_object('request_id', p_request_id);
end $$;

-- reject_purchase_request (Owner): closes a request without changing stock, with a note.
create or replace function public.reject_purchase_request(p_request_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := current_app_role();
begin
  if v_role <> 'owner' then raise exception 'NOT_ALLOWED'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'REASON_REQUIRED'; end if;
  update purchase_requests set status = 'rejected', review_note = btrim(p_note), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id and status = 'pending';
  if not found then raise exception 'REQUEST_NOT_PENDING'; end if;
  return jsonb_build_object('request_id', p_request_id, 'status', 'rejected');
end $$;

-- Logged-out visitors may not call these; logged-in users may (each checks the role itself).
revoke execute on function public.submit_purchase_request(uuid, text, jsonb, uuid), public.approve_purchase_request(uuid, uuid, text, jsonb, int),
  public.reject_purchase_request(uuid, text) from public, anon;
-- Allow logged-in users and the server key.
grant execute on function public.submit_purchase_request(uuid, text, jsonb, uuid), public.approve_purchase_request(uuid, uuid, text, jsonb, int),
  public.reject_purchase_request(uuid, text) to authenticated, service_role;

-- Checks (rolled back): Salesperson sends a request with a sneaky price; it is dropped; stock does not change until the Owner approves.
create or replace function pg_temp.request_checks() returns table (test text, passed boolean, detail text) language plpgsql as $$
declare n text[] := '{}'; ok boolean[] := '{}'; d text[] := '{}'; r jsonb; v_err text; v_before numeric; v_after numeric;
  v_owner uuid := (select id from auth.users where email = 'owner@oleyn-demo.com');
  v_sales uuid := (select id from auth.users where email = 'sales@oleyn-demo.com');
  v_p uuid := (select id from products where sku = 'ACI-SALT-1KG'); v_req uuid;
begin
  begin
    select current_stock into v_before from product_stock where product_id = v_p;
    perform set_config('request.jwt.claims', json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
    r := public.submit_purchase_request(gen_random_uuid(), 'Test supplier', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 10, 'unit_cost', 99, 'item_name', 'salt')));
    v_req := (r->>'request_id')::uuid;
    n := n || 'Salesperson can send a request; price is dropped'::text; ok := ok || (v_req is not null and not ((select lines->0 from purchase_requests where id = v_req) ? 'unit_cost')); d := d || (r->>'request_no');
    select current_stock into v_after from product_stock where product_id = v_p;
    n := n || 'Stock unchanged until approval'::text; ok := ok || (v_after = v_before); d := d || (v_before || ' -> ' || v_after);
    begin perform public.approve_purchase_request(v_req, gen_random_uuid(), null, '[]'::jsonb); v_err := 'allowed (wrong)'; exception when others then v_err := sqlerrm; end;
    n := n || 'Salesperson cannot approve'::text; ok := ok || (v_err = 'NOT_ALLOWED'); d := d || v_err;
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    r := public.approve_purchase_request(v_req, gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 10, 'unit_cost', 36)));
    select current_stock into v_after from product_stock where product_id = v_p;
    n := n || 'Owner approves: stock +10, request approved'::text; ok := ok || (v_after = v_before + 10 and (select status from purchase_requests where id = v_req) = 'approved'); d := d || (v_before || ' -> ' || v_after);
    raise exception 'DONE';
  exception when others then
    if sqlerrm <> 'DONE' then n := n || 'stopped early'::text; ok := ok || false; d := d || sqlerrm; end if;
  end;
  return query select * from unnest(n, ok, d);
end $$;
-- Run the checks: every row must pass.
select count(*) filter (where passed) as passed, count(*) as total,
       string_agg(test || ' => ' || coalesce(detail, ''), ' | ') filter (where passed is not true) as failures
from pg_temp.request_checks();
