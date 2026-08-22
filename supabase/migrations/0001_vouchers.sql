-- Vouchers table: gift cards, coupons, and similar credits
create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  store_name text not null check (char_length(trim(store_name)) > 0),
  code text not null check (char_length(trim(code)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  photo_path text,
  status text not null default 'active' check (status in ('active', 'used')),
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists vouchers_user_id_idx on public.vouchers (user_id);
create index if not exists vouchers_user_status_idx on public.vouchers (user_id, status);

alter table public.vouchers enable row level security;

create policy "Users can view own vouchers"
  on public.vouchers for select
  using (auth.uid() = user_id);

create policy "Users can insert own vouchers"
  on public.vouchers for insert
  with check (auth.uid() = user_id);

create policy "Users can update own vouchers"
  on public.vouchers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own vouchers"
  on public.vouchers for delete
  using (auth.uid() = user_id);

-- Storage bucket for voucher photos (private; accessed via signed URLs)
insert into storage.buckets (id, name, public)
values ('voucher-photos', 'voucher-photos', false)
on conflict (id) do nothing;

create policy "Users can read own voucher photos"
  on storage.objects for select
  using (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can upload own voucher photos"
  on storage.objects for insert
  with check (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own voucher photos"
  on storage.objects for update
  using (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own voucher photos"
  on storage.objects for delete
  using (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1]);
