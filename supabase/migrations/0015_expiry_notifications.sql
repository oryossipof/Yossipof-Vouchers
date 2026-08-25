-- Expiry reminders: who to notify, and never twice for the same thing.
--
-- Every day at 10:00 Israel time an edge function asks this schema for the
-- reminders that are due. Two properties matter:
--
--   1. A voucher belongs to more than one account. The owner holds it, a linked
--      account holds it as part of a joint collection, and anyone it was shared
--      with holds it too. All of them get the reminder -- whoever is near the
--      store should be the one who can use it.
--
--   2. A reminder must go out exactly once. The cron job can fire twice, the
--      function can be retried, and a send can fail halfway. The claim below
--      makes duplicates impossible without needing locks.

create table if not exists public.voucher_expiry_notices (
  voucher_id  uuid     not null references public.vouchers (id) on delete cascade,
  user_id     uuid     not null references auth.users (id) on delete cascade,
  -- The date the voucher expired *on* is part of the key, so editing a
  -- voucher's date legitimately re-arms its reminders while a repeated run
  -- against the same date cannot.
  expires_on  date     not null,
  -- Days remaining when the reminder fired: 7, 1, or 0.
  milestone   smallint not null check (milestone in (0, 1, 7)),
  claimed_at  timestamptz not null default now(),
  -- Null until the push was actually handed to the push service. Rows that
  -- stay null past the staleness window are retried.
  notified_at timestamptz,
  primary key (voucher_id, user_id, expires_on, milestone)
);

create index if not exists voucher_expiry_notices_pending_idx
  on public.voucher_expiry_notices (claimed_at)
  where notified_at is null;

-- Clients have no business reading or writing this; it is entirely internal to
-- the reminder job, which runs as service_role.
alter table public.voucher_expiry_notices enable row level security;

/**
 * Returns the reminders due today, grouped by recipient, and claims them in
 * the same statement.
 *
 * The claim and the selection are one `insert ... on conflict do nothing ...
 * returning`, which is what makes this safe under concurrency: if two
 * invocations run at once, both attempt the insert and only one of them gets
 * the rows back. No advisory locks, no check-then-act race.
 *
 * `p_today` overrides the date so the milestones can be exercised without
 * editing real vouchers. `p_stale` sweeps up rows claimed by a run that then
 * failed to deliver.
 *
 * `p_claim = false` answers the same question without taking anything: it
 * reports what *would* go out. Without it a dry run at 09:50 would consume the
 * day's reminders and the real 10:00 send would find nothing left to do.
 *
 * `p_user_id` narrows the whole query to one account. It has to be applied
 * here rather than by filtering the result, or asking for one person's
 * reminders would claim everybody else's and then not send them, stranding
 * those until the staleness sweep.
 */
drop function if exists public.claim_expiry_notifications(date, interval);
drop function if exists public.claim_expiry_notifications(date, interval, boolean);

