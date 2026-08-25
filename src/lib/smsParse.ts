import { isIsoDate, todayInIsrael } from './expiry'

/**
 * What the SMS parser is allowed to hand back to the form. Every field is
 * optional: a message that only mentions a store and a code should still fill
 * in those two rather than failing.
 */
export interface ParsedVoucher {
  store_name: string | null
  code: string | null
  amount: number | null
  expires_at: string | null
  note: string | null
}

/** Longer than any real store name or code; guards against a runaway response. */
const MAX_SHORT = 120

/**
 * The note holds the original message, which is the user's own text rather than
 * the model's, so this only needs to be past the length of any real SMS.
 */
const MAX_NOTE = 2000

/** A coupon dated further out than this is a parsing error, not a long promotion. */
const MAX_YEARS_AHEAD = 10

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function amount(value: unknown): number | null {
  // The model is asked for a number but sometimes returns "150" or "150 ₪".
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/[^\d.-]/g, ''))
        : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  // The column is numeric(12,2) with a > 0 check, so round to what it can hold.
  return Math.round(n * 100) / 100
}

function expiry(value: unknown, today: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!isIsoDate(trimmed)) return null

  // A date decades out is the model mis-reading a two-digit year far more often
  // than it is a real coupon, and it would silently disable the reminders.
  const limit = `${Number(today.slice(0, 4)) + MAX_YEARS_AHEAD}${today.slice(4)}`
  if (trimmed > limit) return null

  return trimmed
}

/**
 * Coerces and validates whatever the model returned before it reaches the form.
 * Anything unusable becomes null rather than an error: a partly-filled form the
 * user can finish is more useful than a rejection, and the user reviews every
 * field before saving in any case.
 */
export function normalizeParsedVoucher(raw: unknown, today = todayInIsrael()): ParsedVoucher {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    store_name: text(o.store_name, MAX_SHORT),
    code: text(o.code, MAX_SHORT),
    amount: amount(o.amount),
    expires_at: expiry(o.expires_at, today),
    note: text(o.note, MAX_NOTE),
  }
}

/** True when the parse found nothing worth putting in the form. */
export function isEmptyParse(v: ParsedVoucher): boolean {
  return !v.store_name && !v.code && v.amount === null && !v.expires_at && !v.note
}

const PARSE_ERRORS: Record<string, string> = {
  'Parser is not configured': 'זיהוי ההודעה אינו זמין כרגע. נסו למלא את הפרטים ידנית.',
  'Parser unavailable': 'שירות הזיהוי אינו זמין כרגע. נסו שוב או מלאו ידנית.',
  'Parser returned nothing usable': 'לא הצלחנו לקרוא את ההודעה. נסו למלא את הפרטים ידנית.',
  'Message too long': 'ההודעה ארוכה מדי. הדביקו רק את החלק הרלוונטי.',
  'Empty message': 'לא הודבק טקסט.',
  'Invalid request body': 'שליחת ההודעה נכשלה. נסו שוב.',
  'Method not allowed': 'שליחת ההודעה נכשלה. נסו שוב.',
}

/** The function raises these in English; the UI is Hebrew. */
export function translateParseError(message: string): string {
  const key = Object.keys(PARSE_ERRORS).find((k) => message.includes(k))
  return key ? PARSE_ERRORS[key] : 'זיהוי ההודעה נכשל. נסו למלא את הפרטים ידנית.'
}
