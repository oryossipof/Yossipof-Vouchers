-- Fix: adding a voucher has been failing since 0006.
--
-- The client inserts with `.insert(...).select().single()`, which PostgREST
-- sends as INSERT ... RETURNING. Postgres applies the *SELECT* policy to the
-- returned row, and that policy was `can_access_voucher(id)` — a STABLE
-- security definer function whose body queries public.vouchers. A subquery
-- cannot see the row the current command is inserting, so it answered false
-- for the row that had just been created, and the whole insert came back as
--
--   42501  new row violates row-level security policy for table "vouchers"
--
-- The insert itself was always allowed; only the RETURNING half failed. That
-- is why a plain insert with no representation requested worked, and why the
-- SQL test suites never caught it: they run inside DO blocks as the table
-- owner, where row-level security is bypassed altogether.
--
-- The fix is to stop asking the table about a row the policy is already
-- holding. Ownership and the account link are both decided by the row's own
-- user_id column, which is available directly in the policy expression — no
-- self-query, no snapshot problem, and less work per row. Only the
-- shared-with-you case needs a lookup, and that one always concerns a row that
-- already exists.

drop policy if exists "Members can view shared vouchers" on public.vouchers;

create policy "Members can view shared vouchers"
  on public.vouchers for select to authenticated
  using (
    -- Your own row, decided from the row itself: this is the term that makes
    -- INSERT ... RETURNING work.
    user_id = auth.uid()
    -- A linked account's row, likewise decided from the row's own column.
    or public.are_accounts_linked(user_id)
    -- Shared with you one by one. Always an existing row, so the lookup is safe.
    or public.can_access_voucher(id)
  );
