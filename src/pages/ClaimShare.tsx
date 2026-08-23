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
  'Shared voucher no longer exists': 'השובר המשותף נמחק על ידי מי ששיתף אותו.',
  'Not authenticated': 'יש להתחבר כדי לקבל את השובר.',
  'That voucher is already shared': 'השובר שלכם כבר משותף עם חשבון אחר.',
}

function translate(message: string) {
  const key = Object.keys(ERROR_TRANSLATIONS).find((k) => message.includes(k))
  return key ? ERROR_TRANSLATIONS[key] : message
}

export function ClaimShare() {
  const { token } = useParams<{ token: string }>()
  const { claimShare, linkShare } = useVouchers()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
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

  async function handleLink() {
    if (!token || state.kind !== 'done' || !state.voucher) return
    setLinking(true)
    setLinkError(null)
    const { error } = await linkShare(token, state.voucher.id)
    setLinking(false)
    if (error) setLinkError(translate(error))
    else setLinked(true)
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
      {state.kind === 'loading' && (
        <>
          <div className="text-3xl">🎁</div>
          <p className="mt-2 text-sm text-slate-500">בודק את קישור השיתוף…</p>
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

      {state.kind === 'done' && state.outcome === 'code_conflict' && !linked && (
        <>
          <div className="text-3xl">🔗</div>
          <h1 className="mt-2 text-base font-semibold text-slate-900">כבר יש לכם שובר עם הקוד הזה</h1>
          {state.voucher && (
            <p className="mt-1 text-sm text-slate-600">
              {state.voucher.store_name} · <span className="font-mono">{state.voucher.code}</span>
            </p>
          )}
          <p className="mt-3 text-start text-sm text-slate-500">
            לא שינינו כלום. אפשר לקשר את השובר הקיים שלכם לשיתוף — ואז סימון כנוצל יחול על שני
            החשבונות, וגם הסטטוס הנוכחי של המשתף יחול על השובר שלכם. אם אלה שני שוברים שונים
            שבמקרה חולקים קוד, השאירו אותם נפרדים.
          </p>

          {linkError && <p className="mt-3 text-sm text-red-600">{linkError}</p>}

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleLink}
              disabled={linking}
              className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {linking ? 'מקשר…' : 'לקשר את השוברים'}
            </button>
            <Link
              to="/"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              להשאיר נפרד
            </Link>
          </div>
        </>
      )}

      {state.kind === 'done' && (state.outcome !== 'code_conflict' || linked) && (
        <>
          <div className="text-3xl">✅</div>
          <h1 className="mt-2 text-base font-semibold text-slate-900">
            {linked
              ? 'השוברים קושרו'
              : state.outcome === 'created'
                ? 'השובר נוסף לחשבון שלכם'
                : state.outcome === 'own_voucher'
                  ? 'זה השובר שלכם'
                  : 'השובר כבר קיים אצלכם'}
          </h1>
          {state.voucher && (
            <p className="mt-1 text-sm text-slate-600">
              {state.voucher.store_name} · <span className="font-mono">{state.voucher.code}</span>
            </p>
          )}
          {state.outcome !== 'own_voucher' && (
            <p className="mt-3 text-sm text-slate-500">
              מעכשיו, סימון השובר כנוצל באחד החשבונות יסמן אותו כנוצל גם בשני.
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
