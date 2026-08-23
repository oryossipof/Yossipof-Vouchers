-- Adds: free-text notes, cross-account sharing of a voucher, and status changes
-- that propagate to every account holding the same shared voucher.

-- 1. Optional note on a voucher --------------------------------------------
alter table public.vouchers add column if not exists note text;

-- 2. Share group: every copy of a shared voucher carries the same group id ---
alter table public.vouchers add column if not exists share_group_id uuid;

create index if not exists vouchers_share_group_idx
  on public.vouchers (share_group_id)
  where share_group_id is not null;

-- Helps the duplicate-code check and the share-claim merge.
create index if not exists vouchers_user_code_idx
  on public.vouchers (user_id, lower(btrim(code)));

-- 3. Share links -------------------------------------------------------------
-- Deliberately has RLS enabled with no policies: the table is reachable only
-- through the security definer functions below, so tokens cannot be enumerated.
create table if not exists public.voucher_shares (
  token uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.vouchers (id) on delete cascade,
  share_group_id uuid not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.voucher_shares enable row level security;

create index if not exists voucher_shares_voucher_idx on public.voucher_shares (voucher_id);

-- 4. Create a share link for a voucher you own -------------------------------
create or replace function public.create_voucher_share(p_voucher_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_token uuid;
begin
  select share_group_id into v_group
  from public.vouchers
  where id = p_voucher_id and user_id = auth.uid();

  if not found then
    raise exception 'Voucher not found' using errcode = 'P0002';
  end if;

  if v_group is null then
    v_group := gen_random_uuid();
    update public.vouchers set share_group_id = v_group where id = p_voucher_id;
  end if;

  insert into public.voucher_shares (voucher_id, share_group_id, created_by)
  values (p_voucher_id, v_group, auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

-- 5. Claim a shared voucher into the caller's account ------------------------
-- If the caller already holds this voucher (same share group, or the same
-- voucher code) the existing row is joined to the share group instead of
-- creating a duplicate, so both accounts stay in sync from then on.
create or replace function public.claim_voucher_share(p_token uuid)
returns table (voucher_id uuid, already_owned boolean)
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

  select * into v_source from public.vouchers where id = v_share.voucher_id;
  if not found then
    raise exception 'Shared voucher no longer exists' using errcode = 'P0002';
  end if;

  if v_source.user_id = auth.uid() then
    return query select v_source.id, true;
    return;
  end if;

  select * into v_existing
  from public.vouchers
  where user_id = auth.uid()
    and (
      share_group_id = v_share.share_group_id
      or lower(btrim(code)) = lower(btrim(v_source.code))
    )
  order by (share_group_id is not distinct from v_share.share_group_id) desc
  limit 1;

  if found then
    if v_existing.share_group_id is distinct from v_share.share_group_id then
      update public.vouchers
      set share_group_id = v_share.share_group_id,
          status = v_source.status,
          used_at = v_source.used_at
      where id = v_existing.id;
    end if;
    return query select v_existing.id, true;
    return;
  end if;

  insert into public.vouchers (
    user_id, store_name, code, amount, note, status, used_at, share_group_id
  )
  values (
    auth.uid(), v_source.store_name, v_source.code, v_source.amount,
    v_source.note, v_source.status, v_source.used_at, v_share.share_group_id
  )
  returning id into v_new_id;

  return query select v_new_id, false;
end;
$$;

-- 6. Set voucher status across every account sharing it ----------------------
create or replace function public.set_voucher_status(p_voucher_id uuid, p_status text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_used_at timestamptz;
  v_count integer;
begin
  if p_status not in ('active', 'used') then
    raise exception 'Invalid status: %', p_status using errcode = '22023';
  end if;

  select share_group_id into v_group
  from public.vouchers
  where id = p_voucher_id and user_id = auth.uid();

  if not found then
    raise exception 'Voucher not found' using errcode = 'P0002';
  end if;

  v_used_at := case when p_status = 'used' then now() else null end;

  if v_group is null then
    update public.vouchers
    set status = p_status, used_at = v_used_at
    where id = p_voucher_id;
  else
    update public.vouchers
    set status = p_status, used_at = v_used_at
    where share_group_id = v_group;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 7. Only signed-in users may call these ------------------------------------
revoke all on function public.create_voucher_share(uuid) from public, anon;
revoke all on function public.claim_voucher_share(uuid) from public, anon;
revoke all on function public.set_voucher_status(uuid, text) from public, anon;

grant execute on function public.create_voucher_share(uuid) to authenticated;
grant execute on function public.claim_voucher_share(uuid) to authenticated;
grant execute on function public.set_voucher_status(uuid, text) to authenticated;
