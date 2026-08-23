-- Who is a shared voucher shared with?
--
-- voucher_share_counts answers "how many", which is enough for a badge but not
-- enough to tell you *which* account. This returns the participants themselves:
-- the owner plus every member, for each voucher the caller can access.
--
-- Reading auth.users requires elevated rights, so the function is security
-- definer — and it filters on can_access_voucher, so an address is only ever
-- disclosed to someone who already shares that voucher with its holder.
-- The owner row is included only when the voucher actually has members, so an
-- unshared voucher returns nothing at all.

create or replace function public.voucher_share_participants()
returns table (voucher_id uuid, user_id uuid, email text, is_owner boolean)
language sql
security definer
stable
set search_path = public
as $$
  select v.id, v.user_id, u.email::text, true
  from public.vouchers v
  join auth.users u on u.id = v.user_id
  where public.can_access_voucher(v.id)
    and exists (select 1 from public.voucher_members m where m.voucher_id = v.id)

  union all

  select m.voucher_id, m.user_id, u.email::text, false
  from public.voucher_members m
  join auth.users u on u.id = m.user_id
  where public.can_access_voucher(m.voucher_id);
$$;

revoke all on function public.voucher_share_participants() from public, anon;
grant execute on function public.voucher_share_participants() to authenticated;
