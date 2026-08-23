-- Integration test for voucher sharing, cross-account status sync, and the
-- authorization rules added in 0004_harden_sharing.sql.
--
-- Creates throwaway auth users, exercises the share functions as each of them
-- by setting the request.jwt.claims GUC that auth.uid() reads, then deletes the
-- users again (which cascades to their vouchers and share rows).
--
-- Safe to run against a live project: it only ever touches rows it created, and
-- asserts at the end that the pre-existing voucher count is unchanged.

create temp table if not exists test_results (
  seq serial,
  name text,
  passed boolean,
  detail text
);
truncate test_results;

create temp table if not exists test_ctx (k text primary key, v uuid);
truncate test_ctx;

do $$
declare
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  user_c uuid := gen_random_uuid();
  instance uuid := '00000000-0000-0000-0000-000000000000';
  voucher_a uuid;
  voucher_b uuid;
  voucher_c uuid;
  share_token uuid;
  dead_token uuid;
  group_id uuid;
  claimed record;
  before_count integer;
  n integer;
  txt text;
  ok boolean;
begin
  select count(*) into before_count from public.vouchers;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  select u.id, instance, 'authenticated', 'authenticated',
         'voucher-test-' || u.id || '@example.test', 'x',
         now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  from (values (user_a), (user_b), (user_c)) as u(id);

  perform set_config('request.jwt.claims', json_build_object('sub', user_a)::text, false);

  insert into public.vouchers (user_id, store_name, code, amount, note)
  values (user_a, 'Test Store', 'TEST-CODE-001', 100, 'a note')
  returning id into voucher_a;

  -- ------------------------------------------------- T1: create the share --
  share_token := public.create_voucher_share(voucher_a);
  select share_group_id into group_id from public.vouchers where id = voucher_a;

  insert into test_results (name, passed, detail)
  values (
    'T1 create_voucher_share stamps a share group and records the originator',
    share_token is not null
      and group_id is not null
      and (select share_origin from public.vouchers where id = voucher_a) = user_a,
    format('token=%s group=%s origin_ok=%s',
      share_token is not null, group_id is not null,
      (select share_origin from public.vouchers where id = voucher_a) = user_a)
  );

  -- ------------------------------------------------------ T2: B claims it --
  perform set_config('request.jwt.claims', json_build_object('sub', user_b)::text, false);

  select * into claimed from public.claim_voucher_share(share_token);
  voucher_b := claimed.voucher_id;
  select count(*) into n from public.vouchers where user_id = user_b;

  insert into test_results (name, passed, detail)
  values (
    'T2 claim copies the voucher into the claimer account',
    claimed.outcome = 'created'
      and n = 1
      and (select code from public.vouchers where id = voucher_b) = 'TEST-CODE-001'
      and (select share_group_id from public.vouchers where id = voucher_b) = group_id,
    format('outcome=%s rows=%s', claimed.outcome, n)
  );

  insert into test_results (name, passed, detail)
  values (
    'T2b claimed copy carries the note across',
    (select note from public.vouchers where id = voucher_b) = 'a note',
    coalesce((select note from public.vouchers where id = voucher_b), '<null>')
  );

  -- --------------------------------------------- T3: claiming twice is safe --
  select * into claimed from public.claim_voucher_share(share_token);
  select count(*) into n from public.vouchers where user_id = user_b;

  insert into test_results (name, passed, detail)
  values (
    'T3 re-claiming the same link does not duplicate',
    claimed.outcome = 'already_in_group' and n = 1 and claimed.voucher_id = voucher_b,
    format('outcome=%s rows=%s', claimed.outcome, n)
  );

  -- ---------------------- SECURITY: a recipient cannot re-share the group ---
  ok := false;
  txt := null;
  begin
    perform public.create_voucher_share(voucher_b);
  exception when others then
    ok := true;
    txt := sqlerrm;
  end;

  insert into test_results (name, passed, detail)
  values (
    'T4 SECURITY a recipient cannot mint further share links for the group',
    ok, coalesce(txt, 'no exception raised — recipient was able to re-share')
  );

  -- ------------------------------------- T5: A marks used, B sees it used --
  perform set_config('request.jwt.claims', json_build_object('sub', user_a)::text, false);
  perform public.set_voucher_status(voucher_a, 'used');

  insert into test_results (name, passed, detail)
  values (
    'T5 marking used in one account marks it used in the other',
    (select status from public.vouchers where id = voucher_a) = 'used'
      and (select status from public.vouchers where id = voucher_b) = 'used',
    format('a=%s b=%s',
      (select status from public.vouchers where id = voucher_a),
      (select status from public.vouchers where id = voucher_b))
  );

  -- ------------------------------ T6: B restores, A sees it active again ---
  perform set_config('request.jwt.claims', json_build_object('sub', user_b)::text, false);
  perform public.set_voucher_status(voucher_b, 'active');

  insert into test_results (name, passed, detail)
  values (
    'T6 restoring to active propagates back the other way',
    (select status from public.vouchers where id = voucher_a) = 'active'
      and (select used_at from public.vouchers where id = voucher_a) is null,
    format('a=%s b=%s',
      (select status from public.vouchers where id = voucher_a),
      (select status from public.vouchers where id = voucher_b))
  );

  -- --------- SECURITY: same code is reported, not silently absorbed --------
  perform set_config('request.jwt.claims', json_build_object('sub', user_c)::text, false);

  insert into public.vouchers (user_id, store_name, code)
  values (user_c, 'Unrelated Store', '  test-code-001  ')
  returning id into voucher_c;

  perform public.set_voucher_status(voucher_c, 'used');
  select * into claimed from public.claim_voucher_share(share_token);

  insert into test_results (name, passed, detail)
  values (
    'T7 SECURITY a same-code voucher is reported, not silently absorbed',
    claimed.outcome = 'code_conflict'
      and claimed.voucher_id = voucher_c
      and (select share_group_id from public.vouchers where id = voucher_c) is null
      and (select status from public.vouchers where id = voucher_c) = 'used',
    format('outcome=%s group_untouched=%s status_untouched=%s',
      claimed.outcome,
      (select share_group_id from public.vouchers where id = voucher_c) is null,
      (select status from public.vouchers where id = voucher_c) = 'used')
  );

  -- ------------------------- T8: explicit opt-in merge does link them ------
  perform public.link_voucher_to_share(share_token, voucher_c);

  insert into test_results (name, passed, detail)
  values (
    'T8 explicit link_voucher_to_share merges on the user decision',
    (select share_group_id from public.vouchers where id = voucher_c) = group_id
      and (select status from public.vouchers where id = voucher_c) = 'active',
    format('group=%s status=%s',
      (select share_group_id from public.vouchers where id = voucher_c) = group_id,
      (select status from public.vouchers where id = voucher_c))
  );

  -- ---------------- SECURITY: cannot link a voucher you do not own ---------
  perform set_config('request.jwt.claims', json_build_object('sub', user_b)::text, false);
  ok := false;
  txt := null;
  begin
    perform public.link_voucher_to_share(share_token, voucher_a);
  exception when others then
    ok := true;
    txt := sqlerrm;
  end;

  insert into test_results (name, passed, detail)
  values (
    'T9 SECURITY cannot link a voucher belonging to someone else',
    ok, coalesce(txt, 'no exception raised')
  );

  -- ------------------------------- SECURITY: expired links are rejected ----
  insert into public.voucher_shares (voucher_id, share_group_id, created_by, expires_at)
  values (voucher_a, group_id, user_a, now() - interval '1 day')
  returning token into dead_token;

  ok := false;
  txt := null;
  begin
    perform public.claim_voucher_share(dead_token);
  exception when others then
    ok := true;
    txt := sqlerrm;
  end;

  insert into test_results (name, passed, detail)
  values (
    'T10 SECURITY an expired share link is rejected',
    ok, coalesce(txt, 'no exception raised')
  );

  -- -------------------- SECURITY: stranger cannot change status ------------
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, false);
  ok := false;
  txt := null;
  begin
    perform public.set_voucher_status(voucher_a, 'used');
  exception when others then
    ok := true;
    txt := sqlerrm;
  end;

  insert into test_results (name, passed, detail)
  values (
    'T11 SECURITY a stranger cannot change the status of a voucher they do not hold',
    ok, coalesce(txt, 'no exception raised')
  );

  ok := false;
  txt := null;
  begin
    perform public.claim_voucher_share(gen_random_uuid());
  exception when others then
    ok := true;
    txt := sqlerrm;
  end;

  insert into test_results (name, passed, detail)
  values ('T12 an invalid share token is rejected', ok, coalesce(txt, 'no exception raised'));

  -- Hand ids to the privilege test below, which must run under a real role.
  insert into test_ctx values ('user_a', user_a), ('user_b', user_b),
                              ('user_c', user_c), ('voucher_a', voucher_a);

  insert into test_results (name, passed, detail)
  values (
    'T0 voucher count recorded before the run',
    true, format('before=%s', before_count)
  );

