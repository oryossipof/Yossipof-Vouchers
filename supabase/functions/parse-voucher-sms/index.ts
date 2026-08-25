// Turns a pasted coupon SMS into structured voucher fields.
//
// This runs server-side for one reason: the model API key must never reach the
// client bundle. Everything else about it is deliberately thin — it does no
// database work and stores nothing. The caller gets a draft, shows it in the
// add-voucher form, and the user confirms it before anything is saved.
//
// verify_jwt stays ON for this function. Without it the URL is an open proxy
// to a metered API for anyone who finds it.

// Google retires model aliases without warning -- gemini-2.0-flash started
// answering 404 with "no longer available". If this function starts failing
// with a 404, check the logged upstream message: it names the replacement.
const MODEL = 'gemini-3.6-flash'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// Long enough for a wordy promotional SMS, short enough that nobody can paste a
// novel through it.
const MAX_INPUT = 4000

const SYSTEM_PROMPT = `You extract gift-card and coupon details from a text message.

The messages are usually Hebrew, from Israeli retailers, and often contain
marketing filler around the useful parts.

Rules:
- Amounts are in shekels (₪ / ש"ח / NIS). Return a plain number, no currency symbol.
- Dates are written day-first. "30.11.26", "30/11/2026" and "30 בנובמבר 2026"
  all mean 30 November 2026. Always return expires_at as YYYY-MM-DD.
- Phrases like "בתוקף עד", "תוקף", "יש לממש עד" introduce the expiry date.
- store_name is the retailer or chain, not the sender's marketing name.
- code is the voucher / gift card / coupon code the customer redeems.
- note should capture genuine restrictions ("לא כולל מבצעים", "לא כולל פריטי סייל",
  "בסניפים נבחרים"). Leave out greetings, marketing copy, and links.
- Return null for anything the message does not actually state. Never guess, and
  never invent a date or an amount that is not there.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    store_name: { type: 'STRING', nullable: true },
    code: { type: 'STRING', nullable: true },
    amount: { type: 'NUMBER', nullable: true },
    expires_at: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
    note: { type: 'STRING', nullable: true },
  },
  required: ['store_name', 'code', 'amount', 'expires_at', 'note'],
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Trimmed: a trailing newline from a copy-paste is a common and otherwise
  // baffling cause of API_KEY_INVALID.
  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim()
  if (!apiKey) return json({ error: 'Parser is not configured' }, 503)

  let text: string
  try {
    const body = await req.json()
    text = typeof body?.text === 'string' ? body.text : ''
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  text = text.trim()
  if (!text) return json({ error: 'Empty message' }, 400)
  if (text.length > MAX_INPUT) return json({ error: 'Message too long' }, 413)

  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    })
  } catch {
    return json({ error: 'Parser unavailable' }, 502)
  }

  if (!res.ok) {
    // The upstream message is logged because it is what tells you a model was
    // retired or a key was rejected, but it never reaches the client: this
    // endpoint should not become a way to probe the project's configuration.
    let message = ''
    try {
      message = JSON.parse(await res.text())?.error?.message ?? ''
    } catch {
      // Non-JSON error body; the status alone will have to do.
    }
    console.error(`gemini responded ${res.status}: ${message.slice(0, 300)}`)
    return json({ error: 'Parser unavailable' }, 502)
  }

  const data = await res.json()
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof raw !== 'string') return json({ error: 'Parser returned nothing usable' }, 502)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return json({ error: 'Parser returned nothing usable' }, 502)
  }

  // Deliberately returned as-is. The client runs it through
  // normalizeParsedVoucher before it touches the form, so validation lives in
  // one place that is unit-tested, rather than being duplicated here.
  return json({ voucher: parsed })
})
