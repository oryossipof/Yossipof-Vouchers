-- One link that shares several vouchers at once ("share all").
--
-- Sending N separate /claim/:token links through WhatsApp works, but the
-- recipient then has to open every one of them. A bundle is a single link that
-- adds the whole set in one go.
--
-- A bundle is not a new kind of share: it is still one voucher_shares row per
-- voucher, all stamped with the same bundle_token. That keeps every existing
-- rule intact for free — the 30-day expiry, and remove_voucher_member's
-- deletion of a voucher's share rows, which now also strips that voucher out
-- of any bundle link it appeared in. A deleted voucher likewise disappears
-- from its bundles, because voucher_shares cascades from vouchers.

alter table public.voucher_shares add column if not exists bundle_token uuid;

create index if not exists voucher_shares_bundle_idx
  on public.voucher_shares (bundle_token)
  where bundle_token is not null;

-- 1. Mint a bundle link ------------------------------------------------------
-- Owner-only, exactly like create_voucher_share, and all-or-nothing: if the
-- caller does not own every voucher in the set, nothing is created. So a
-- voucher shared *with* the caller cannot be re-shared in bulk either.
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

  -- A sanity bound, not a product limit: the link is a URL in a chat message,
  -- and a runaway array here would mean a bug on the client.
  if array_length(v_ids, 1) > 200 then
    raise exception 'Too many vouchers in one share link' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_ids) as id
    where not public.is_voucher_owner(id)
  ) then
    raise exception 'Only the owner can share this voucher' using errcode = '42501';
  end if;

  v_bundle := gen_random_uuid();

  insert into public.voucher_shares (voucher_id, created_by, bundle_token)
  select id, auth.uid(), v_bundle from unnest(v_ids) as id;

  return v_bundle;
end;
$$;

-- 2. Claim a bundle link -----------------------------------------------------
-- Returns one row per voucher, using the same outcome vocabulary as
-- claim_voucher_share, so the UI can report a mixed result: some newly joined,
-- some already held, some the caller's own.
create or replace function public.claim_voucher_share_bundle(p_token uuid)
returns table (voucher_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
-- The RETURNS TABLE columns are named after real columns of the tables below;
-- resolve any such reference to the column, as the queries here intend.
#variable_conflict use_column
declare
  v_total integer;
  v_live integer;
  v_prior uuid[];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select count(*) into v_total
  from public.voucher_shares s
  where s.bundle_token = p_token;

  -- Vouchers that were deleted, or whose owner revoked access, have already
  -- taken their share rows with them; an empty bundle is a dead link.
  if v_total = 0 then
    raise exception 'Share link not found' using errcode = 'P0002';
  end if;

  select count(*) into v_live
  from public.voucher_shares s
  where s.bundle_token = p_token and s.expires_at > now();

  if v_live = 0 then
    raise exception 'Share link has expired' using errcode = 'P0002';
  end if;

  -- Which of them the caller already held, read before the insert: afterwards
  -- a membership created a moment ago is indistinguishable from an old one,
  -- since both carry this transaction's now().
  select coalesce(array_agg(m.voucher_id), '{}'::uuid[]) into v_prior
  from public.voucher_members m
  where m.user_id = auth.uid()
    and exists (
      select 1 from public.voucher_shares s
      where s.bundle_token = p_token and s.voucher_id = m.voucher_id
    );

  -- Join everything the caller does not already hold, in one statement so a
  -- bundle claimed twice at once cannot insert a membership twice.
  insert into public.voucher_members (voucher_id, user_id)
  select distinct s.voucher_id, auth.uid()
  from public.voucher_shares s
  join public.vouchers v on v.id = s.voucher_id
  where s.bundle_token = p_token
    and s.expires_at > now()
    and v.user_id <> auth.uid()
  on conflict do nothing;

  return query
  select distinct s.voucher_id,
         case
           when v.user_id = auth.uid() then 'own_voucher'::text
           when s.voucher_id = any (v_prior) then 'already_member'::text
           else 'joined'::text
         end
  from public.voucher_shares s
  join public.vouchers v on v.id = s.voucher_id
  where s.bundle_token = p_token and s.expires_at > now();
end;
$$;

revoke all on function public.create_voucher_share_bundle(uuid[]) from public, anon;
revoke all on function public.claim_voucher_share_bundle(uuid) from public, anon;

grant execute on function public.create_voucher_share_bundle(uuid[]) to authenticated;
grant execute on function public.claim_voucher_share_bundle(uuid) to authenticated;