create or replace function public.claim_expiry_notifications(
  p_today date default null,
  p_stale interval default interval '10 minutes',
  p_claim boolean default true,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today  date := coalesce(p_today, (now() at time zone 'Asia/Jerusalem')::date);
  v_result jsonb;
begin
  with due as (
    select v.id as voucher_id,
           v.expires_at,
           (v.expires_at - v_today)::smallint as milestone
      from public.vouchers v
     where v.status = 'active'
       and v.expires_at is not null
       and (v.expires_at - v_today) in (0, 1, 7)
  ),
  holders as (
    -- The owner.
    select d.voucher_id, v.user_id, d.expires_at, d.milestone
      from due d
      join public.vouchers v on v.id = d.voucher_id
    union
    -- Accounts linked to the owner: a link means one joint collection, so the
    -- other side holds this voucher as fully as the owner does.
    select d.voucher_id,
           case when l.user_a = v.user_id then l.user_b else l.user_a end,
           d.expires_at,
           d.milestone
      from due d
      join public.vouchers v      on v.id = d.voucher_id
      join public.account_links l on l.user_a = v.user_id or l.user_b = v.user_id
    union
    -- Accounts the voucher was shared with one by one.
    select d.voucher_id, m.user_id, d.expires_at, d.milestone
      from due d
      join public.voucher_members m on m.voucher_id = d.voucher_id
  ),
  -- Narrowed before anything is taken, so a single-account run leaves every
  -- other account's reminders untouched.
  wanted as (
    select * from holders h
     where p_user_id is null or h.user_id = p_user_id
  ),
  claimed as (
    insert into public.voucher_expiry_notices (voucher_id, user_id, expires_on, milestone)
    select h.voucher_id, h.user_id, h.expires_at, h.milestone
      from wanted h
     where p_claim
    on conflict (voucher_id, user_id, expires_on, milestone) do nothing
    returning voucher_id, user_id, expires_on, milestone
  ),
  -- The dry-run equivalent of `claimed`: the same rows, worked out by looking
  -- rather than by inserting.
  previewed as (
    select h.voucher_id, h.user_id, h.expires_at as expires_on, h.milestone
      from wanted h
     where not p_claim
       and not exists (
             select 1
               from public.voucher_expiry_notices n
              where n.voucher_id = h.voucher_id
                and n.user_id    = h.user_id
                and n.expires_on = h.expires_at
                and n.milestone  = h.milestone
           )
  ),
  todo as (
    select voucher_id, user_id, expires_on, milestone from claimed
    union   -- union, not union all: a row can appear in more than one branch
    select voucher_id, user_id, expires_on, milestone from previewed
    union
    select n.voucher_id, n.user_id, n.expires_on, n.milestone
      from public.voucher_expiry_notices n
     where n.notified_at is null
       and n.claimed_at < now() - p_stale
       and (p_user_id is null or n.user_id = p_user_id)
  )
  select coalesce(jsonb_agg(g.entry), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'user_id', t.user_id,
               'items', jsonb_agg(
                          jsonb_build_object(
                            'voucher_id', t.voucher_id,
                            'store_name', v.store_name,
                            'expires_on', t.expires_on,
                            'milestone',  t.milestone
                          )
                          order by t.milestone, v.store_name
                        ),
               'subscriptions', (
                 select coalesce(
                          jsonb_agg(
                            jsonb_build_object(
                              'endpoint', s.endpoint,
                              'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)
                            )
                          ),
                          '[]'::jsonb
                        )
                   from public.push_subscriptions s
                  where s.user_id = t.user_id
               )
             ) as entry
        from todo t
        join public.vouchers v on v.id = t.voucher_id
       group by t.user_id
    ) g;

  return v_result;
end;
$$;

/**
 * Marks the given claims delivered. Called after the pushes have gone out, so
 * anything that failed mid-flight stays unmarked and is retried by the sweep.
 */
create or replace function public.mark_expiry_notifications_sent(p_keys jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.voucher_expiry_notices n
     set notified_at = now()
    from jsonb_to_recordset(coalesce(p_keys, '[]'::jsonb))
           as k(voucher_id uuid, user_id uuid, expires_on date, milestone smallint)
   where n.voucher_id = k.voucher_id
     and n.user_id    = k.user_id
     and n.expires_on = k.expires_on
     and n.milestone  = k.milestone
     and n.notified_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Neither function is for clients. `authenticated` is revoked explicitly:
-- claim_expiry_notifications is security definer and would otherwise let any
-- signed-in user read every other user's store names and push endpoints.
revoke all on function public.claim_expiry_notifications(date, interval, boolean, uuid) from public, anon, authenticated;
revoke all on function public.mark_expiry_notifications_sent(jsonb) from public, anon, authenticated;

grant execute on function public.claim_expiry_notifications(date, interval, boolean, uuid) to service_role;
grant execute on function public.mark_expiry_notifications_sent(jsonb) to service_role;
