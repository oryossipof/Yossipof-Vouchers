-- Share the whole voucher, not just its status.
--
-- Until now a share produced a *copy* per account, and only status propagated.
-- Editing the store name, amount, note, or photo changed only your own copy.
-- This replaces the copy model with a single shared row plus a membership
-- table, so every field is shared by construction: there is only one row to
-- edit, and everyone who can see the voucher sees the same values.
--
-- Ownership still matters for two things: only the owner can hand out share
-- links, and only the owner can delete the voucher. A member who no longer
-- wants it leaves the share instead, via leave_voucher_share.

-- 1. Membership --------------------------------------------------------------
create table if not exists public.voucher_members (
  voucher_id uuid not null references public.vouchers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (voucher_id, user_id)
);

alter table public.voucher_members enable row level security;

create index if not exists voucher_members_user_idx on public.voucher_members (user_id);

-- Security definer so the vouchers policies can consult membership without the
-- two tables' policies recursing into one another.
create or replace function public.can_access_voucher(p_voucher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.vouchers v
    where v.id = p_voucher_id and v.user_id = auth.uid()
  ) or exists (
    select 1 from public.voucher_members m
    where m.voucher_id = p_voucher_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_voucher_owner(p_voucher_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.vouchers v
    where v.id = p_voucher_id and v.user_id = auth.uid()
  );
$$;

-- 2. Fold the existing copies into the new model -----------------------------
-- The originator's row becomes the single shared voucher; everyone else who
-- held a copy becomes a member; the duplicate rows go away. Any field the
-- originator left empty is taken from a copy first, so nothing is lost.
drop table if exists canonical_vouchers;

create temp table canonical_vouchers as
select distinct on (share_group_id)
       id, share_group_id, user_id
from public.vouchers
where share_group_id is not null
order by share_group_id, (user_id = share_origin) desc nulls last, created_at;

insert into public.voucher_members (voucher_id, user_id)
select c.id, v.user_id
from public.vouchers v
join canonical_vouchers c on c.share_group_id = v.share_group_id
where v.id <> c.id and v.user_id <> c.user_id
on conflict do nothing;

update public.vouchers c
set note = coalesce(c.note, g.note),
    amount = coalesce(c.amount, g.amount),
    photo_path = coalesce(c.photo_path, g.photo_path),
    status = case when g.any_used then 'used' else c.status end,
    used_at = case when g.any_used then coalesce(c.used_at, g.used_at) else c.used_at end
from (
  select share_group_id,
         min(note) filter (where note is not null) as note,
         min(amount) filter (where amount is not null) as amount,
         min(photo_path) filter (where photo_path is not null) as photo_path,
         bool_or(status = 'used') as any_used,
         min(used_at) filter (where used_at is not null) as used_at
    from public.vouchers
   where share_group_id is not null
   group by share_group_id
) g
where c.share_group_id = g.share_group_id
  and c.id in (select id from canonical_vouchers);

-- Keep the pre-merge rows recoverable. Safe to drop once the new model has
-- been exercised: drop table public.vouchers_pre_0006_backup;
create table if not exists public.vouchers_pre_0006_backup as
select * from public.vouchers where share_group_id is not null;

alter table public.vouchers_pre_0006_backup enable row level security;

delete from public.vouchers v
using canonical_vouchers c
where v.share_group_id = c.share_group_id and v.id <> c.id;

drop table if exists canonical_vouchers;

-- 3. Access rules ------------------------------------------------------------
drop policy if exists "Users can view own vouchers" on public.vouchers;
drop policy if exists "Users can update own vouchers" on public.vouchers;
drop policy if exists "Users can delete own vouchers" on public.vouchers;

create policy "Members can view shared vouchers"
  on public.vouchers for select to authenticated
  using (public.can_access_voucher(id));

-- Any member may edit the shared details; that is the point of the change.
create policy "Members can edit shared vouchers"
  on public.vouchers for update to authenticated
  using (public.can_access_voucher(id))
  with check (public.can_access_voucher(id));

-- Deleting the voucher removes it for everyone, so it stays with the owner.
create policy "Owners can delete vouchers"
  on public.vouchers for delete to authenticated
  using (auth.uid() = user_id);

create policy "Members can see their own membership"
  on public.voucher_members for select to authenticated
  using (user_id = auth.uid() or public.is_voucher_owner(voucher_id));

-- 4. Share links now point at the voucher itself -----------------------------
alter table public.voucher_shares drop column if exists share_group_id;

create or replace function public.create_voucher_share(p_voucher_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
begin
  if not public.is_voucher_owner(p_voucher_id) then
    raise exception 'Only the owner can share this voucher' using errcode = '42501';
  end if;

  insert into public.voucher_shares (voucher_id, created_by)
  values (p_voucher_id, auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

-- Claiming adds the caller to the voucher instead of copying it, so there is no
-- longer any same-code merge to reason about.
create or replace function public.claim_voucher_share(p_token uuid)
returns table (voucher_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.voucher_shares;
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_share from public.voucher_shares where token = p_token;
  if not found then
    raise exception 'Share link not found' using errcode = 'P0002';
  end if;

  if v_share.expires_at <= now() then
    raise exception 'Share link has expired' using errcode = 'P0002';
  end if;

  select user_id into v_owner from public.vouchers where id = v_share.voucher_id;
  if not found then
    raise exception 'Shared voucher no longer exists' using errcode = 'P0002';
  end if;

  if v_owner = auth.uid() then
    return query select v_share.voucher_id, 'own_voucher'::text;
    return;
  end if;

  -- Aliased: the RETURNS TABLE column `voucher_id` would otherwise be
  -- ambiguous against voucher_members.voucher_id.
  if exists (
    select 1 from public.voucher_members m
    where m.voucher_id = v_share.voucher_id and m.user_id = auth.uid()
  ) then
    return query select v_share.voucher_id, 'already_member'::text;
    return;
  end if;

  insert into public.voucher_members (voucher_id, user_id)
  values (v_share.voucher_id, auth.uid());

  return query select v_share.voucher_id, 'joined'::text;
end;
$$;

drop function if exists public.link_voucher_to_share(uuid, uuid);

-- 5. Status is one row now, but still not client-writable --------------------
create or replace function public.set_voucher_status(p_voucher_id uuid, p_status text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('active', 'used') then
    raise exception 'Invalid status: %', p_status using errcode = '22023';
  end if;

  if not public.can_access_voucher(p_voucher_id) then
    raise exception 'Voucher not found' using errcode = 'P0002';
  end if;

  update public.vouchers
  set status = p_status,
      used_at = case when p_status = 'used' then now() else null end
  where id = p_voucher_id;

  return 1;
end;
$$;

-- 6. Leaving a share ---------------------------------------------------------
create or replace function public.leave_voucher_share(p_voucher_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from public.voucher_members
  where voucher_id = p_voucher_id and user_id = auth.uid();

  return found;
end;
$$;

-- 7. How many accounts hold each voucher -------------------------------------
create or replace function public.voucher_share_counts()
returns table (voucher_id uuid, member_count integer)
language sql
security definer
stable
set search_path = public
as $$
  select m.voucher_id, count(*)::integer
  from public.voucher_members m
  where public.can_access_voucher(m.voucher_id)
  group by m.voucher_id;
$$;

-- 8. Shared photos -----------------------------------------------------------
-- The object key still lives under the uploader's own folder, so upload and
-- delete stay owner-of-the-file operations. Read access instead follows the
-- voucher: if you can see the voucher, you can see its photo.
create or replace function public.photo_is_accessible(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.vouchers v
    where v.photo_path = p_name and public.can_access_voucher(v.id)
  );
$$;

drop policy if exists "Members can read shared voucher photos" on storage.objects;

create policy "Members can read shared voucher photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'voucher-photos' and public.photo_is_accessible(name));

-- 9. Retire the copy-model columns -------------------------------------------
drop index if exists public.vouchers_share_group_idx;
alter table public.vouchers drop column if exists share_group_id;
alter table public.vouchers drop column if exists share_origin;

-- 10. Grants -----------------------------------------------------------------
revoke all on function public.can_access_voucher(uuid) from public, anon;
revoke all on function public.is_voucher_owner(uuid) from public, anon;
revoke all on function public.photo_is_accessible(text) from public, anon;
revoke all on function public.create_voucher_share(uuid) from public, anon;
revoke all on function public.claim_voucher_share(uuid) from public, anon;
revoke all on function public.set_voucher_status(uuid, text) from public, anon;
revoke all on function public.leave_voucher_share(uuid) from public, anon;
revoke all on function public.voucher_share_counts() from public, anon;

grant execute on function public.can_access_voucher(uuid) to authenticated;
grant execute on function public.is_voucher_owner(uuid) to authenticated;
grant execute on function public.photo_is_accessible(text) to authenticated;
grant execute on function public.create_voucher_share(uuid) to authenticated;
grant execute on function public.claim_voucher_share(uuid) to authenticated;
grant execute on function public.set_voucher_status(uuid, text) to authenticated;
grant execute on function public.leave_voucher_share(uuid) to authenticated;
grant execute on function public.voucher_share_counts() to authenticated;

grant select on public.voucher_members to authenticated;
