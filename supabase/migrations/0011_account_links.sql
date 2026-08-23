-- Linked accounts: two accounts that keep one joint collection.
--
-- Sharing so far has been per voucher. A couple sharing a wallet had to share
-- every coupon separately, and every new one again. A link is the standing
-- version of that: once two accounts are linked, each sees and manages
-- everything the other owns — adding, editing, marking used, and deleting all
-- apply to both, with no per-voucher step at all.
--
-- The two models compose rather than replace each other. Per-voucher shares
-- still exist for handing a single coupon to someone you are not linked with,
-- and a link never widens *those*: what travels through a link is what the
-- other account owns, not what has merely been shared with it. Otherwise
-- linking with someone would quietly hand you the vouchers of every stranger
-- who ever shared one with them.

-- 1. The link itself ---------------------------------------------------------
-- One row per pair, stored with the ids in a canonical order so a pair cannot
-- be recorded twice in opposite directions.
create table if not exists public.account_links (
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint account_links_ordered check (user_a < user_b)
);

alter table public.account_links enable row level security;

create index if not exists account_links_user_b_idx on public.account_links (user_b);

-- Readable by the two accounts it joins — Realtime needs a select policy to
-- deliver the row, so each side learns immediately when a link is made or cut.
drop policy if exists "Linked accounts can see their link" on public.account_links;
create policy "Linked accounts can see their link"
  on public.account_links for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

