-- Storage hardening for the voucher-photos bucket.
--
-- The upload form sets accept="image/*", but that is a client-side hint and is
-- trivially bypassed by calling the storage API directly. Nothing on the server
-- constrained the type or size of an uploaded object, so any signed-in user
-- could store arbitrary files — including active content such as SVG or HTML,
-- which executes script when opened through a signed URL.

-- 1. Constrain what may be uploaded ------------------------------------------
-- image/svg+xml is deliberately excluded: SVG can carry executable script.
update storage.buckets
set file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/heif'
    ]
where id = 'voucher-photos';

-- 2. Scope the object policies to signed-in users ----------------------------
-- They were created for the `public` role, which includes `anon`. The
-- auth.uid() check already made them fail for anonymous callers, but naming the
-- role keeps the intent explicit and stops anon from being evaluated at all.
drop policy if exists "Users can read own voucher photos" on storage.objects;
drop policy if exists "Users can upload own voucher photos" on storage.objects;
drop policy if exists "Users can update own voucher photos" on storage.objects;
drop policy if exists "Users can delete own voucher photos" on storage.objects;

create policy "Users can read own voucher photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can upload own voucher photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own voucher photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own voucher photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'voucher-photos' and auth.uid()::text = (storage.foldername(name))[1]);
