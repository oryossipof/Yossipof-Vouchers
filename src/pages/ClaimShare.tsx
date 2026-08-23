import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useVouchers, type ClaimOutcome } from '../context/VouchersContext'
import type { Voucher } from '../types'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; voucher: Voucher | null; outcome: ClaimOutcome }

const ERROR_TRANSLATIONS: Record<string, string> = {
  'Share link not found': 'קישור השיתוף אינו תקין או שכבר בוטל.',
  'Share link has expired': 'תוקף קישור השיתוף פג. בקשו קישור חדש ממי ששיתף.',
  'Shared voucher no longer exists': 'השובר המשותף נמחק על ידי הבעלים.',
  'Not authenticated': 'יש להתחבר כדי לקבל את השובר.',
}

function translate(message: string) {
  const key = Object.keys(ERROR_TRANSLATIONS).find((k) => message.includes(k))
  return key ? ERROR_TRANSLATIONS[key] : message
}

const HEADINGS: Record<ClaimOutcome, string> = {
  joined: 'השובר נוסף לחשבון שלכם',
  already_member: 'השובר כבר משותף איתכם',
  own_voucher: 'זה השובר שלכם',
}

export function ClaimShare() {
  const { token } = useParams<{ token: string }>()
  const { claimShare } = useVouchers()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const claimed = useRef(false)

  useEffect(() => {
    if (!token || claimed.current) return
    claimed.current = true

    claimShare(token).then(({ error, voucher, outcome }) => {
      if (error || !outcome) setState({ kind: 'error', message: translate(error ?? 'שגיאה') })
      else setState({ kind: 'done', voucher, outcome })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
      {state.kind === 'loading' && (
        <>
          <div className="text-3xl">🎁</div>
          <p className="mt-2 text-sm text-slate-500">מוסיף את השובר לחשבון שלכם…</p>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <div className="text-3xl">⚠️</div>
          <h1 className="mt-2 text-base font-semibold text-slate-900">לא הצלחנו להוסיף את השובר</h1>
          <p className="mt-2 text-sm text-red-600">{state.message}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-medium text-indigo-600">
            חזרה לשוברים
          </Link>
        </>
      )}

      {state.kind === 'done' && (
        <>
          <div className="text-3xl">✅</div>
          <h1 className="mt-2 text-base font-semibold text-slate-900">
            {HEADINGS[state.outcome]}
          </h1>
          {state.voucher && (
            <p className="mt-1 text-sm text-slate-600">
              {state.voucher.store_name} · <span className="font-mono">{state.voucher.code}</span>
            </p>
          )}
          {state.outcome !== 'own_voucher' && (
            <p className="mt-3 text-start text-sm text-slate-500">
              זהו אותו שובר בדיוק, ולא עותק. כל שינוי — סימון כנוצל, עריכת הפרטים, הערה או תמונה —
              יופיע מיד בכל החשבונות שהשובר משותף איתם.
            </p>
          )}
          <Link
            to={state.voucher?.status === 'used' ? '/used' : '/'}
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            לצפייה בשובר
          </Link>
        </>
      )}
    </div>
  )
}