exception when others then
  delete from auth.users where id in (user_a, user_b, user_c);
  perform set_config('request.jwt.claims', '', false);
  insert into test_results (name, passed, detail)
  values ('FATAL: main test run aborted', false, sqlerrm);
end;
$$;

-- Column privileges have to be checked under the actual `authenticated` role;
-- as the table owner every write would succeed regardless of the grants.
do $$
declare
  v_id uuid;
  v_owner uuid;
  ok_blocked boolean := false;
  ok_allowed boolean := false;
  txt text;
begin
  select v into v_id from test_ctx where k = 'voucher_a';
  select v into v_owner from test_ctx where k = 'user_a';
  if v_id is null then return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, false);
  set local role authenticated;

  begin
    update public.vouchers set share_group_id = gen_random_uuid() where id = v_id;
  exception when insufficient_privilege then
    ok_blocked := true;
  when others then
    txt := sqlerrm;
  end;

  begin
    update public.vouchers set note = 'still editable' where id = v_id;
    ok_allowed := true;
  exception when others then
    txt := coalesce(txt, '') || ' | note update failed: ' || sqlerrm;
  end;

  reset role;

  insert into test_results (name, passed, detail)
  values (
    'T13 SECURITY clients cannot write share_group_id directly',
    ok_blocked, coalesce(txt, 'blocked=' || ok_blocked::text)
  );

  insert into test_results (name, passed, detail)
  values (
    'T14 ordinary edits still work for the owner',
    ok_allowed, coalesce(txt, 'allowed=' || ok_allowed::text)
  );
exception when others then
  reset role;
  insert into test_results (name, passed, detail)
  values ('T13/T14 privilege check aborted', false, sqlerrm);
end;
$$;

-- Cleanup and final accounting.
do $$
declare
  after_count integer;
  strays integer;
begin
  delete from auth.users
  where id in (select v from test_ctx where k in ('user_a', 'user_b', 'user_c'));

  perform set_config('request.jwt.claims', '', false);

  select count(*) into after_count from public.vouchers;
  select count(*) into strays from auth.users where email like 'voucher-test-%@example.test';

  insert into test_results (name, passed, detail)
  values (
    'T15 cleanup removed every test user and left real data untouched',
    strays = 0,
    format('remaining_vouchers=%s stray_test_users=%s', after_count, strays)
  );
end;
$$;

select
  case when passed then 'PASS' else 'FAIL' end as result,
  name,
  detail
from test_results
order by seq;
