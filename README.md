# Vouchers

A PWA for keeping track of gift cards, coupons, and other vouchers: store a code, store name, and credit amount, optionally attach a photo and a note, share a voucher with someone else, and mark vouchers as used or delete them once redeemed.

## Stack

- React + TypeScript + Vite, built as an installable PWA (`vite-plugin-pwa`)
- Tailwind CSS
- Supabase (Postgres, Auth, Storage) for data, authentication, and photo uploads
- Deployed on Netlify

## Features

- Email/password sign up and login (Supabase Auth), with resend-confirmation and password reset
- Add a voucher with store name, code, amount, an optional note, and an optional photo
- Duplicate-code check: entering a code you already hold shows which voucher it belongs to and blocks the save
- Edit any voucher (pencil icon on the card), including replacing or removing its photo
- View active vouchers, reveal/hide the code, mark as used, or delete
- Confirmation dialog before marking a voucher as used, restoring it, or deleting it
- Share a voucher via WhatsApp: the recipient opens the link and the voucher is added to their account
- Share all of them at once: one link covering every active voucher you own, sent in a single WhatsApp message
- Shared vouchers stay in sync — marking one as used (or restoring it) applies to every account holding it
- View used (redeemed) vouchers separately
- Installable as a PWA with offline caching of the app shell

## How sharing works

A shared voucher is **one row, not a copy per account**. `voucher_members` records who else holds it, and row-level security grants access to the owner plus every member. Because there is only one row, everything is shared by construction: the store name, code, amount, note, photo, and status are the same values for everyone, and an edit by any member is immediately visible to all.

Ownership still governs three things. Only the owner can hand out share links, only the owner can delete the voucher — deleting removes it for everyone — and only the owner can remove someone else's access, via `remove_voucher_member`. A member who no longer wants the voucher calls `leave_voucher_share` instead, which drops their own membership and leaves the voucher untouched for everyone else.

Removing a member also **revokes every outstanding share link for that voucher**. Without that the removal would be cosmetic: the removed account almost certainly still holds the link it joined with, and links stay valid for 30 days, so it could simply rejoin. The owner can issue a fresh link afterwards for anyone who still needs one.

The card shows who holds a shared voucher behind an `i` button. It opens a panel on tap rather than relying on hover, which does not exist on a phone, and carries the same list in a `title` attribute so desktop hover still works. The owner gets a remove control next to each member there. Addresses come from `voucher_share_participants`, which is security definer (reading `auth.users` needs elevated rights) and filters on `can_access_voucher`, so an address is only ever disclosed to someone who already shares that voucher.

Photos live under the uploader's own folder in the private bucket, so uploading and deleting a file remain operations on your own storage. Read access instead follows the voucher: `photo_is_accessible` grants a signed URL to anyone who can see the voucher the photo belongs to.

### The flow

`create_voucher_share` returns a one-off token, which the owner sends through WhatsApp as `/claim/:token`. When the recipient opens it while signed in, `claim_voucher_share` adds them to `voucher_members` — it does not copy anything. Status changes go through `set_voucher_status` because `status` is not client-writable, and the functions are `security definer` so they can act on the single shared row.

### Sharing everything at once

`create_voucher_share_bundle` takes a set of voucher ids and returns one token covering all of them, sent as `/claim-all/:token`; `claim_voucher_share_bundle` joins the recipient to every voucher in it and reports each one as joined, already held, or their own, so a partly overlapping bundle still explains itself.

A bundle is not a second kind of share: it is still one `voucher_shares` row per voucher, all stamped with the same `bundle_token`. Every existing rule therefore continues to apply unchanged — the 30-day expiry, and the revocation in `remove_voucher_member`, which deletes that voucher's share rows and so also strips that voucher out of any bundle link it appeared in. A deleted voucher likewise drops out, because `voucher_shares` cascades from `vouchers`. Minting is owner-only and all-or-nothing: if the caller does not own every voucher in the set, nothing is created, so a voucher shared *with* you cannot be re-shared in bulk either.

