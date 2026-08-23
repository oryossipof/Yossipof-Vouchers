-- Live updates for shared vouchers.
--
-- Publishes vouchers and voucher_members so every device holding a voucher is
-- notified when it changes, instead of only finding out on the next reload.
--
-- REPLICA IDENTITY FULL matters here: with the default (primary key only), an
-- UPDATE or DELETE carries just the key, and Realtime cannot evaluate the row
-- against the subscriber's RLS policy — so members would silently receive
-- nothing for vouchers they do not own, which is exactly the case that needs to
-- work. The tables are small, so the extra WAL volume is not a concern.

alter table public.vouchers replica identity full;
alter table public.voucher_members replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'vouchers'
  ) then
    alter publication supabase_realtime add table public.vouchers;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'voucher_members'
  ) then
    alter publication supabase_realtime add table public.voucher_members;
  end if;
end;
$$;
