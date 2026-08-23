-- Integration test for linked accounts (migration 0011).
--
-- Same harness as the other suites: throwaway auth users, acted as by setting
-- the request.jwt.claims GUC that auth.uid() reads, cleaned up at the end.
--
-- The properties that matter most here are the negative ones. A link hands
-- over a whole collection, so it must not travel further than the pair that
-- agreed to it: not to vouchers merely shared *with* a linked account, and not
-- to an account linked to a linked account.

create temp table if not exists link_results (
  seq serial,
  name text,
  passed boolean,
  detail text
);
truncate link_results;

create temp table if not exists link_ctx (k text primary key, v uuid);
truncate link_ctx;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  instance uuid := '00000000-0000-0000-0000-000000000000';
  v_a uuid;
  v_c uuid;
  tok uuid;
  old_tok uuid;
  dead_tok uuid;
  res record;
  before_count integer;
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
  from (values (a), (b), (c), (d)) as u(id);

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  insert into public.vouchers (user_id, store_name, code)
  values (a, 'Link Store A', 'LINK-A') returning id into v_a;

  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  insert into public.vouchers (user_id, store_name, code)
  values (c, 'Link Store C', 'LINK-C') returning id into v_c;

  -- ----------------------------------------------------- minting an invite --
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  old_tok := public.create_account_link_invite();
  tok := public.create_account_link_invite();

  select count(*) into n from public.account_link_invites where created_by = a;
  insert into link_results (name, passed, detail)
  values ('L1 a fresh invite retires the previous one', n = 1 and tok <> old_tok,
          format('live_invites=%s', n));

  -- Opening your own invite links nothing.
  select * into res from public.accept_account_link_invite(tok);
  insert into link_results (name, passed, detail)
  values ('L2 your own invite does nothing', res.outcome = 'own_invite'
            and not public.are_accounts_linked(a),
          format('outcome=%s', res.outcome));

  -- ------------------------------------------------------ accepting a link --
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  select * into res from public.accept_account_link_invite(tok);

  insert into link_results (name, passed, detail)
  values ('L3 accepting links the two accounts',
          res.outcome = 'linked' and res.linked_user = a and public.are_accounts_linked(a),
          format('outcome=%s linked=%s', res.outcome, public.are_accounts_linked(a)));

  insert into link_results (name, passed, detail)
  values ('L4 the retired invite is dead',
          (select count(*) from public.account_link_invites where token = old_tok) = 0,
          format('rows=%s',
            (select count(*) from public.account_link_invites where token = old_tok)));

  ok := false; txt := null;
  begin
    perform public.accept_account_link_invite(tok);
  exception when others then ok := true; txt := sqlerrm;
  end;
  insert into link_results (name, passed, detail)
  values ('L5 an invite is single use', ok, coalesce(txt, 'no exception'));

  -- --------------------------------- the collection is joint, with no share --
  insert into link_results (name, passed, detail)
  values ('L6 a linked account reaches the other collection with no share at all',
          public.can_access_voucher(v_a) and public.can_manage_voucher(v_a)
            and (select count(*) from public.voucher_members where voucher_id = v_a) = 0,
          format('access=%s manage=%s', public.can_access_voucher(v_a),
                 public.can_manage_voucher(v_a)));

  -- A voucher added later needs no extra step either.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  insert into public.vouchers (user_id, store_name, code)
  values (a, 'Added After Linking', 'LINK-A2');

  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  insert into link_results (name, passed, detail)
  values ('L7 a voucher added after linking is joint too',
          public.can_manage_voucher(
            (select id from public.vouchers where code = 'LINK-A2')),
          'checked can_manage on the later voucher');

  -- A linked account holds the owner's powers, including handing out links.
  ok := true; txt := null;
  begin
    perform public.create_voucher_share(v_a);
  exception when others then ok := false; txt := sqlerrm;
  end;
  insert into link_results (name, passed, detail)
  values ('L8 a linked account can hand out share links', ok, coalesce(txt, 'ok'));

  -- ------------------------- SECURITY: a link does not travel any further ---
  -- C shares one voucher with A. B is linked to A, but that share is C's, not
  -- A's, so it must not reach B.
  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  dead_tok := public.create_voucher_share(v_c);
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  perform public.claim_voucher_share(dead_tok);

  insert into link_results (name, passed, detail)
  values ('L9 the linked account itself can see the voucher shared with it',
          public.can_access_voucher(v_c), format('access=%s',
          public.can_access_voucher(v_c)));

  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  insert into link_results (name, passed, detail)
  values ('L10 SECURITY a link does not pass on vouchers merely shared with the other account',
          not public.can_access_voucher(v_c),
          format('access=%s', public.can_access_voucher(v_c)));

  -- D links to B. That must not reach A's collection: links are not transitive.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  tok := public.create_account_link_invite();
  perform set_config('request.jwt.claims', json_build_object('sub', d)::text, false);
  perform public.accept_account_link_invite(tok);

  insert into link_results (name, passed, detail)
  values ('L11 SECURITY links are not transitive',
          public.are_accounts_linked(b) and not public.can_access_voucher(v_a),
          format('linked_to_b=%s access_to_a=%s',
                 public.are_accounts_linked(b), public.can_access_voucher(v_a)));

  -- ------------------------------------- SECURITY: expiry and self-removal --
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  insert into public.account_link_invites (created_by, expires_at)
  values (a, now() - interval '1 day') returning token into dead_tok;

  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, false);
  ok := false; txt := null;
  begin
    perform public.accept_account_link_invite(dead_tok);
  exception when others then ok := true; txt := sqlerrm;
  end;
  insert into link_results (name, passed, detail)
  values ('L12 SECURITY an expired invite is rejected', ok, coalesce(txt, 'no exception'));

  insert into link_results (name, passed, detail)
  values ('L13 SECURITY the expired invite linked nothing',
          not public.are_accounts_linked(a), format('linked=%s',
          public.are_accounts_linked(a)));

  -- A linked account may not evict the owner from their own voucher.
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  ok := false; txt := null;
  begin
    perform public.remove_voucher_member(v_a, a);
  exception when others then ok := true; txt := sqlerrm;
  end;
  insert into link_results (name, passed, detail)
  values ('L14 SECURITY a linked account cannot remove the owner', ok,
          coalesce(txt, 'no exception'));

  -- ------------------------------------------------------------- unlinking --
  ok := public.remove_account_link(a);
  insert into link_results (name, passed, detail)
  values ('L15 either side can cut the link',
          ok and not public.are_accounts_linked(a) and not public.can_access_voucher(v_a),
          format('removed=%s access=%s', ok, public.can_access_voucher(v_a)));

  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  insert into link_results (name, passed, detail)
  values ('L16 cutting the link works in both directions',
          not public.are_accounts_linked(b), format('linked=%s',
          public.are_accounts_linked(b)));

  insert into link_results (name, passed, detail)
  values ('L17 the vouchers themselves survive unlinking',
          (select count(*) from public.vouchers where user_id = a) = 2,
          format('rows=%s', (select count(*) from public.vouchers where user_id = a)));

  insert into link_ctx values ('a', a), ('b', b), ('c', c), ('d', d), ('v_a', v_a);
  insert into link_results (name, passed, detail)
  values ('L0 voucher count before the run', true, format('before=%s', before_count));
