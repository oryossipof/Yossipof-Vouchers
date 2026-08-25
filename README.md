# Vouchers

A PWA for keeping track of gift cards, coupons, and other vouchers: store a code, store name, credit amount, and expiry date, optionally attach a photo and a note, share a voucher with someone else, and mark vouchers as used or delete them once redeemed. Paste the SMS a store sent you and the fields fill themselves in; vouchers that lapse move to their own section, and a push notification arrives before they do.

## Stack

- React + TypeScript + Vite, built as an installable PWA (`vite-plugin-pwa`, `injectManifest`)
- Tailwind CSS
- Supabase (Postgres, Auth, Storage, Edge Functions, Cron) for data, authentication, photo uploads, SMS parsing, and expiry reminders
- Google Gemini for reading a pasted coupon SMS; Web Push (VAPID) for the reminders
- Deployed on Netlify

## Features

- Email/password sign up and login (Supabase Auth), with resend-confirmation and password reset
- Add a voucher with store name, code, amount, an optional expiry date, an optional note, and an optional photo
- **Paste the store's SMS** and have the store name, code, amount, expiry date and conditions filled in automatically
- **Expiry dates** written and shown as dd/mm/yyyy, with a countdown badge on the card once a voucher is within a week of lapsing
- **A separate section for expired vouchers**, so the active list only shows what can still be used
- **Push reminders at 10:00** a week before a voucher expires, the day before, and on the day itself — even with the app closed
- Duplicate-code check: entering a code you already hold shows which voucher it belongs to and blocks the save
- Edit any voucher (pencil icon on the card), including replacing or removing its photo
- View active vouchers, reveal/hide the code, mark as used, or delete
- Confirmation dialog before marking a voucher as used, restoring it, or deleting it
- Share a voucher via WhatsApp: the recipient opens the link and the voucher is added to their account
- Share all of them at once: one link covering every active voucher you own, sent in a single WhatsApp message
- Link two accounts into one joint collection: every add, edit, mark-as-used, and delete applies to both, with no per-voucher sharing
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

## Linked accounts

Per-voucher sharing answers "here, take this coupon." Two people keeping one wallet were asking something else, and had to re-share every coupon they added. A **link** is the standing version: once two accounts are linked, each sees and manages everything the other owns — adding, editing, marking used, and deleting all apply to both, with no per-voucher step.

The two models compose. `can_manage_voucher` is the owner's set of powers — delete the voucher, hand out share links, remove someone from a share — and now answers true for a linked account as well; `can_access_voucher` is that plus the vouchers shared with you one by one. The client mirrors the split: `isOwner` stays literal, and `canManage` drives what the card lets you do.

Two properties keep a link from reaching further than the pair that agreed to it, and both are covered by `supabase/tests/account_links_test.sql`:

- **A link passes on what an account owns, not what has been shared with it.** Otherwise linking with someone would hand you the vouchers of every stranger who ever shared one with them.
- **Links are not transitive.** Being linked to B does not put you in A's collection just because B is.

Linking goes through an invite token sent as `/link/:token`, and that token is deliberately more restricted than a voucher share link: single use, seven days, and minting a new one deletes the previous invite, so a token pasted into a chat months ago cannot come back to life. Either side can cut the link at any time from `/account`; the vouchers each of them added stay with their owner.

### A policy must not ask the table about the row it is holding

`0012_fix_insert_returning.sql` fixes a bug that made **adding a voucher fail
outright** between `0006` and `0012`. The client saves with
`.insert(...).select().single()`, which PostgREST sends as
`INSERT ... RETURNING`, and Postgres applies the *SELECT* policy to the row
being returned. That policy was `can_access_voucher(id)` — a `STABLE` security
definer function whose body queries `public.vouchers`. A subquery cannot see
the row its own command is inserting, so the check answered false for the row
that had just been created and the save came back as `42501 new row violates
row-level security policy`.

Two things hid it. The insert itself was always permitted — only the RETURNING
half failed — and the SQL suites all run inside `DO` blocks as the table owner,
where row-level security is bypassed. It took driving the real app in a browser
to see it at all, which is why `supabase/tests/insert_returning_test.sql` now
exercises this path under the actual `authenticated` role.

The policy now decides ownership and the account link from the row's own
`user_id`, which the policy expression already has, and only falls back to a
lookup for the shared-with-you case, which always concerns a row that exists.
The general lesson: a policy that references its own table in a subquery is a
trap on INSERT.

### Security model

`0004_harden_sharing.sql` establishes the rules that make sharing safe:

