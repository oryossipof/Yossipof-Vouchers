-- Regression test for the voucher SELECT policy (migration 0012).
--
-- Adding a voucher goes out as INSERT ... RETURNING, so the SELECT policy is
-- applied to the row being created. When that policy asked a STABLE function
-- to look the row up in the table it was being inserted into, the lookup could
-- not see it and every add failed with 42501. Nothing caught it: the other
-- suites do their work inside DO blocks as the table owner, where row-level
-- security is bypassed entirely.
--
-- Everything here therefore runs under the real `authenticated` role. The
-- suite also checks the other direction — that widening the policy did not
-- expose one account's vouchers to an unrelated one.

create temp table if not exists rls_results (
  seq serial,
  name text,
  passed boolean,
  detail text
);
truncate rls_results;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  instance uuid := '00000000-0000-0000-0000-000000000000';
  v_id uuid;
  tok uuid;
  n integer;
  txt text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  select u.id, instance, 'authenticated', 'authenticated',
         'voucher-test-' || u.id || '@example.test', 'x', now(), now(), now(),
         '{}'::jsonb, '{}'::jsonb
  from (values (a), (b), (c)) as u(id);

  -- ------------------------------------------- the add path, as a real user --
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  set local role authenticated;

  begin
    insert into public.vouchers (user_id, store_name, code, amount)
    values (a, 'RLS Insert Test', 'RLS-RETURNING-1', 25)
    returning id into v_id;
  exception when others then
    txt := sqlerrm;
  end;

  reset role;

  insert into rls_results (name, passed, detail)
  values ('R1 a user can add a voucher and read the new row back (INSERT ... RETURNING)',
          v_id is not null, coalesce(txt, 'returned an id'));

  if v_id is null then
    delete from auth.users where id in (a, b, c);
    perform set_config('request.jwt.claims', '', false);
    return;
  end if;

  -- ------------------------------------- a linked account sees it, as a user --
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  tok := public.create_account_link_invite();
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  perform public.accept_account_link_invite(tok);

  set local role authenticated;
  select count(*) into n from public.vouchers where id = v_id;
  reset role;

  insert into rls_results (name, passed, detail)
  values ('R2 a linked account reads it under row-level security', n = 1,
          format('rows=%s', n));

  -- --------------------------- SECURITY: and an unrelated account does not ---
  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  set local role authenticated;
  select count(*) into n from public.vouchers where id = v_id;
  reset role;

  insert into rls_results (name, passed, detail)
  values ('R3 SECURITY an unrelated account still sees nothing', n = 0,
          format('rows=%s', n));

  -- A stranger must not be able to plant a voucher on someone else either.
  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  set local role authenticated;
  txt := null;
  begin
    insert into public.vouchers (user_id, store_name, code)
    values (a, 'Planted', 'RLS-PLANTED-1');
  exception when others then
    txt := sqlerrm;
  end;
  reset role;

  insert into rls_results (name, passed, detail)
  values ('R4 SECURITY you cannot insert a voucher owned by someone else',
          txt is not null, coalesce(txt, 'no exception — the insert was allowed'));

  perform set_config('request.jwt.claims', '', false);
  delete from auth.users where id in (a, b, c);

  select count(*) into n from public.vouchers where code in ('RLS-RETURNING-1', 'RLS-PLANTED-1');
  insert into rls_results (name, passed, detail)
  values ('R5 cleanup removed the test rows', n = 0, format('leftover=%s', n));
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', false);
  delete from auth.users where id in (a, b, c);
  insert into rls_results (name, passed, detail)
  values ('FATAL: insert/returning test aborted', false, sqlerrm);
end;
$$;

select
  case when passed then 'PASS' else 'FAIL' end as result,
  name,
  detail
from rls_results
order by seq;
