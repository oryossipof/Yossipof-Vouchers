-- Security hardening for the sharing model. Fixes three issues:
--
--   1. Clients could write share_group_id / status / used_at directly, because
--      `authenticated` held table-level INSERT and UPDATE on every column. That
--      made a share group id a bearer credential: anyone who ever learned one
--      could re-join the group at will and flip other people's vouchers,
--      bypassing set_voucher_status and surviving any "unshare".
--   2. Anyone holding a claimed copy could mint further share links for the
--      same group, so the owner could not control who gained write access.
--   3. Claiming a link silently absorbed an unrelated voucher that happened to
--      share a code, overwriting its status and handing the sharer control of
--      it. Merging is now an explicit, separately confirmed action.
--
-- Also adds an expiry to share links.

-- 1. Track who originated a share group --------------------------------------
alter table public.vouchers add column if not exists share_origin uuid
  references auth.users (id) on delete set null;

-- Backfill: the earliest share row for a group identifies its originator.
update public.vouchers v
set share_origin = s.created_by
from (
  select distinct on (share_group_id) share_group_id, created_by
  from public.voucher_shares
  order by share_group_id, created_at
) s
where v.share_group_id = s.share_group_id
  and v.share_origin is null;

-- 2. Share links expire ------------------------------------------------------
alter table public.voucher_shares add column if not exists expires_at timestamptz
  not null default (now() + interval '30 days');

-- 3. Only the group originator may mint share links --------------------------
create or replace function public.create_voucher_share(p_voucher_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_origin uuid;
  v_token uuid;
begin
  select share_group_id, share_origin into v_group, v_origin
  from public.vouchers
  where id = p_voucher_id and user_id = auth.uid();

  if not found then
    raise exception 'Voucher not found' using errcode = 'P0002';
  end if;

  -- A recipient holds a copy, not the right to hand out further access.
  if v_group is not null and v_origin is distinct from auth.uid() then
    raise exception 'Only the person who shared this voucher can share it further'
      using errcode = '42501';
  end if;

  if v_group is null then
    v_group := gen_random_uuid();
    update public.vouchers
    set share_group_id = v_group, share_origin = auth.uid()
    where id = p_voucher_id;
  end if;

  insert into public.voucher_shares (voucher_id, share_group_id, created_by)
  values (p_voucher_id, v_group, auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

-- 4. Claiming never silently absorbs an existing voucher ---------------------
-- Returns an outcome the UI acts on:
--   created           a new copy was added to the caller's account
--   already_in_group  the caller already holds this shared voucher
--   own_voucher       the caller is the sharer
--   code_conflict     the caller already has a voucher with this code; nothing
--                     was changed, and linking requires link_voucher_to_share
drop function if exists public.claim_voucher_share(uuid);

create function public.claim_voucher_share(p_token uuid)
returns table (voucher_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.voucher_shares;
  v_source public.vouchers;
  v_existing public.vouchers;
  v_new_id uuid;
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

  select * into v_source from public.vouchers where id = v_share.voucher_id;
  if not found then
    raise exception 'Shared voucher no longer exists' using errcode = 'P0002';
  end if;

  if v_source.user_id = auth.uid() then
    return query select v_source.id, 'own_voucher'::text;
    return;
  end if;

  -- Already in this group: nothing to do.
  select * into v_existing
  from public.vouchers
  where user_id = auth.uid() and share_group_id = v_share.share_group_id
  limit 1;

  if found then
    return query select v_existing.id, 'already_in_group'::text;
    return;
  end if;

  -- Same code but unrelated: report it, change nothing. Linking the two is the
  -- caller's decision, made explicitly through link_voucher_to_share.
  select * into v_existing
  from public.vouchers
  where user_id = auth.uid()
    and lower(btrim(code)) = lower(btrim(v_source.code))
  limit 1;

  if found then
    return query select v_existing.id, 'code_conflict'::text;
    return;
  end if;

  insert into public.vouchers (
    user_id, store_name, code, amount, note, status, used_at,
    share_group_id, share_origin
  )
  values (
    auth.uid(), v_source.store_name, v_source.code, v_source.amount,
    v_source.note, v_source.status, v_source.used_at,
    v_share.share_group_id, v_source.share_origin
  )
  returning id into v_new_id;

  return query select v_new_id, 'created'::text;
end;
$$;

-- 5. Explicit opt-in merge ---------------------------------------------------
create or replace function public.link_voucher_to_share(p_token uuid, p_voucher_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share public.voucher_shares;
  v_source public.vouchers;
  v_mine public.vouchers;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_mine
  from public.vouchers
  where id = p_voucher_id and user_id = auth.uid();

  if not found then
    raise exception 'Voucher not found' using errcode = 'P0002';
  end if;

  if v_mine.share_group_id is not null then
    raise exception 'That voucher is already shared' using errcode = '42501';
  end if;

  select * into v_share from public.voucher_shares where token = p_token;
  if not found then
    raise exception 'Share link not found' using errcode = 'P0002';
  end if;

  if v_share.expires_at <= now() then
    raise exception 'Share link has expired' using errcode = 'P0002';
  end if;

  select * into v_source from public.vouchers where id = v_share.voucher_id;
  if not found then
    raise exception 'Shared voucher no longer exists' using errcode = 'P0002';
  end if;

  update public.vouchers
  set share_group_id = v_share.share_group_id,
      share_origin = v_source.share_origin,
      status = v_source.status,
      used_at = v_source.used_at
  where id = p_voucher_id;

  return p_voucher_id;
end;
$$;

-- 6. Take away the columns clients must not write themselves -----------------
-- Table-level privileges override column-level ones, so the table grant has to
-- go first and the safe columns be granted back explicitly.
revoke insert, update on public.vouchers from authenticated, anon;

grant insert (user_id, store_name, code, amount, note, photo_path)
  on public.vouchers to authenticated;

grant update (store_name, code, amount, note, photo_path)
  on public.vouchers to authenticated;

-- status, used_at, share_group_id and share_origin are now writable only
-- through the security definer functions above.

-- 7. Function grants ---------------------------------------------------------
revoke all on function public.create_voucher_share(uuid) from public, anon;
revoke all on function public.claim_voucher_share(uuid) from public, anon;
revoke all on function public.link_voucher_to_share(uuid, uuid) from public, anon;
revoke all on function public.set_voucher_status(uuid, text) from public, anon;

grant execute on function public.create_voucher_share(uuid) to authenticated;
grant execute on function public.claim_voucher_share(uuid) to authenticated;
grant execute on function public.link_voucher_to_share(uuid, uuid) to authenticated;
grant execute on function public.set_voucher_status(uuid, text) to authenticated;
