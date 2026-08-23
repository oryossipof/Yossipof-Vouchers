-- Integration test for the shared-voucher model (0006) and its authorization
-- rules. A share is one row plus membership, so every field is shared; only the
-- owner may hand out links or delete.
--
-- Creates throwaway auth users, acts as each of them by setting the
-- request.jwt.claims GUC that auth.uid() reads, then deletes them again.
-- Asserts at the end that pre-existing data is untouched.

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
  share_token uuid;
  dead_token uuid;
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
  values (user_a, 'Test Store', 'TEST-CODE-001', 100, 'original note')
  returning id into voucher_a;

  share_token := public.create_voucher_share(voucher_a);

  insert into test_results (name, passed, detail)
  values ('T1 owner can create a share link', share_token is not null,
          format('token=%s', share_token is not null));

  -- --------------------------------------------------- B joins the voucher --
  perform set_config('request.jwt.claims', json_build_object('sub', user_b)::text, false);
  select * into claimed from public.claim_voucher_share(share_token);

  select count(*) into n from public.vouchers where user_id = user_b;

  insert into test_results (name, passed, detail)
  values (
    'T2 claiming joins the existing voucher instead of copying it',
    claimed.outcome = 'joined'
      and claimed.voucher_id = voucher_a
      and n = 0
      and public.can_access_voucher(voucher_a),
    format('outcome=%s own_rows=%s can_access=%s',
      claimed.outcome, n, public.can_access_voucher(voucher_a))
  );

  select * into claimed from public.claim_voucher_share(share_token);
  insert into test_results (name, passed, detail)
  values ('T3 claiming twice is idempotent', claimed.outcome = 'already_member',
          format('outcome=%s', claimed.outcome));

  -- ------------------------- THE POINT: every field is shared, not just status
  update public.vouchers
  set store_name = 'Renamed By Member',
      note = 'note from member',
      amount = 250,
      photo_path = user_b::text || '/photo.jpg'
  where id = voucher_a;

  perform set_config('request.jwt.claims', json_build_object('sub', user_a)::text, false);

  insert into test_results (name, passed, detail)
  values (
    'T4 a member edit is visible to the owner (name, note, amount, photo)',
    (select store_name from public.vouchers where id = voucher_a) = 'Renamed By Member'
      and (select note from public.vouchers where id = voucher_a) = 'note from member'
      and (select amount from public.vouchers where id = voucher_a) = 250
      and (select photo_path from public.vouchers where id = voucher_a) is not null,
    format('name=%s note=%s amount=%s',
      (select store_name from public.vouchers where id = voucher_a),
      (select note from public.vouchers where id = voucher_a),
      (select amount from public.vouchers where id = voucher_a))
  );

  insert into test_results (name, passed, detail)
  values (
    'T5 the shared photo is readable by both accounts',
    public.photo_is_accessible(user_b::text || '/photo.jpg'),
    format('owner_can_read=%s', public.photo_is_accessible(user_b::text || '/photo.jpg'))
  );

  -- ------------------------------------------------ status still propagates --
  perform public.set_voucher_status(voucher_a, 'used');
  perform set_config('request.jwt.claims', json_build_object('sub', user_b)::text, false);

  insert into test_results (name, passed, detail)
  values (
    'T6 marking used by the owner is seen by the member',
    (select status from public.vouchers where id = voucher_a) = 'used',
    (select status from public.vouchers where id = voucher_a)
  );

  perform public.set_voucher_status(voucher_a, 'active');
  insert into test_results (name, passed, detail)
  values (
    'T7 a member can restore it too',
    (select status from public.vouchers where id = voucher_a) = 'active',
    (select status from public.vouchers where id = voucher_a)
  );

  -- ------------------------------- SECURITY: members cannot widen access ----
  ok := false;
  txt := null;
  begin
    perform public.create_voucher_share(voucher_a);
  exception when others then
    ok := true;
    txt := sqlerrm;
  end;

  insert into test_results (name, passed, detail)
  values ('T8 SECURITY a member cannot create further share links', ok,
          coalesce(txt, 'no exception — member was able to share'));

  -- ------------------------------- SECURITY: outsiders see nothing ----------
  perform set_config('request.jwt.claims', json_build_object('sub', user_c)::text, false);

  insert into test_results (name, passed, detail)
  values (
    'T9 SECURITY a stranger cannot access the voucher',
    not public.can_access_voucher(voucher_a)
      and not public.photo_is_accessible(user_b::text || '/photo.jpg'),
    format('can_access=%s photo=%s',
      public.can_access_voucher(voucher_a),
      public.photo_is_accessible(user_b::text || '/photo.jpg'))
  );

  ok := false;
  txt := null;
  begin
    perform public.set_voucher_status(voucher_a, 'used');
  exception when others then
    ok := true;
    txt := sqlerrm;
  end;

  insert into test_results (name, passed, detail)
  values ('T10 SECURITY a stranger cannot change the status', ok,
          coalesce(txt, 'no exception raised'));

  -- ------------------------------------------ SECURITY: expired links -------
  insert into public.voucher_shares (voucher_id, created_by, expires_at)
  values (voucher_a, user_a, now() - interval '1 day')
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
  values ('T11 SECURITY an expired share link is rejected', ok,
          coalesce(txt, 'no exception raised'));

  -- ---------------------------------------------------- leaving a share -----
  perform set_config('request.jwt.claims', json_build_object('sub', user_b)::text, false);
  perform public.leave_voucher_share(voucher_a);

  insert into test_results (name, passed, detail)
  values (
    'T12 leaving removes your access but keeps the voucher for the owner',
    not public.can_access_voucher(voucher_a)
      and (select count(*) from public.vouchers where id = voucher_a) = 1,
    format('member_access=%s voucher_rows=%s',
      public.can_access_voucher(voucher_a),
      (select count(*) from public.vouchers where id = voucher_a))
  );

  insert into test_ctx values ('user_a', user_a), ('user_b', user_b),
                              ('user_c', user_c), ('voucher_a', voucher_a);

  insert into test_results (name, passed, detail)
  values ('T0 voucher count before the run', true, format('before=%s', before_count));

