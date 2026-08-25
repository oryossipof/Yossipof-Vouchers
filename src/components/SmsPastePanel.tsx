import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { VoucherFormInput } from '../types'
import {
  isEmptyParse,
  normalizeParsedVoucher,
  translateParseError,
  type ParsedVoucher,
} from '../lib/smsParse'

interface SmsPastePanelProps {
  onParsed: (fields: Partial<VoucherFormInput>) => void
}

/** Names the fields that were filled, so the user knows what to check. */
function filledSummary(v: ParsedVoucher): string {
  const names: string[] = []
  if (v.store_name) names.push('שם החנות')
  if (v.code) names.push('הקוד')
  if (v.amount !== null) names.push('הסכום')
  if (v.expires_at) names.push('התוקף')
  if (v.note) names.push('ההערה')
  return names.join(', ')
}

/**
 * Coupons arrive as a text message. Rather than retyping five fields out of it,
 * the user pastes the message and a model pulls the details out.
 *
 * The result is always a draft: it fills the form and the user reviews it
 * before saving. Nothing here writes to the database.
 */
export function SmsPastePanel({ onParsed }: SmsPastePanelProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filled, setFilled] = useState<string | null>(null)

  async function handleParse() {
    setError(null)
    setFilled(null)

    if (!text.trim()) {
      setError('הדביקו את הודעת ה-SMS כדי שנוכל לזהות את הפרטים.')
      return
    }

    setBusy(true)
    const { data, error: fnError } = await supabase.functions.invoke('parse-voucher-sms', {
      body: { text: text.trim() },
    })
    setBusy(false)

    if (fnError) {
      // supabase-js reports a non-2xx as a generic FunctionsHttpError, so the
      // function's own message has to be read back off the response body.
      let detail = fnError.message
      const res = (fnError as { context?: Response }).context
      if (res && typeof res.json === 'function') {
        try {
          const body = await res.json()
          if (typeof body?.error === 'string') detail = body.error
        } catch {
          // Keep the generic message.
        }
      }
      setError(translateParseError(detail))
      return
    }

    const parsed = normalizeParsedVoucher((data as { voucher?: unknown } | null)?.voucher)

    if (isEmptyParse(parsed)) {
      setError('לא זיהינו פרטי שובר בהודעה. אפשר למלא אותם ידנית.')
      return
    }

    onParsed({
      ...(parsed.store_name ? { store_name: parsed.store_name } : {}),
      ...(parsed.code ? { code: parsed.code } : {}),
      ...(parsed.amount !== null ? { amount: parsed.amount } : {}),
      ...(parsed.expires_at ? { expires_at: parsed.expires_at } : {}),
      ...(parsed.note ? { note: parsed.note } : {}),
    })
    setFilled(filledSummary(parsed))
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
      >
        <span aria-hidden="true">📩</span>
        קיבלתם קופון ב-SMS? הדביקו אותו ונמלא את הפרטים
      </button>
    )
  }

  return (
    <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <label className="text-sm font-semibold text-slate-800">הדבקת הודעת SMS</label>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          סגירה
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={'לדוגמה:\nהיי! קיבלת שובר ב-150 ₪ לרשת קסטרו.\nקוד: CST-8842-XQ\nבתוקף עד 30.11.2026, לא כולל פריטי סייל.'}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      <button
        type="button"
        onClick={handleParse}
        disabled={busy}
        className="mt-2 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {busy ? 'מזהה…' : 'מילוי אוטומטי'}
      </button>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {filled && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          מילאנו {filled}. בדקו ותקנו לפני השמירה.
        </p>
      )}

      {/* The text leaves the device, so say so before anyone pastes something
          they would rather keep to themselves. */}
      <p className="mt-2 text-xs text-slate-500">
        הטקסט נשלח לשירות זיהוי חיצוני לצורך חילוץ הפרטים בלבד, ואינו נשמר שם.
      </p>
    </div>
  )
}
