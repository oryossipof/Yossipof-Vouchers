# Vouchers

A PWA for keeping track of gift cards, coupons, and other vouchers: store a code, store name, and credit amount, optionally attach a photo, and mark vouchers as used or delete them once redeemed.

## Stack

- React + TypeScript + Vite, built as an installable PWA (`vite-plugin-pwa`)
- Tailwind CSS
- Supabase (Postgres, Auth, Storage) for data, authentication, and photo uploads
- Deployed on Netlify

## Features

- Email/password sign up and login (Supabase Auth)
- Add a voucher with store name, code, amount, and an optional photo
- View active vouchers, reveal/hide the code, mark as used, or delete
- View used (redeemed) vouchers separately
- Installable as a PWA with offline caching of the app shell

## Local development

1. Copy `.env.example` to `.env.local` and fill in your Supabase project URL and publishable/anon key.
2. Install dependencies and run the dev server:

   ```
   npm install
   npm run dev
   ```

## Database setup

The SQL in `supabase/migrations/0001_vouchers.sql` creates the `vouchers` table, its row-level security policies, and the private `voucher-photos` storage bucket (with per-user access policies). Run it against your Supabase project via the SQL editor or the Supabase CLI.

## Deployment

The app builds as a static site (`npm run build` → `dist/`) and is configured for Netlify via `netlify.toml` (SPA redirect included). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables on the Netlify site.