- **Clients cannot write `status` or `used_at`.** The `authenticated` role holds column-level INSERT/UPDATE on the editable fields only; status moves exclusively through `set_voucher_status`. Under the old copy model this also covered `share_group_id`, without which a group id would have been a permanent bearer credential — anyone who ever learned one could re-join the group and flip other people's vouchers. `0006` removed that column entirely; membership is now an explicit table that clients cannot insert into.
- **Only the owner may hand out share links**, and only the owner may delete. Being a member lets you edit and use the voucher, not widen access to it or destroy it for everyone else. Since `0011` an account linked to the owner holds these powers too — that is what a link is — but a member still does not.
- **Share links expire after 30 days**, and `voucher_shares` has RLS enabled with no policies, so tokens are reachable only through the functions and cannot be enumerated.
- **Membership is not self-serve.** `voucher_members` grants `select` only; rows are created solely by `claim_voucher_share` against a valid unexpired token, and removed by `leave_voucher_share` for yourself.

`0005_storage_hardening.sql` covers uploads: the `voucher-photos` bucket enforces a 5 MB limit and an image-only MIME allowlist server-side (the form's `accept="image/*"` is only a hint and is bypassable). `image/svg+xml` is deliberately excluded, since SVG can carry executable script that would run when the file is opened through a signed URL. The object policies are scoped to the `authenticated` role, and the upload path sanitises the file extension so a crafted filename cannot steer the storage key.

Auth is configured with a minimum password length of 8 (matched by the signup form's own validation) and email confirmation required.

**Known gap:** leaked-password protection (HaveIBeenPwned checks on new passwords) is **not enabled**, because Supabase gates it behind a Pro plan and this project is on Free. The security advisor will keep reporting `auth_leaked_password_protection` as a WARN until the project is upgraded, at which point it can be turned on in Authentication → Policies with no code change. Enabling CAPTCHA on auth endpoints is also still open; it needs an hCaptcha or Turnstile secret.

Supabase's security advisor reports four `SECURITY DEFINER` functions callable by `authenticated`. That is intended: controlled privilege elevation is what makes cross-account sync possible, each function verifies `auth.uid()` ownership before doing anything, and all of them pin `search_path`. The `rls_enabled_no_policy` notice on `voucher_shares` is likewise deliberate deny-all.

## Expiry dates

`vouchers.expires_at` is a Postgres `date`, not a `timestamptz`. A coupon
expires on a calendar day rather than at an instant, and a timestamp would make
"expires today" depend on the server's offset from Israel and answer wrongly
either side of midnight.

Storage and display are separate concerns. The value crosses the wire as ISO
`YYYY-MM-DD`; the UI reads and writes dd/mm/yyyy everywhere. The form field is a
plain text input with an eight-digit mask rather than `<input type="date">`,
because the native picker renders in the *device's* locale — some users would
have been shown mm/dd/yyyy, which for a date like 03/04 silently means a
different day. `src/lib/expiry.ts` holds `parseDate`, `formatDate` and
`maskDateInput`, all unit-tested.

A voucher is expired only once its last valid day has **passed**: on the expiry
day itself it is still usable and still counts as active. Expired vouchers leave
the active list and appear under `פג תוקף`, keeping their edit, share, delete and
"mark as used" controls — a store may honour a coupon past its date, and that
should still be recordable. A **used** voucher stays under `נוצלו` even once its
date passes; it was already spent, and reclassifying it would lose that.

Because expiry depends on the date rather than on any event, `today` is state in
`VouchersContext` refreshed on `visibilitychange`, on `online`, and hourly — a
session left open overnight would otherwise keep showing yesterday's split.

> **Adding a column to `vouchers` needs a grant.** `0004_harden_sharing.sql`
> revoked table-level `insert`/`update` from `authenticated` and granted the
> safe columns back one at a time, so a new column is not writable by default.
> `0013` therefore grants `insert (expires_at)` and `update (expires_at)`
> explicitly. Without them every add and edit fails with
> `permission denied for column expires_at` — and since every RLS policy still
> passes, it reads as an RLS bug rather than a grant bug.

## Importing a voucher from an SMS

Coupons arrive as text messages, and retyping one into five fields is the main
friction in adding a voucher — it is also where the expiry date used to get
lost, as free text in the note. The add screen therefore takes the pasted
message and fills the form in.

`supabase/functions/parse-voucher-sms` sends the text to Google Gemini
(`gemini-3.6-flash`) with a `responseSchema`, so the reply is typed JSON rather
than prose. The prompt is tuned for Hebrew Israeli retail: shekel amounts,
day-first dates (`5.3.27` is 5 March 2027, not 3 May), the phrasings that
introduce an expiry date, real restrictions into the note and marketing copy
left out, and `null` rather than a guess for anything the message does not say.

It runs server-side purely so the API key never reaches the bundle, and
`verify_jwt` stays **on**: without it the URL is an open proxy to a metered API
for anyone who finds it. Upstream errors are logged but never returned to the
client, so the endpoint cannot be used to probe the project's configuration.

**The model's output is untrusted input.** `normalizeParsedVoucher` in
`src/lib/smsParse.ts` coerces and validates before anything reaches the form: it
strips currency symbols, rejects zero and negative amounts (the column's `> 0`
check would otherwise fail the save with a database error instead of an empty
field), rejects dates that do not exist and dates more than ten years out
(usually a mis-read two-digit year, and accepting one would silently park the
voucher where no reminder ever fires), and caps runaway strings.

The result is always a **draft**: it fills the form and the user confirms it.
Nothing is saved automatically, so a wrong amount or a hallucinated date is
catchable. The duplicate-code check still applies, so a pasted coupon you
already hold is flagged the same as a typed one.

The panel says in small print that the text is sent to an external service,
because it is.

## Expiry reminders

Every day at 10:00 Israel time, everyone holding a voucher that expires in
7 days, 1 day, or today gets a Web Push notification — the owner, any linked
account, and anyone the voucher was shared with. A voucher only one of them
hears about is a voucher the other two watch expire, and whoever is nearest the
store should be the one who can act.

### One notification, not three

Each person gets a single digest per run rather than one notification per
voucher: three separate alerts at 10am reads as spam, and iOS collapses
same-tag notifications anyway. One item reads `השובר של קסטרו פג היום` and opens
that voucher; several read `5 שוברים פגים בקרוב` with the three most urgent
listed and `ועוד 2` for the rest. The claim table stays per-voucher, so the
bookkeeping is still exact.

### Never twice

`voucher_expiry_notices` has the primary key
`(voucher_id, user_id, expires_on, milestone)`, and the claim is a single
`insert ... on conflict do nothing ... returning` that selects the recipients
and takes them in the same statement. If two invocations run at once, both
attempt the insert and only one gets the rows back — no advisory locks, no
check-then-act race.

Including `expires_on` in the key is what lets an edit re-arm the reminders:
moving a voucher's date is a genuinely new reminder, while a repeated run
against the same date is not. Rows stay unmarked until the push has actually
been handed to the push service, so a send that dies halfway is retried by the
sweep twenty minutes later.

`p_claim = false` answers the same question without taking anything. Without it
a preview at 09:50 would consume the day's reminders and the real 10:00 job
would find nothing left to do.

### Daylight saving

`pg_cron` has no per-job timezone and evaluates schedules in UTC on Supabase.
10:00 in Israel is 08:00 UTC in winter and 07:00 UTC in summer. Rather than
editing the schedule twice a year — and getting it wrong the year nobody
remembers — the job fires at **both** hours and does nothing unless the Israeli
clock actually reads 10. Exactly one of the two runs does the work, every day,
in both halves of the year.

### The service worker

Adding a `push` handler meant moving `vite-plugin-pwa` from `generateSW` to
`injectManifest` with a real source file at `src/sw.ts`. Three things
`generateSW` used to inject silently are now this file's job, and dropping any
of them breaks the app for existing installs:

1. `skipWaiting()` + `clientsClaim()`, without which `registerType: 'autoUpdate'`
   leaves a new version waiting until every tab is closed.
2. A `NavigationRoute` fallback to `index.html`. Without it, opening the app
   offline or hard-refreshing a deep link like `/edit/:id` returns a 404 from
   the cache instead of the app shell.
3. The `voucher-photos` `CacheFirst` rule — `runtimeCaching` has no equivalent
   under `injectManifest` and had to be re-expressed as code.

`WebWorker` and `DOM` cannot share a `lib` set (both declare `self`, `fetch` and
`Client`), so the worker is a separate TypeScript project: `tsconfig.worker.json`
compiles `src/sw.ts`, and `tsconfig.app.json` excludes it.

`notificationclick` focuses an existing window and `postMessage`s the route to
it rather than calling `client.navigate()`, which is unreliable inside an iOS
standalone web app.

### On iPhone, the app must be installed

Apple ships Web Push only to web apps added to the Home Screen (iOS 16.4+). In
an ordinary Safari tab `window.PushManager` is simply `undefined`, and there is
no flag or workaround short of a native app. The settings panel detects this and
shows the Add-to-Home-Screen steps instead of a button that would silently do
nothing; it also distinguishes iOS older than 16.4, and a permission the user
has already refused. Android Chrome has no such restriction and works in a
normal tab.

`Notification.requestPermission()` is the **first** statement in the click
handler. On iOS the prompt is tied to the user gesture, and awaiting anything
beforehand consumes it — the prompt is then dropped with no error at all.

### A normal-urgency push can sit undelivered on a locked iPhone

Apple accepted the push, marked it delivered, and nothing appeared on the
phone. The cause was `Urgency: normal`, which entitles APNs to hold a push for
a locked, idle device until it next wakes — for a once-daily 10:00 reminder
that can mean hours late, or not that day at all. Raising it to `high` made the
notification arrive immediately. Chrome showed no such behaviour, so this is
another one that only a real iPhone finds.

`high` is the right level here regardless: this is a user-visible, time-bound
alert, not a background sync.

### Apple is stricter about the Topic header

Apple rejected every push with `400 BadWebPushTopic` while Chrome accepted the
same requests without complaint. The `Topic` header was `voucherexpiry`: thirteen
characters, every one of them from the base64url alphabet, which is what RFC 8030
asks for. Apple wants a value that genuinely **base64url-decodes**, not merely one
spelled from that alphabet, so the topic is now `dm91Y2hlci1leHBpcnk` — the
encoded form of `voucher-expiry`.

This only appears on a real iPhone. Every desktop test passed and FCM was happy,
which is the reason `sendOne` logs the push service's own `reason` rather than
just the status code: `{"reason":"BadWebPushTopic"}` turned an unexplained 400
into a one-line fix.

### Subscriptions

`push_subscriptions` is keyed on the endpoint, which is globally unique and is
what the push service treats as the identity of a browser on a device; several
devices per account fall out for free. There are no write policies — the two
`security definer` functions are the only way in, because the upsert has to be
able to *take over* a row that currently belongs to another user, which a
row-level policy cannot express. That case is real: two people signing in on the
same phone produce the same endpoint, and the reminders should follow whoever
signed in last.

Safari never fires `pushsubscriptionchange`, and on Chrome it can fire with no
page open to act on it, so re-registering on app start is what actually keeps
endpoints current. A 404 or 410 from the push service means the subscription is
dead and the row is deleted — `isGone()` in the push library only checks 410,
but Chrome and Apple both use 404.

### Secrets

The cron caller reads `project_url`, `edge_secret_key` and `cron_secret` from
**Supabase Vault**; `0016` only reads them, so nothing secret is committed.
Create them once by hand:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<project secret key>',      'edge_secret_key');
select vault.create_secret('<32 random bytes, base64>', 'cron_secret');
```

Do **not** use `alter database ... set app.settings.x` for these — any role can
read that back via `current_setting()`.

The functions themselves need these secrets set under Edge Functions → Secrets:

| Secret | Used by |
|---|---|
| `GEMINI_API_KEY` | `parse-voucher-sms` |
| `VAPID_KEYS_JSON` | `send-expiry-notifications` (the JWK pair) |
| `VAPID_SUBJECT` | `send-expiry-notifications` (`mailto:` contact, per RFC 8292) |
| `CRON_SECRET` | `send-expiry-notifications`, matching the Vault value |

`send-expiry-notifications` runs with **`verify_jwt = false`**, because the
caller is Postgres holding a secret key rather than a signed-in user. The
`x-cron-secret` check inside the handler is therefore the only thing between
that URL and the open internet — it is not optional. It replies `202` and sends
in `EdgeRuntime.waitUntil`, because `pg_net`'s default timeout is 2 seconds.

Rotating the VAPID keys invalidates **every existing subscription**, so treat
them as permanent. The public application server key is public by definition and
ships in the bundle as `VITE_VAPID_PUBLIC_KEY`.

### Checking on it

```sql
-- did the schedule fire?
select jobid, runid, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 10;

-- did the HTTP call land? (pg_net keeps responses for 6 hours)
select status_code, timed_out, error_msg, content
  from net._http_response order by created desc limit 5;

-- what is still waiting to be delivered?
select * from public.voucher_expiry_notices where notified_at is null;
```

The function takes `{"today": "YYYY-MM-DD"}` to hit any milestone without
editing real vouchers, `{"dry_run": true}` to see what would go out without
claiming it, and `{"only_user_id": "..."}` to restrict it to one account.

> **Free plan caveat:** Supabase pauses a free project after 7 days of
> inactivity, and a paused project runs no cron. If the app goes unused for a
> week the 10:00 job simply stops until someone opens it again.

## Local development

1. Copy `.env.example` to `.env.local` and fill in your Supabase project URL, publishable/anon key, and VAPID public key.
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
- `0011_account_links.sql` — adds `account_links` / `account_link_invites`, `can_manage_voucher`, and the invite, accept, and unlink functions behind linked accounts
- `0012_fix_insert_returning.sql` — rewrites the voucher SELECT policy so `INSERT ... RETURNING` works; see below
- `0013_voucher_expiry.sql` — adds `vouchers.expires_at`, its partial index, and the column grants that make it writable
- `0014_push_subscriptions.sql` — adds `push_subscriptions` and the `save_push_subscription` / `delete_push_subscription` functions
- `0015_expiry_notifications.sql` — adds `voucher_expiry_notices` and the `claim_expiry_notifications` / `mark_expiry_notifications_sent` functions
- `0016_expiry_cron.sql` — enables `pg_cron` and `pg_net` and schedules the daily 10:00 reminder job and its retry sweep

Edge functions live in `supabase/functions/` and are deployed separately;
`supabase/config.toml` records each one's `verify_jwt` setting.

## Live updates

`0007` publishes `vouchers` and `voucher_members` to Supabase Realtime, so a change made on one device appears on the others without a reload — marking a voucher used, editing its details, joining or leaving a share.

Both tables are set to `REPLICA IDENTITY FULL`. With the default (primary key only), an UPDATE or DELETE carries just the key, and Realtime cannot evaluate the row against the subscriber's RLS policy — members would silently receive nothing for vouchers they do not own, which is precisely the case that needs to work.

The client refetches the visible set on any event rather than patching the changed row in place. That is deliberate: for deletes and for membership changes the payload alone does not say what the user should now be able to see. Events are debounced by 150 ms so a burst causes one refetch, and the refresh runs without the loading state so the list does not flicker while being read.

Realtime can miss events while a phone is asleep or offline, and this is an installable PWA, so the app also re-syncs on `visibilitychange` and `online`.

## Account

`/account` shows the signed-in address and lets the user change their password. The current password is verified with `signInWithPassword` before `updateUser` is called: Supabase would accept the change on the strength of the session alone, so without that step anyone reaching an unlocked device could take over the account without knowing the existing password.

It is also where linked accounts are managed: the page lists who this account is linked with and since when, offers a disconnect next to each, and mints the invite link described under [Linked accounts](#linked-accounts).

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

Unit tests (73 of them) cover the pure logic in `src/lib/`:

- `vouchers.ts` — the duplicate-code rules: case- and whitespace-insensitive
  matching, excluding the voucher being edited, matching used vouchers as well
  as active ones
- `share.ts` — building the WhatsApp messages and translating Postgres errors
- `expiry.ts` — dd/mm/yyyy parsing and masking, impossible dates like 31/02,
  day-boundary arithmetic, the 7/1/0 labels, and the Israeli civil day. The
  day maths is done in UTC deliberately: subtracting local times across Israel's
  DST changeover yields 0.958 days and rounds to the wrong milestone.
- `smsParse.ts` — normalising what the model returns, which is untrusted input:
  currency symbols, zero and negative amounts, non-existent dates, dates far in
  the future, and runaway strings

```
npm test
```

`supabase/tests/expiry_notifications_test.sql` covers the reminders (18 checks).
It builds an owner, a linked account, a share member and an unrelated stranger,
then asserts that all three holders are notified and the stranger is not, that
no-date, used and already-expired vouchers are never due, that a second run
claims nothing, that a stale undelivered claim is retried while a delivered one
is not, that editing an expiry date re-arms the reminder, that a preview claims
nothing, and that a device shared by two accounts follows whoever signed in
last.

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

The app builds as a static site (`npm run build` → `dist/`) and is configured for Netlify via `netlify.toml` (SPA redirect included). Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_VAPID_PUBLIC_KEY` as environment variables on the Netlify site.

The edge functions and their secrets live on Supabase rather than Netlify — see
[Secrets](#secrets) under expiry reminders. `netlify.toml` already sends
`Cache-Control: no-cache` for `/sw.js`, which the `injectManifest` build still
emits under that name.

Share links use `window.location.origin`, so they point at whatever host the app is served from.