-- Invites. Like voucher_shares: RLS on with no policies, so the tokens are
-- reachable only through the security definer functions and cannot be listed.
create table if not exists public.account_link_invites (
  token uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

alter table public.account_link_invites enable row level security;

create index if not exists account_link_invites_creator_idx
  on public.account_link_invites (created_by);

-- 2. Are two accounts linked? ------------------------------------------------
create or replace function public.are_accounts_linked(p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.account_links l
    where (l.user_a = auth.uid() and l.user_b = p_user_id)
       or (l.user_b = auth.uid() and l.user_a = p_user_id)
  );
$$;

-- 3. Access ------------------------------------------------------------------
-- "Manage" is the owner's set of powers: delete the voucher, hand out share
-- links, remove someone from a share. A linked account holds them too, because
-- the whole point of a link is that neither account is a guest in the other's
-- collection.
create or replace function public.can_manage_voucher(p_voucher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.vouchers v
    where v.id = p_voucher_id
      and (v.user_id = auth.uid() or public.are_accounts_linked(v.user_id))
  );
$$;

-- Seeing and editing additionally covers vouchers shared with you one by one.
create or replace function public.can_access_voucher(p_voucher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.can_manage_voucher(p_voucher_id) or exists (
    select 1 from public.voucher_members m
    where m.voucher_id = p_voucher_id and m.user_id = auth.uid()
  );
$$;

-- Deleting removes the voucher for everyone, so it stays with the accounts
-- that own it — which now includes the linked one.
drop policy if exists "Owners can delete vouchers" on public.vouchers;
create policy "Owners and linked accounts can delete vouchers"
  on public.vouchers for delete to authenticated
  using (public.can_manage_voucher(id));

drop policy if exists "Members can see their own membership" on public.voucher_members;
create policy "Members can see their own membership"
  on public.voucher_members for select to authenticated
  using (user_id = auth.uid() or public.can_manage_voucher(voucher_id));

-- 4. The owner-only functions follow the same widening -----------------------
create or replace function public.create_voucher_share(p_voucher_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if not public.can_manage_voucher(p_voucher_id) then
    raise exception 'Only the owner can share this voucher' using errcode = '42501';
  end if;

  insert into public.voucher_shares (voucher_id, created_by)
  values (p_voucher_id, auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.create_voucher_share_bundle(p_voucher_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_bundle uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select array_agg(distinct id) into v_ids
  from unnest(coalesce(p_voucher_ids, '{}'::uuid[])) as id
  where id is not null;

  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'No vouchers to share' using errcode = '22023';
  end if;

  if array_length(v_ids, 1) > 200 then
    raise exception 'Too many vouchers in one share link' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_ids) as id
    where not public.can_manage_voucher(id)
  ) then
    raise exception 'Only the owner can share this voucher' using errcode = '42501';
  end if;

  v_bundle := gen_random_uuid();

  insert into public.voucher_shares (voucher_id, created_by, bundle_token)
  select id, auth.uid(), v_bundle from unnest(v_ids) as id;

  return v_bundle;
end;
$$;

-- The check on who may be removed now names the actual owner, rather than
-- assuming the caller is that owner.
create or replace function public.remove_voucher_member(p_voucher_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_removed boolean;
begin
  if not public.can_manage_voucher(p_voucher_id) then
    raise exception 'Only the owner can remove people from this voucher'
      using errcode = '42501';
  end if;

  select user_id into v_owner from public.vouchers where id = p_voucher_id;

  if p_user_id = v_owner then
    raise exception 'The owner cannot be removed from their own voucher'
      using errcode = '22023';
  end if;

  delete from public.voucher_members m
  where m.voucher_id = p_voucher_id and m.user_id = p_user_id;

  v_removed := found;

  delete from public.voucher_shares s where s.voucher_id = p_voucher_id;

  return v_removed;
end;
$$;

-- 5. Making and breaking a link ----------------------------------------------
-- Minting an invite retires any earlier one from the same account. An invite
-- hands over the whole collection, so only the most recent link should be
-- live: a token pasted into a chat months ago cannot come back to life.
create or replace function public.create_account_link_invite()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from public.account_link_invites where created_by = auth.uid();

  insert into public.account_link_invites (created_by)
  values (auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

create or replace function public.accept_account_link_invite(p_token uuid)
returns table (linked_user uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.account_link_invites;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_invite from public.account_link_invites where token = p_token;
  if not found then
    raise exception 'Account link invite not found' using errcode = 'P0002';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'Account link invite has expired' using errcode = 'P0002';
  end if;

  if v_invite.created_by = auth.uid() then
    return query select v_invite.created_by, 'own_invite'::text;
    return;
  end if;

  if public.are_accounts_linked(v_invite.created_by) then
    return query select v_invite.created_by, 'already_linked'::text;
    return;
  end if;

  insert into public.account_links (user_a, user_b)
  values (least(v_invite.created_by, auth.uid()), greatest(v_invite.created_by, auth.uid()));

  -- Single use: the link is made, so the token has done its job.
  delete from public.account_link_invites where token = p_token;

  return query select v_invite.created_by, 'linked'::text;
end;
$$;

-- Either side can cut the link, without the other's agreement.
create or replace function public.remove_account_link(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from public.account_links l
  where (l.user_a = auth.uid() and l.user_b = p_user_id)
     or (l.user_b = auth.uid() and l.user_a = p_user_id);

  return found;
end;
$$;

-- Who am I linked with? Security definer because reading auth.users needs
-- elevated rights; it only ever discloses the address of an account that
-- agreed to the link.
create or replace function public.linked_accounts()
returns table (user_id uuid, email text, linked_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.email::text, l.created_at
  from public.account_links l
  join auth.users u
    on u.id = case when l.user_a = auth.uid() then l.user_b else l.user_a end
  where l.user_a = auth.uid() or l.user_b = auth.uid();
$$;

-- 6. Live updates ------------------------------------------------------------
-- Both sides should see the joint collection appear (or disappear) at once,
-- without a reload. FULL replica identity for the same reason as the other
-- tables: a DELETE carrying only the key cannot be matched against a
-- subscriber's policy.
alter table public.account_links replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'account_links'
  ) then
    alter publication supabase_realtime add table public.account_links;
  end if;
end;
$$;

-- 7. Grants ------------------------------------------------------------------
revoke all on function public.are_accounts_linked(uuid) from public, anon;
revoke all on function public.can_manage_voucher(uuid) from public, anon;
revoke all on function public.create_account_link_invite() from public, anon;
revoke all on function public.accept_account_link_invite(uuid) from public, anon;
revoke all on function public.remove_account_link(uuid) from public, anon;
revoke all on function public.linked_accounts() from public, anon;

grant execute on function public.are_accounts_linked(uuid) to authenticated;
grant execute on function public.can_manage_voucher(uuid) to authenticated;
grant execute on function public.create_account_link_invite() to authenticated;
grant execute on function public.accept_account_link_invite(uuid) to authenticated;
grant execute on function public.remove_account_link(uuid) to authenticated;
grant execute on function public.linked_accounts() to authenticated;

grant select on public.account_links to authenticated;
