-- Integration test for the expiry reminders (migrations 0014-0015).
--
-- Same harness as the other suites: throwaway auth users, acted as by setting
-- the request.jwt.claims GUC that auth.uid() reads, cleaned up at the end.
--
-- Two things are being asserted here. First, that a reminder reaches everyone
-- who holds the voucher -- the owner, an account linked to the owner, and an
-- account the voucher was shared with one by one -- because a voucher only one
-- of them hears about is a voucher the other two watch expire. Second, that a
-- reminder goes out exactly once: the cron job can fire twice and the function
-- can be retried, so the claim has to be idempotent by construction.

create temp table if not exists expiry_results (
  seq serial,
  name text,
  passed boolean,
  detail text
);
truncate expiry_results;

do $$
declare
  owner_id  uuid := gen_random_uuid();
  linked_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  stranger  uuid := gen_random_uuid();
  instance  uuid := '00000000-0000-0000-0000-000000000000';
  today     date := date '2026-06-15';
  v_soon    uuid;   -- 7 days out: the shared one
  v_today   uuid;   -- expires today
  v_far     uuid;   -- outside every milestone
  v_none    uuid;   -- no expiry date at all
  v_used    uuid;   -- already redeemed
  v_gone    uuid;   -- already expired
  tok       uuid;
  payload   jsonb;
  recipients uuid[];
  before_vouchers integer;
  before_notices  integer;
  n integer;
  ok boolean;
  txt text;
