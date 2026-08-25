// Sends the daily "your voucher is about to expire" push notifications.
//
// Invoked by pg_cron at 10:00 Israel time (see 0016_expiry_cron.sql). The
// schema decides who is due and claims the reminders; this function only turns
// each claim into a notification and reports back what actually went out.
//
// verify_jwt is OFF for this function, because the caller is Postgres holding a
// secret key rather than a signed-in user. The x-cron-secret check below is
// therefore the only thing standing between this URL and the open internet --
// it is not optional.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import * as webpush from 'jsr:@negrel/webpush@0.5.0'

interface Item {
  voucher_id: string
  store_name: string
  expires_on: string
  milestone: number
}

interface Recipient {
  user_id: string
  items: Item[]
  subscriptions: { endpoint: string; keys: { p256dh: string; auth: string } }[]
}

/** Beyond this the body is a wall of store names on a lock screen. */
const MAX_LISTED = 3

const CORS = { 'Access-Control-Allow-Origin': '*' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function whenPhrase(milestone: number): string {
  if (milestone === 0) return 'היום'
  if (milestone === 1) return 'מחר'
  return 'בעוד שבוע'
}

/**
 * One notification per person per run, not one per voucher: three separate
 * alerts at 10am reads as spam, and iOS collapses same-tag notifications
 * anyway. The claim table stays per-voucher so the bookkeeping is still exact.
 */
function digest(items: Item[]): { title: string; body: string; url: string } {
  if (items.length === 1) {
    const only = items[0]
    return {
      title: 'שוברים',
      body: `השובר של ${only.store_name} פג ${whenPhrase(only.milestone)}`,
      url: `/edit/${only.voucher_id}`,
    }
  }

  const listed = items.slice(0, MAX_LISTED).map((i) => `${i.store_name} — ${whenPhrase(i.milestone)}`)
  const rest = items.length - listed.length
  if (rest > 0) listed.push(`ועוד ${rest}`)

  return {
    title: `${items.length} שוברים פגים בקרוב`,
    body: listed.join(' · '),
    // No single voucher to open, so the active list is the useful destination.
    url: '/',
  }
}

const vapidKeys = await webpush.importVapidKeys(
  JSON.parse(Deno.env.get('VAPID_KEYS_JSON')!),
  { extractable: false }
)

// One application server per isolate: constructing it mints an ephemeral ECDH
// key pair, which is per RFC 8291 but should not happen per message.
const appServer = await webpush.ApplicationServer.new({
  contactInformation: Deno.env.get('VAPID_SUBJECT')!,
  vapidKeys,
})

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

interface SendOutcome {
  ok: boolean
  /** The push service says this subscription is dead; delete the row. */
  gone: boolean
  status: number
}

async function sendOne(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: unknown
): Promise<SendOutcome> {
  try {
    await appServer
      .subscribe(sub as unknown as webpush.PushSubscription)
      .pushTextMessage(JSON.stringify(payload), {
        urgency: webpush.Urgency.Normal,
        // A reminder is worthless once the day is over.
        ttl: 12 * 60 * 60,
        topic: 'voucherexpiry',
      })
    return { ok: true, gone: false, status: 201 }
  } catch (err) {
    if (err instanceof webpush.PushMessageError) {
      const status = err.response.status
      // isGone() only checks 410, but Chrome and Apple both use 404 for an
      // endpoint that no longer exists.
      return { ok: false, gone: status === 404 || status === 410, status }
    }
    console.error('push failed', err instanceof Error ? err.message : String(err))
    return { ok: false, gone: false, status: 0 }
  }
}

async function deliver(recipients: Recipient[]) {
  const delivered: Item[] = []
  let sent = 0
  let dropped = 0

  for (const r of recipients) {
    if (r.subscriptions.length === 0) {
      // Nobody to notify on this account. The claim is left unmarked so that
      // if they enable notifications later the sweep can still reach them.
      continue
    }

    const payload = { ...digest(r.items), tag: 'voucher-expiry' }
    let anyDelivered = false

    for (const sub of r.subscriptions) {
      const outcome = await sendOne(sub, payload)
      if (outcome.ok) {
        anyDelivered = true
        sent += 1
      } else if (outcome.gone) {
        await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        dropped += 1
        // A dead endpoint must not keep the claim alive forever.
        anyDelivered = true
      } else {
        console.error(`push to one endpoint failed with ${outcome.status}`)
      }
    }

    if (anyDelivered) delivered.push(...r.items.map((i) => ({ ...i, user_id: r.user_id } as Item)))
  }

  if (delivered.length > 0) {
    const keys = delivered.map((i) => ({
      voucher_id: i.voucher_id,
      user_id: (i as Item & { user_id: string }).user_id,
      expires_on: i.expires_on,
      milestone: i.milestone,
    }))
    const { error } = await admin.rpc('mark_expiry_notifications_sent', { p_keys: keys })
    if (error) console.error('mark_expiry_notifications_sent failed', error.message)
  }

  console.log(`recipients=${recipients.length} sent=${sent} dropped=${dropped}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // With verify_jwt off this is the whole authorisation check.
  const expected = Deno.env.get('CRON_SECRET')
  if (!expected || req.headers.get('x-cron-secret') !== expected) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: { today?: string; dry_run?: boolean; only_user_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // A body is optional; the cron job sends one, a manual poke may not.
  }

  // A dry run must not consume the day's reminders, or a preview at 09:50
  // would leave the real 10:00 send with nothing to do.
  const { data, error } = await admin.rpc('claim_expiry_notifications', {
    p_today: body.today ?? null,
    p_claim: !body.dry_run,
  })

  if (error) {
    console.error('claim failed', error.message)
    return json({ error: 'claim failed' }, 500)
  }

  let recipients = (data ?? []) as Recipient[]
  if (body.only_user_id) recipients = recipients.filter((r) => r.user_id === body.only_user_id)

  // Reports what would go out without claiming anything, so it is safe to run
  // at any time, including minutes before the real job.
  if (body.dry_run) {
    return json({
      dry_run: true,
      recipients: recipients.map((r) => ({
        user_id: r.user_id,
        devices: r.subscriptions.length,
        notification: digest(r.items),
        items: r.items,
      })),
    })
  }

  // pg_net's default timeout is 2 seconds, far less than a batch of pushes can
  // take, so the response goes back immediately and the work continues.
  EdgeRuntime.waitUntil(deliver(recipients))

  return json({ accepted: true, recipients: recipients.length }, 202)
})