On the dashboard the button shares whatever the list is currently showing, so the store-name search doubles as a way to send just part of the collection.

Migrations `0003`–`0005` built an earlier model in which a share produced one copy per account and only status propagated; `0006` replaced it, folding existing copies into the shared row and preserving any field the originator had left empty. Rows removed by that merge are kept in `public.vouchers_pre_0006_backup`, which can be dropped once the new model has been exercised.

### Security model

`0004_harden_sharing.sql` establishes the rules that make sharing safe:

- **Clients cannot write `status` or `used_at`.** The `authenticated` role holds column-level INSERT/UPDATE on the editable fields only; status moves exclusively through `set_voucher_status`. Under the old copy model this also covered `share_group_id`, without which a group id would have been a permanent bearer credential — anyone who ever learned one could re-join the group and flip other people's vouchers. `0006` removed that column entirely; membership is now an explicit table that clients cannot insert into.
- **Only the owner may hand out share links**, and only the owner may delete. Being a member lets you edit and use the voucher, not widen access to it or destroy it for everyone else.
- **Share links expire after 30 days**, and `voucher_shares` has RLS enabled with no policies, so tokens are reachable only through the functions and cannot be enumerated.
- **Membership is not self-serve.** `voucher_members` grants `select` only; rows are created solely by `claim_voucher_share` against a valid unexpired token, and removed by `leave_voucher_share` for yourself.