begin
  select count(*) into before_vouchers from public.vouchers;
  select count(*) into before_notices  from public.voucher_expiry_notices;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  select u.id, instance, 'authenticated', 'authenticated',
         'expiry-test-' || u.id || '@example.test', 'x', now(), now(), now(),
         '{}'::jsonb, '{}'::jsonb
  from (values (owner_id), (linked_id), (member_id), (stranger)) as u(id);

  -- ------------------------------------------------------------- fixtures --
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, false);

  insert into public.vouchers (user_id, store_name, code, expires_at)
  values (owner_id, 'Expiry Soon', 'EXP-SOON', today + 7) returning id into v_soon;

  insert into public.vouchers (user_id, store_name, code, expires_at)
  values (owner_id, 'Expiry Today', 'EXP-TODAY', today) returning id into v_today;

  insert into public.vouchers (user_id, store_name, code, expires_at)
  values (owner_id, 'Expiry Far', 'EXP-FAR', today + 30) returning id into v_far;

  insert into public.vouchers (user_id, store_name, code)
  values (owner_id, 'Expiry None', 'EXP-NONE') returning id into v_none;

  insert into public.vouchers (user_id, store_name, code, expires_at)
  values (owner_id, 'Expiry Used', 'EXP-USED', today + 1) returning id into v_used;
  perform public.set_voucher_status(v_used, 'used');

  insert into public.vouchers (user_id, store_name, code, expires_at)
  values (owner_id, 'Expiry Gone', 'EXP-GONE', today - 1) returning id into v_gone;

  -- The linked account holds everything the owner owns.
  insert into public.account_links (user_a, user_b)
  values (least(owner_id, linked_id), greatest(owner_id, linked_id));

  -- The member holds only the one voucher shared with them.
  tok := public.create_voucher_share(v_soon);
  perform set_config('request.jwt.claims', json_build_object('sub', member_id)::text, false);
  perform public.claim_voucher_share(tok);

  -- ------------------------------------------------ which vouchers are due --
  payload := public.claim_expiry_notifications(today, interval '10 minutes', false);

  select count(*) into n
    from jsonb_array_elements(payload) r,
         jsonb_array_elements(r -> 'items') i
   where (i ->> 'voucher_id')::uuid = v_far;
  insert into expiry_results (name, passed, detail)
  values ('a voucher outside the milestones is not due', n = 0, 'rows: ' || n);

  select count(*) into n
    from jsonb_array_elements(payload) r,
         jsonb_array_elements(r -> 'items') i
   where (i ->> 'voucher_id')::uuid in (v_none, v_used, v_gone);
  insert into expiry_results (name, passed, detail)
  values ('no-date, used and already-expired vouchers are not due', n = 0, 'rows: ' || n);

  select count(distinct i ->> 'milestone') into n
    from jsonb_array_elements(payload) r,
         jsonb_array_elements(r -> 'items') i
   where (i ->> 'voucher_id')::uuid = v_today;
  insert into expiry_results (name, passed, detail)
  values ('a voucher expiring today is due at milestone 0',
          n = 1 and exists (
            select 1 from jsonb_array_elements(payload) r,
                          jsonb_array_elements(r -> 'items') i
             where (i ->> 'voucher_id')::uuid = v_today and (i ->> 'milestone')::int = 0),
          'distinct milestones: ' || n);

  -- ------------------------------------------------------ who is notified --
  select array_agg(distinct (r ->> 'user_id')::uuid) into recipients
    from jsonb_array_elements(payload) r,
         jsonb_array_elements(r -> 'items') i
   where (i ->> 'voucher_id')::uuid = v_soon;

  insert into expiry_results (name, passed, detail)
  values ('the owner is notified', owner_id = any(recipients), 'recipients: ' || array_length(recipients, 1));

  insert into expiry_results (name, passed, detail)
  values ('a linked account is notified', linked_id = any(recipients),
          'linked in list: ' || (linked_id = any(recipients))::text);

  insert into expiry_results (name, passed, detail)
  values ('an account the voucher was shared with is notified', member_id = any(recipients),
          'member in list: ' || (member_id = any(recipients))::text);

  insert into expiry_results (name, passed, detail)
  values ('an unrelated account is not notified', not (stranger = any(recipients)),
          'stranger in list: ' || (stranger = any(recipients))::text);

  -- A linked account holds what the owner OWNS, not what was shared with the
  -- owner -- but here the member's own view must not pull in the linked
  -- account either. The member holds exactly one voucher.
  select count(*) into n
    from jsonb_array_elements(payload) r,
         jsonb_array_elements(r -> 'items') i
   where (r ->> 'user_id')::uuid = member_id;
  insert into expiry_results (name, passed, detail)
  values ('a share member is notified about that voucher only', n = 1, 'items: ' || n);

  -- --------------------------------------------------------- the dry run --
  select count(*) into n from public.voucher_expiry_notices;
  insert into expiry_results (name, passed, detail)
  values ('a preview claims nothing', n = before_notices, 'notices: ' || n);

  -- ------------------------------------------------------------ the claim --
  payload := public.claim_expiry_notifications(today, interval '10 minutes', true);
  select count(*) into n from jsonb_array_elements(payload);
  insert into expiry_results (name, passed, detail)
  values ('the first real run returns the recipients', n = 3, 'groups: ' || n);

  payload := public.claim_expiry_notifications(today, interval '10 minutes', true);
  select count(*) into n from jsonb_array_elements(payload);
  insert into expiry_results (name, passed, detail)
  values ('running again claims nothing -- no duplicate reminders', n = 0, 'groups: ' || n);

  -- ------------------------------------------------------------ the retry --
  -- A claim whose send never completed must come back once it is stale.
  update public.voucher_expiry_notices
     set claimed_at = now() - interval '1 hour'
   where notified_at is null;

  payload := public.claim_expiry_notifications(today, interval '10 minutes', true);
  select count(*) into n from jsonb_array_elements(payload);
  insert into expiry_results (name, passed, detail)
  values ('a stale unsent claim is retried', n > 0, 'groups: ' || n);

  -- Once marked sent it must not come back, however old it is.
  select public.mark_expiry_notifications_sent(
           coalesce((select jsonb_agg(jsonb_build_object(
                       'voucher_id', voucher_id, 'user_id', user_id,
                       'expires_on', expires_on, 'milestone', milestone))
                       from public.voucher_expiry_notices
                      where user_id in (owner_id, linked_id, member_id)), '[]'::jsonb))
    into n;

  payload := public.claim_expiry_notifications(today, interval '10 minutes', true);
  select count(*) into n from jsonb_array_elements(payload);
  insert into expiry_results (name, passed, detail)
  values ('a delivered reminder is never resent', n = 0, 'groups: ' || n);

  -- --------------------------------------------------- editing the date --
  -- Moving the expiry is a new reminder, because expires_on is part of the key.
  update public.vouchers set expires_at = today + 8 where id = v_soon;
  payload := public.claim_expiry_notifications(today + 1, interval '10 minutes', true);
  select count(*) into n
    from jsonb_array_elements(payload) r,
         jsonb_array_elements(r -> 'items') i
   where (i ->> 'voucher_id')::uuid = v_soon;
  insert into expiry_results (name, passed, detail)
  values ('changing the expiry date re-arms the reminder', n > 0, 'items: ' || n);

  -- -------------------------------------------------------- push payload --
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, false);
  perform public.save_push_subscription('https://push.example.test/ep-1', 'p256dh-1', 'auth-1', 'test-agent');

  -- v_soon now expires at today+8, so today+7 puts it one day out: a milestone
  -- that has not been claimed yet, which is what a preview needs to see.
  payload := public.claim_expiry_notifications(today + 7, interval '10 minutes', false);
  select count(*) into n
    from jsonb_array_elements(payload) r,
         jsonb_array_elements(r -> 'subscriptions') s
   where (r ->> 'user_id')::uuid = owner_id
     and s ->> 'endpoint' = 'https://push.example.test/ep-1';
  insert into expiry_results (name, passed, detail)
  values ('a recipient carries their device subscriptions', n = 1, 'subscriptions: ' || n);

  -- A second sign-in on the same device moves the row rather than duplicating.
  perform set_config('request.jwt.claims', json_build_object('sub', linked_id)::text, false);
  perform public.save_push_subscription('https://push.example.test/ep-1', 'p256dh-2', 'auth-2', 'test-agent');
  select count(*) into n from public.push_subscriptions
   where endpoint = 'https://push.example.test/ep-1';
  select user_id = linked_id into ok from public.push_subscriptions
   where endpoint = 'https://push.example.test/ep-1';
  insert into expiry_results (name, passed, detail)
  values ('a shared device follows whoever signed in last', n = 1 and ok,
          'rows: ' || n || ', reassigned: ' || ok::text);

  -- --------------------------------------------------------------- cleanup --
  delete from public.push_subscriptions where endpoint = 'https://push.example.test/ep-1';
  delete from auth.users where id in (owner_id, linked_id, member_id, stranger);

  select count(*) into n from public.vouchers;
  insert into expiry_results (name, passed, detail)
  values ('cleanup leaves the pre-existing vouchers untouched',
          n = before_vouchers, 'before: ' || before_vouchers || ', after: ' || n);

  select count(*) into n from public.voucher_expiry_notices;
  insert into expiry_results (name, passed, detail)
  values ('cleanup leaves no notices behind',
          n = before_notices, 'before: ' || before_notices || ', after: ' || n);

exception when others then
  txt := sqlerrm;
  insert into expiry_results (name, passed, detail) values ('suite raised an error', false, txt);
  -- Clean up even on failure, so a broken run does not leave test users behind.
  begin
    delete from public.push_subscriptions where endpoint = 'https://push.example.test/ep-1';
    delete from auth.users where id in (owner_id, linked_id, member_id, stranger);
  exception when others then null;
  end;
end $$;

select seq,
       case when passed then 'PASS' else 'FAIL' end as result,
       name,
       detail
  from expiry_results
 order by seq;
