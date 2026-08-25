-- Web Push subscriptions, one row per browser profile per device.
--
-- The expiry reminders have to reach a phone whose app is closed, which means
-- Web Push, which means the server needs each device's endpoint and its two
-- encryption keys. This table holds them.
--
-- `endpoint` is the primary key rather than a surrogate id: it is globally
-- unique, it *is* the identity of a device+browser as far as the push service
-- is concerned, and it gives the upsert a natural conflict target. Several
-- devices per user then fall out for free.

create table if not exists public.push_subscriptions (
  endpoint      text primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- The subscription's public key and auth secret, base64url, straight from
  -- PushSubscription.toJSON().keys.
  p256dh        text not null,
  auth          text not null,
  -- Only so a person can tell their own devices apart in the settings list.
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Reading your own devices is all a client ever needs to do directly.
drop policy if exists "Users can see their own devices" on public.push_subscriptions;
create policy "Users can see their own devices"
  on public.push_subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

-- There are deliberately no insert/update/delete policies. Writes go through
-- the two security definer functions below, the same pattern as
-- voucher_members and account_link_invites. The reason is not just consistency:
-- the upsert has to be able to *take over* a row that currently belongs to
-- another user, which a row-level policy cannot express. That case is real --
-- two people signing into the app on the same phone produce the same endpoint,
-- and whoever signed in last is who the reminders are for.

create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if coalesce(btrim(p_endpoint), '') = ''
     or coalesce(btrim(p_p256dh), '') = ''
     or coalesce(btrim(p_auth), '') = '' then
    raise exception 'Invalid push subscription';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (endpoint) do update
    set user_id      = auth.uid(),
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = excluded.user_agent,
        last_seen_at = now();
end;
$$;

-- Called on sign-out and when the user turns reminders off, so the next person
-- to use the device does not inherit the previous account's notifications.
create or replace function public.delete_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from public.push_subscriptions
   where endpoint = p_endpoint
     and user_id = auth.uid();

  return found;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

grant select on public.push_subscriptions to authenticated;
