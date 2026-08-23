-- Integration test for the bundle share link ("share all", migration 0010).
--
-- Same harness as sharing_test.sql: throwaway auth users, acted as by setting
-- the request.jwt.claims GUC that auth.uid() reads, cleaned up at the end.
-- Asserts that pre-existing data is untouched.

create temp table if not exists bundle_results (
  seq serial,
  name text,
  passed boolean,
  detail text
);
truncate bundle_results;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  instance uuid := '00000000-0000-0000-0000-000000000000';
  v1 uuid;
  v2 uuid;
  v3 uuid;
  foreign_v uuid;
  bundle uuid;
  bundle2 uuid;
  dead uuid;
  single uuid;
  before_count integer;
  joined integer;
  already integer;
  own integer;
  n integer;
  ok boolean;
  txt text;
begin
  select count(*) into before_count from public.vouchers;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  select u.id, instance, 'authenticated', 'authenticated',
         'voucher-test-' || u.id || '@example.test', 'x', now(), now(), now(),
         '{}'::jsonb, '{}'::jsonb
  from (values (a), (b), (c)) as u(id);

  -- A owns three vouchers; C owns one that A must not be able to share.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  insert into public.vouchers (user_id, store_name, code)
  values (a, 'Bundle Store 1', 'BUNDLE-1') returning id into v1;
  insert into public.vouchers (user_id, store_name, code)
  values (a, 'Bundle Store 2', 'BUNDLE-2') returning id into v2;
  insert into public.vouchers (user_id, store_name, code)
  values (a, 'Bundle Store 3', 'BUNDLE-3') returning id into v3;

  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  insert into public.vouchers (user_id, store_name, code)
  values (c, 'Someone Elses', 'BUNDLE-FOREIGN') returning id into foreign_v;

  -- ------------------------------------------------- minting a bundle link --
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  bundle := public.create_voucher_share_bundle(array[v1, v2, v3]);

  select count(*) into n from public.voucher_shares where bundle_token = bundle;
  insert into bundle_results (name, passed, detail)
  values ('B1 the owner can mint one link covering several vouchers',
          bundle is not null and n = 3, format('rows=%s', n));

  -- ------------------------ SECURITY: all-or-nothing over the whole set -----
  ok := false; txt := null;
  begin
    perform public.create_voucher_share_bundle(array[v1, foreign_v]);
  exception when others then ok := true; txt := sqlerrm;
  end;

  select count(*) into n from public.voucher_shares where voucher_id = foreign_v;
  insert into bundle_results (name, passed, detail)
  values ('B2 SECURITY a set holding a voucher you do not own is rejected outright',
          ok and n = 0, format('%s; foreign_share_rows=%s', coalesce(txt, 'no exception'), n));

  -- Duplicates in the request must not become duplicate share rows. Minted
  -- into a variable first: a volatile function in a WHERE clause would be
  -- re-evaluated per row.
  bundle2 := public.create_voucher_share_bundle(array[v1, v1, v2]);
  select count(*) into n from public.voucher_shares where bundle_token = bundle2;
  insert into bundle_results (name, passed, detail)
  values ('B3 repeated ids collapse to one row each', n = 2, format('rows=%s', n));

  ok := false; txt := null;
  begin
    perform public.create_voucher_share_bundle(array[]::uuid[]);
  exception when others then ok := true; txt := sqlerrm;
  end;
  insert into bundle_results (name, passed, detail)
  values ('B4 an empty set is rejected', ok, coalesce(txt, 'no exception'));

  -- ------------------------------------------------- claiming the bundle ----
  -- B already holds v3 through an ordinary single-voucher link, so the bundle
  -- claim has to report a mixed outcome.
  single := public.create_voucher_share(v3);
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  perform public.claim_voucher_share(single);

  select count(*) filter (where outcome = 'joined'),
         count(*) filter (where outcome = 'already_member'),
         count(*) filter (where outcome = 'own_voucher')
    into joined, already, own
  from public.claim_voucher_share_bundle(bundle);

  insert into bundle_results (name, passed, detail)
  values ('B5 one claim joins every voucher, and says which were already held',
          joined = 2 and already = 1 and own = 0
            and public.can_access_voucher(v1)
            and public.can_access_voucher(v2),
          format('joined=%s already=%s own=%s', joined, already, own));

  select count(*) into n from public.vouchers where user_id = b;
  insert into bundle_results (name, passed, detail)
  values ('B6 claiming joins the shared rows rather than copying them',
          n = 0, format('own_rows=%s', n));

  select count(*) filter (where outcome = 'joined'),
         count(*) filter (where outcome = 'already_member')
    into joined, already
  from public.claim_voucher_share_bundle(bundle);

  insert into bundle_results (name, passed, detail)
  values ('B7 claiming the same bundle twice is idempotent',
          joined = 0 and already = 3, format('joined=%s already=%s', joined, already));

  select count(*) into n
  from public.voucher_members
  where user_id = b and voucher_id in (v1, v2, v3);
  insert into bundle_results (name, passed, detail)
  values ('B8 no duplicate memberships were created', n = 3, format('memberships=%s', n));

  -- The owner opening their own link is told so, and gains no membership.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  select count(*) filter (where outcome = 'own_voucher') into own
  from public.claim_voucher_share_bundle(bundle);
  select count(*) into n from public.voucher_members where user_id = a;

  insert into bundle_results (name, passed, detail)
  values ('B9 the owner opening their own bundle joins nothing',
          own = 3 and n = 0, format('own=%s memberships=%s', own, n));

  -- ------------------------------------------------ SECURITY: expiry --------
  dead := gen_random_uuid();
  insert into public.voucher_shares (voucher_id, created_by, bundle_token, expires_at)
  values (v1, a, dead, now() - interval '1 day'),
         (v2, a, dead, now() - interval '1 day');

  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  ok := false; txt := null;
  begin
    perform public.claim_voucher_share_bundle(dead);
  exception when others then ok := true; txt := sqlerrm;
  end;
  insert into bundle_results (name, passed, detail)
  values ('B10 SECURITY an expired bundle link is rejected', ok,
          coalesce(txt, 'no exception raised'));

  insert into bundle_results (name, passed, detail)
  values ('B11 SECURITY the expired link granted nothing',
          not public.can_access_voucher(v1),
          format('can_access=%s', public.can_access_voucher(v1)));

  -- ----------------------------- revocation reaches bundles too -------------
  -- Removing B from v1 deletes v1 share rows, so v1 drops out of the bundle.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  perform public.remove_voucher_member(v1, b);

  select count(*) into n from public.voucher_shares where bundle_token = bundle;
  insert into bundle_results (name, passed, detail)
  values ('B12 SECURITY removing a member strips that voucher from the bundle link',
          n = 2, format('remaining_rows=%s', n));

  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  select count(*) into n from public.claim_voucher_share_bundle(bundle);
  insert into bundle_results (name, passed, detail)
  values ('B13 a stranger claiming the trimmed link gets only what is left',
          n = 2 and not public.can_access_voucher(v1),
          format('rows=%s can_access_removed=%s', n, public.can_access_voucher(v1)));

  -- A deleted voucher cascades out of the bundle; an empty bundle is dead.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  delete from public.vouchers where id in (v2, v3);

  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  ok := false; txt := null;
  begin
    perform public.claim_voucher_share_bundle(bundle);
  exception when others then ok := true; txt := sqlerrm;
  end;
  insert into bundle_results (name, passed, detail)
  values ('B14 a bundle whose vouchers are all gone is a dead link', ok,
          coalesce(txt, 'no exception raised'));

  -- ------------------------------------------------------------- cleanup ----
  perform set_config('request.jwt.claims', '', false);
  delete from public.vouchers where id in (v1, foreign_v);
  delete from auth.users where id in (a, b, c);

  select count(*) into n from public.vouchers;
  insert into bundle_results (name, passed, detail)
  values ('B15 cleanup left pre-existing data untouched', n = before_count,
          format('before=%s after=%s', before_count, n));
exception when others then
  perform set_config('request.jwt.claims', '', false);
  delete from public.vouchers where user_id in (a, b, c);
  delete from auth.users where id in (a, b, c);
  insert into bundle_results (name, passed, detail)
  values ('FATAL: bundle test run aborted', false, sqlerrm);
end;
$$;

select
  case when passed then 'PASS' else 'FAIL' end as result,
  name,
  detail
from bundle_results
order by seq;
