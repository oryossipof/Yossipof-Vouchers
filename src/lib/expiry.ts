import type { Voucher } from '../types'

/**
 * Dates are stored as `YYYY-MM-DD` (a Postgres `date`) and shown and typed as
 * dd/mm/yyyy everywhere in the UI. The two formats never mix: everything that
 * crosses the wire is ISO, everything a person reads or types has slashes.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Today in Israel as `YYYY-MM-DD`, the same civil day the reminder job uses. */
export function todayInIsrael(now: Date = new Date()): string {
  // 'en-CA' formats as YYYY-MM-DD, so this is an ISO date in the given zone
  // without any manual offset arithmetic.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** True for a well-formed `YYYY-MM-DD` that names a day that actually exists. */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [, y, mo, d] = m
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`)
  // A month past 12 gives an Invalid Date outright; a day past the end of a
  // real month (31/02) parses but lands in the next month, so the round trip
  // is what catches it.
  if (Number.isNaN(date.getTime())) return false
  return date.toISOString().slice(0, 10) === value
}

/** `2026-11-30` → `30/11/2026`. Returns '' for anything unparseable. */
export function formatDate(iso: string | null): string {
  if (!iso || !isIsoDate(iso)) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/**
 * `30/11/2026` → `2026-11-30`, or null if it is not a real date. Accepts
 * single-digit day and month (`5/3/2026`) since that is natural to type.
 */
export function parseDate(input: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input.trim())
  if (!m) return null
  const [, d, mo, y] = m
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  return isIsoDate(iso) ? iso : null
}

/**
 * Keeps a dd/mm/yyyy field readable while it is being typed: digits only, with
 * the slashes inserted for the user. Deleting back through a slash works
 * because the separators are re-derived from the digits every keystroke.
 */
export function maskDateInput(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8)
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
  return parts.filter((p) => p.length > 0).join('/')
}

/**
 * Whole days from `today` until the voucher expires: 0 on the last valid day,
 * negative once past, null when the voucher has no expiry date at all.
 */
export function daysUntilExpiry(voucher: Voucher, today: string): number | null {
  if (!voucher.expires_at || !isIsoDate(voucher.expires_at) || !isIsoDate(today)) return null
  const from = Date.parse(`${today}T00:00:00Z`)
  const to = Date.parse(`${voucher.expires_at}T00:00:00Z`)
  return Math.round((to - from) / MS_PER_DAY)
}

/**
 * A voucher is expired only once its last valid day has passed. On the expiry
 * day itself it is still usable, and still counts as active.
 */
export function isExpired(voucher: Voucher, today: string): boolean {
  const days = daysUntilExpiry(voucher, today)
  return days !== null && days < 0
}

/** How soon it lapses, which decides how loudly the card says so. */
export type ExpiryTone = 'expired' | 'soon' | 'later'

export function expiryTone(voucher: Voucher, today: string): ExpiryTone | null {
  const days = daysUntilExpiry(voucher, today)
  if (days === null) return null
  if (days < 0) return 'expired'
  if (days <= 7) return 'soon'
  return 'later'
}

/** The Hebrew line shown on the card. Null when there is no expiry date. */
export function expiryLabel(voucher: Voucher, today: string): string | null {
  const days = daysUntilExpiry(voucher, today)
  if (days === null) return null
  const date = formatDate(voucher.expires_at)
  if (days < 0) return `פג תוקף ב-${date}`
  if (days === 0) return 'פג תוקף היום'
  if (days === 1) return 'פג תוקף מחר'
  if (days <= 7) return `פג תוקף בעוד ${days} ימים`
  return `בתוקף עד ${date}`
}

/**
 * Orders vouchers by urgency: the ones lapsing soonest first, then by the date
 * they were added, oldest first. A voucher with no expiry date never becomes
 * urgent, so it sorts after every dated one rather than jumping the queue.
 *
 * `newestExpiryFirst` reverses only the date comparison, for the expired list —
 * there the useful thing at the top is what lapsed most recently, not a coupon
 * that died two years ago. The added-date tie-break stays oldest-first either
 * way, so the secondary ordering is the same wherever you look.
 */
export function compareByExpiry(a: Voucher, b: Voucher, newestExpiryFirst = false): number {
  const ax = a.expires_at && isIsoDate(a.expires_at) ? a.expires_at : null
  const bx = b.expires_at && isIsoDate(b.expires_at) ? b.expires_at : null

  if (ax && bx && ax !== bx) {
    // ISO dates compare correctly as plain strings.
    const earlierFirst = ax < bx ? -1 : 1
    return newestExpiryFirst ? -earlierFirst : earlierFirst
  }
  if (ax && !bx) return -1
  if (!ax && bx) return 1

  if (a.created_at < b.created_at) return -1
  if (a.created_at > b.created_at) return 1
  return 0
}
