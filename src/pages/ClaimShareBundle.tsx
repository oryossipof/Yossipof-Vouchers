import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useVouchers, type BundleClaimItem } from '../context/VouchersContext'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; items: BundleClaimItem[] }

const ERROR_TRANSLATIONS: Record<string, string> = {
  'Share link not found': 'קישור השיתוף אינו תקין או שכבר בוטל.',
  'Share link has expired': 'תוקף קישור השיתוף פג. בקשו קישור חדש ממי ששיתף.',
  'Not authenticated': 'יש להתחבר כדי לקבל את השוברים.',
}

function translate(message: string) {
  const key = Object.keys(ERROR_TRANSLATIONS).find((k) => message.includes(k))
  return key ? ERROR_TRANSLATIONS[key] : message
}

function name(item: BundleClaimItem) {
  return item.voucher?.store_name ?? 'שובר'
}

/**
 * The receiving end of "share all": one link, several vouchers. The outcome
 * can be mixed — some newly added, some already held, some the viewer's own —
 * so the page reports each group rather than a single headline.
 */
export function ClaimShareBundle() {
  const { token } = useParams<{ token: string }>()
  const { claimShareBundle } = useVouchers()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const claimed = useRef(false)

  useEffect(() => {
    if (!token || claimed.current) return
    claimed.current = true

    claimShareBundle(token).then(({ error, items }) => {
      if (error) setState({ kind: 'error', message: translate(error) })
      else setState({ kind: 'done', items })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const items = state.kind === 'done' ? state.items : []
  const joined = items.filter((i) => i.outcome === 'joined')
  const already = items.filter((i) => i.outcome === 'already_member')
  const own = items.filter((i) => i.outcome === 'own_voucher')

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
      {state.kind === 'loading' && (
        <>
          <div className="text-3xl">🎁</div>
          <p className="mt-2 text-sm text-slate-500">מוסיף את השוברים לחשבון שלכם…</p>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <div className="text-3xl">⚠️</div>
          <h1 className="mt-2 text-base font-semibold text-slate-900">
            לא הצלחנו להוסיף את השוברים
          </h1>
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
            {joined.length === 0
              ? 'כל השוברים שבקישור כבר אצלכם'
              : joined.length === 1
                ? 'שובר אחד נוסף לחשבון שלכם'
                : `${joined.length} שוברים נוספו לחשבון שלכם`}
          </h1>

          {joined.length > 0 && (
            <ul className="mt-3 space-y-1 text-start text-sm text-slate-700">
              {joined.map((i, idx) => (
                <li key={i.voucher?.id ?? idx} className="truncate">
                  • {name(i)}
                </li>
              ))}
            </ul>
          )}

          {already.length > 0 && (
            <p className="mt-3 text-start text-sm text-slate-500">
              {already.length === 1
                ? `${name(already[0])} כבר היה משותף איתכם.`
                : `${already.length} שוברים בקישור כבר היו משותפים איתכם.`}
            </p>
          )}

          {own.length > 0 && (
            <p className="mt-1 text-start text-sm text-slate-500">
              {own.length === 1
                ? `${name(own[0])} הוא שובר שלכם.`
                : `${own.length} מהשוברים בקישור הם שלכם.`}
            </p>
          )}

          {joined.length > 0 && (
            <p className="mt-3 text-start text-sm text-slate-500">
              אלה אותם שוברים בדיוק, ולא עותקים. כל שינוי — סימון כנוצל, עריכת הפרטים, הערה או
              תמונה — יופיע מיד בכל החשבונות שהשובר משותף איתם.
            </p>
          )}

          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            לצפייה בשוברים
          </Link>
        </>
      )}
    </div>
  )
}