`0005_storage_hardening.sql` covers uploads: the `voucher-photos` bucket enforces a 5 MB limit and an image-only MIME allowlist server-side (the form's `accept="image/*"` is only a hint and is bypassable). `image/svg+xml` is deliberately excluded, since SVG can carry executable script that would run when the file is opened through a signed URL. The object policies are scoped to the `authenticated` role, and the upload path sanitises the file extension so a crafted filename cannot steer the storage key.

Auth is configured with a minimum password length of 8 (matched by the signup form's own validation) and email confirmation required.

**Known gap:** leaked-password protection (HaveIBeenPwned checks on new passwords) is **not enabled**, because Supabase gates it behind a Pro plan and this project is on Free. The security advisor will keep reporting `auth_leaked_password_protection` as a WARN until the project is upgraded, at which point it can be turned on in Authentication → Policies with no code change. Enabling CAPTCHA on auth endpoints is also still open; it needs an hCaptcha or Turnstile secret.

Supabase's security advisor reports four `SECURITY DEFINER` functions callable by `authenticated`. That is intended: controlled privilege elevation is what makes cross-account sync possible, each function verifies `auth.uid()` ownership before doing anything, and all of them pin `search_path`. The `rls_enabled_no_policy` notice on `voucher_shares` is likewise deliberate deny-all.

## Local development

1. Copy `.env.example` to `.env.local` and fill in your Supabase project URL and publishable/anon key.
2. Install dependencies and run the dev server:

   ```
   npm install
   npm run dev
   ```

## Database setup

Run the SQL in `supabase/migrations/` against your Supabase project, in order, via the SQL editor or the Supabase CLI:

- `0001_vouchers.sql` — the `vouchers` table, its row-level security policies, and the private `voucher-photos` storage bucket (with per-user access policies)
- `0002_optional_amount.sql` — makes `amount` nullable
- `0003_notes_sharing_status_sync.sql` — adds the `note` column, the `share_group_id` column, the `voucher_shares` table, and the `create_voucher_share` / `claim_voucher_share` / `set_voucher_status` functions
- `0004`–`0009` — sharing hardening, storage hardening, the shared-row model, Realtime, the participant list, and member removal
- `0010_share_all_vouchers.sql` — adds `voucher_shares.bundle_token` and the `create_voucher_share_bundle` / `claim_voucher_share_bundle` functions behind "share all"

## Live updates

`0007` publishes `vouchers` and `voucher_members` to Supabase Realtime, so a change made on one device appears on the others without a reload — marking a voucher used, editing its details, joining or leaving a share.

Both tables are set to `REPLICA IDENTITY FULL`. With the default (primary key only), an UPDATE or DELETE carries just the key, and Realtime cannot evaluate the row against the subscriber's RLS policy — members would silently receive nothing for vouchers they do not own, which is precisely the case that needs to work.

The client refetches the visible set on any event rather than patching the changed row in place. That is deliberate: for deletes and for membership changes the payload alone does not say what the user should now be able to see. Events are debounced by 150 ms so a burst causes one refetch, and the refresh runs without the loading state so the list does not flicker while being read.

Realtime can miss events while a phone is asleep or offline, and this is an installable PWA, so the app also re-syncs on `visibilitychange` and `online`.

## Account

`/account` shows the signed-in address and lets the user change their password. The current password is verified with `signInWithPassword` before `updateUser` is called: Supabase would accept the change on the strength of the session alone, so without that step anyone reaching an unlocked device could take over the account without knowing the existing password.

## Account recovery

Two flows sit outside the protected routes:

- **Resend confirmation** — a standalone `/resend-confirmation` page needing only an email address, linked from both login and forgot-password. It is also offered contextually: on the signup screen right after registering, and on the login screen when sign-in fails specifically because the address was never verified. All three call `supabase.auth.resend({ type: 'signup' })`.

  The standalone page matters because the contextual one on login is unreachable for some users: Supabase only returns "Email not confirmed" when the password is correct, so an unverified user who also mistypes their password sees "Invalid login credentials" and never sees the resend button.

  It reports the same neutral message whether or not the address is registered or already confirmed, so it cannot be used to probe account state — but rate-limit errors are shown verbatim, since the user needs to know to wait. A 60-second client-side cooldown discourages burning the project's small email quota.
- **Password reset** — `/forgot-password` sends a link via `resetPasswordForEmail`, and `/reset-password` consumes it. The confirmation page reports the same neutral message whether or not an account exists, so it cannot be used to enumerate registered addresses.

`verifyRecoveryLink` in `AuthContext` handles both link shapes Supabase can produce: a `token_hash` in the query string (PKCE), which it exchanges with `verifyOtp`, and tokens in the URL fragment (implicit), which the client exchanges on its own. Reset links are valid for one hour (`mailer_otp_exp`).

Redirect targets must appear in the project's allowed redirect URLs. The list currently holds `https://yossipof-vouchers.netlify.app/**` and `http://localhost:5183/**` — which is why `vite.config.ts` pins the dev server to port 5183. On a different port, reset links will be rejected.

> **Before real users rely on this:** the project uses Supabase's built-in email service, which is rate limited to **2 emails per hour** for the whole project and is documented as being for testing only. Resend and password reset will hit that ceiling almost immediately. Configure custom SMTP under Authentication → Emails before depending on either flow.

## Tests

Unit tests cover the duplicate-code rules in `src/lib/vouchers.ts` (case- and
whitespace-insensitive matching, excluding the voucher being edited, matching
used vouchers as well as active ones):

```
npm test
```

`supabase/tests/sharing_test.sql` is an integration test for the sharing model.
It creates three throwaway auth users, then asserts that a share can be created
and claimed, that claiming twice does not duplicate, that a voucher already held
under the same code is merged into the share group rather than copied, that
marking used propagates in both directions, that a stranger cannot change a
voucher's status, that an invalid token is rejected, and that deleting your copy
leaves the other accounts intact. It deletes its own users at the end (cascading
to their vouchers and shares), including if an assertion fails, and asserts that
the pre-existing voucher count is unchanged.

Run it from the Supabase SQL editor and read the PASS/FAIL table it returns.
It writes to `auth.users`, so run it against a branch or a staging project if
you would rather not touch production auth at all.

## Deployment

The app builds as a static site (`npm run build` → `dist/`) and is configured for Netlify via `netlify.toml` (SPA redirect included). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables on the Netlify site.

Share links use `window.location.origin`, so they point at whatever host the app is served from.
