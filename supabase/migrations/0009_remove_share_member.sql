-- Let the owner remove an account from a shared voucher.
--
-- Removing a member also revokes every outstanding share link for that
-- voucher. Without that the removal would be cosmetic: the removed account
-- almost certainly still holds the link it joined with, and share links stay
-- valid for 30 days, so it could simply rejoin. The owner can issue a fresh
-- link afterwards for anyone who still needs one.

create or replace function public.remove_voucher_member(p_voucher_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed boolean;
begin
  if not public.is_voucher_owner(p_voucher_id) then
    raise exception 'Only the owner can remove people from this voucher'
      using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
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

revoke all on function public.remove_voucher_member(uuid, uuid) from public, anon;
grant execute on function public.remove_voucher_member(uuid, uuid) to authenticated;
