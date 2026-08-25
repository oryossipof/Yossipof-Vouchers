-- Voucher expiry dates.
--
-- Until now the only place an expiry date could go was the free-text note --
-- the field's own placeholder suggests "תקף עד סוף השנה". That is unreadable
-- to the app: it cannot tell a live voucher from a dead one, and it cannot
-- warn anyone that one is about to lapse. This adds the date as a real column.
--
-- `date`, not `timestamptz`: a coupon expires on a calendar day, not at an
-- instant. A timestamp would make "expires today" depend on the server's
-- offset from Israel and answer wrongly either side of midnight.

alter table public.vouchers add column if not exists expires_at date;

comment on column public.vouchers.expires_at is
  'The last day the voucher is valid, in the local calendar. Null means it does not expire.';

-- The daily reminder job scans for vouchers a fixed number of days out, and
-- only unspent ones can expire, so both predicates belong in the index.
create index if not exists vouchers_expiry_due_idx
  on public.vouchers (expires_at)
  where expires_at is not null and status = 'active';

-- 0004 revoked table-level insert/update on this table and granted the safe
-- columns back one at a time, so a new column is NOT writable by default.
-- Without these two grants every add and edit fails with
-- "permission denied for column expires_at" -- and since every RLS policy
-- still passes, it reads as an RLS bug rather than a grant bug.
grant insert (expires_at) on public.vouchers to authenticated;
grant update (expires_at) on public.vouchers to authenticated;