exception when others then
  delete from auth.users where id in (user_a, user_b, user_c);
  perform set_config('request.jwt.claims', '', false);
  insert into test_results (name, passed, detail)
  values ('FATAL: main test run aborted', false, sqlerrm);
end;
$$;

-- Column privileges must be checked under the real `authenticated` role.
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
    update public.vouchers set status = 'used' where id = v_id;
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
  values ('T13 SECURITY clients cannot write status directly', ok_blocked,
          coalesce(txt, 'blocked=' || ok_blocked::text));

  insert into test_results (name, passed, detail)
  values ('T14 ordinary edits still work', ok_allowed,
          coalesce(txt, 'allowed=' || ok_allowed::text));
exception when others then
  reset role;
  insert into test_results (name, passed, detail)
  values ('T13/T14 privilege check aborted', false, sqlerrm);
end;
$$;

-- Removing an account from a shared voucher. Self-contained: its own users,
-- cleaned up at the end, so it does not depend on the state left above.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  vid uuid;
  tok uuid;
  ok boolean;
  txt text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'voucher-test-' || u.id || '@example.test', 'x', now(), now(), now(),
         '{}'::jsonb, '{}'::jsonb
  from (values (a), (b), (c)) as u(id);

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  insert into public.vouchers (user_id, store_name, code)
  values (a, 'Removal Test', 'RM-TEST-1') returning id into vid;
  tok := public.create_voucher_share(vid);

  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  perform public.claim_voucher_share(tok);

  ok := false;
  begin
    perform public.remove_voucher_member(vid, a);
  exception when others then ok := true; txt := sqlerrm; end;
  insert into test_results (name, passed, detail)
  values ('R1 SECURITY a member cannot remove anyone', ok, coalesce(txt, 'no exception'));

  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  ok := false; txt := null;
  begin
    perform public.remove_voucher_member(vid, b);
  exception when others then ok := true; txt := sqlerrm; end;
  insert into test_results (name, passed, detail)
  values ('R2 SECURITY a stranger cannot remove anyone', ok, coalesce(txt, 'no exception'));

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  ok := public.remove_voucher_member(vid, b);
  insert into test_results (name, passed, detail)
  values ('R3 the owner can remove a member', ok, format('removed=%s', ok));

  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  insert into test_results (name, passed, detail)
  values ('R4 the removed account loses access', not public.can_access_voucher(vid),
          format('can_access=%s', public.can_access_voucher(vid)));

  ok := false; txt := null;
  begin
    perform public.claim_voucher_share(tok);
  exception when others then ok := true; txt := sqlerrm; end;
  insert into test_results (name, passed, detail)
  values ('R5 SECURITY the old share link is revoked, so no rejoining', ok,
          coalesce(txt, 'no exception — the removed account could rejoin'));

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  ok := false; txt := null;
  begin
    perform public.remove_voucher_member(vid, a);
  exception when others then ok := true; txt := sqlerrm; end;
  insert into test_results (name, passed, detail)
  values ('R6 the owner cannot remove themselves', ok, coalesce(txt, 'no exception'));

  insert into test_results (name, passed, detail)
  values ('R7 the voucher itself survives the removal',
          (select count(*) from public.vouchers where id = vid) = 1,
          format('rows=%s', (select count(*) from public.vouchers where id = vid)));

  delete from auth.users where id in (a, b, c);
  perform set_config('request.jwt.claims', '', false);
exception when others then
  delete from auth.users where id in (a, b, c);
  perform set_config('request.jwt.claims', '', false);
  insert into test_results (name, passed, detail)
  values ('FATAL: removal tests aborted', false, sqlerrm);
end;
$$;

do $$
declare
  strays integer;
  after_count integer;
begin
  delete from auth.users
  where id in (select v from test_ctx where k in ('user_a', 'user_b', 'user_c'));

  perform set_config('request.jwt.claims', '', false);

  select count(*) into after_count from public.vouchers;
  select count(*) into strays from auth.users where email like 'voucher-test-%@example.test';

  insert into test_results (name, passed, detail)
  values ('T15 cleanup removed every test user and left real data untouched', strays = 0,
          format('remaining_vouchers=%s stray_test_users=%s', after_count, strays));
end;
$$;

select
  case when passed then 'PASS' else 'FAIL' end as result,
  name,
  detail
from test_results
order by seq;