exception when others then
  perform set_config('request.jwt.claims', '', false);
  delete from auth.users where id in (a, b, c, d);
  insert into link_results (name, passed, detail)
  values ('FATAL: link test run aborted', false, sqlerrm);
end;
$$;

-- The delete policy has to be checked under the real `authenticated` role:
-- inside a plain DO block the table owner bypasses row-level security.
do $$
declare
  v_a uuid;
  b uuid;
  a uuid;
  tok uuid;
  visible integer := -1;
  deleted integer := -1;
  txt text;
begin
  select v into a from link_ctx where k = 'a';
  select v into b from link_ctx where k = 'b';
  select v into v_a from link_ctx where k = 'v_a';
  if v_a is null then return; end if;

  -- Re-link them: the run above finished by cutting the link.
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, false);
  tok := public.create_account_link_invite();
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, false);
  perform public.accept_account_link_invite(tok);

  set local role authenticated;

  select count(*) into visible from public.vouchers where id = v_a;
  delete from public.vouchers where id = v_a;
  get diagnostics deleted = row_count;

  reset role;

  insert into link_results (name, passed, detail)
  values ('L18 RLS lets a linked account see the other collection', visible = 1,
          format('visible=%s', visible));

  insert into link_results (name, passed, detail)
  values ('L19 RLS lets a linked account delete, which removes it for both',
          deleted = 1 and (select count(*) from public.vouchers where id = v_a) = 0,
          format('deleted=%s', deleted));
exception when others then
  reset role;
  insert into link_results (name, passed, detail)
  values ('L18/L19 policy check aborted', false, sqlerrm);
end;
$$;

do $$
declare
  strays integer;
  after_count integer;
  before_detail text;
begin
  delete from auth.users where id in (select v from link_ctx where k in ('a', 'b', 'c', 'd'));
  perform set_config('request.jwt.claims', '', false);

  select count(*) into after_count from public.vouchers;
  select count(*) into strays from auth.users where email like 'voucher-test-%@example.test';
  select detail into before_detail from link_results where name = 'L0 voucher count before the run';

  insert into link_results (name, passed, detail)
  values ('L20 cleanup removed every test user and left real data untouched',
          strays = 0 and format('before=%s', after_count) = before_detail,
          format('%s after=%s stray_test_users=%s',
                 coalesce(before_detail, 'before=?'), after_count, strays));
end;
$$;

select
  case when passed then 'PASS' else 'FAIL' end as result,
  name,
  detail
from link_results
order by seq;
