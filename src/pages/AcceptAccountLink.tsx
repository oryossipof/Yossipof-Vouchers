import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useVouchers, type LinkOutcome } from '../context/VouchersContext'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; outcome: LinkOutcome; email: string | null }

const ERROR_TRANSLATIONS: Record<string, string> = {
  'Account link invite not found': 'קישור החיבור אינו תקין, כבר נוצל, או שבוטל על ידי מי ששלח אותו.',
  'Account link invite has expired': 'תוקף קישור החיבור פג. בקשו קישור חדש.',
  'Not authenticated': 'יש להתחבר כדי לחבר את החשבונות.',
}

function translate(message: string) {
  const key = Object.keys(ERROR_TRANSLATIONS).find((k) => message.includes(k))
  return key ? ERROR_TRANSLATIONS[key] : message
}

const HEADINGS: Record<LinkOutcome, string> = {
  linked: 'החשבונות חוברו',
  already_linked: 'החשבונות כבר מחוברים',
  own_invite: 'זה הקישור שלכם',
}

export function AcceptAccountLink() {
  const { token } = useParams<{ token: string }>()
  const { acceptAccountLinkInvite } = useVouchers()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const accepted = useRef(false)

  useEffect(() => {
    if (!token || accepted.current) return
    accepted.current = true

    acceptAccountLinkInvite(token).then(({ error, outcome, email }) => {
      if (error || !outcome) setState({ kind: 'error', message: translate(error ?? 'שגיאה') })
      else setState({ kind: 'done', outcome, email })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
      {state.kind === 'loading' && (
        <>
          <div className="text-3xl">🔗</div>
          <p className="mt-2 text-sm text-slate-500">מחבר את החשבונות…</p>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <div className="text-3xl">⚠️</div>
          <h1 className="mt-2 text-base font-semibold text-slate-900">לא הצלחנו לחבר את החשבונות</h1>
          <p className="mt-2 text-sm text-red-600">{state.message}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-medium text-indigo-600">
            חזרה לשוברים
          </Link>
        </>
      )}

      {state.kind === 'done' && (
        <>
          <div className="text-3xl">{state.outcome === 'own_invite' ? '🔗' : '✅'}</div>
          <h1 className="mt-2 text-base font-semibold text-slate-900">{HEADINGS[state.outcome]}</h1>

          {state.email && <p className="mt-1 break-all text-sm text-slate-600">{state.email}</p>}

          {state.outcome === 'own_invite' ? (
            <p className="mt-3 text-start text-sm text-slate-500">
              זהו הקישור שיצרתם כדי לחבר חשבון אחר. שלחו אותו למי שאיתו תרצו לנהל רשימת שוברים
              משותפת — פתיחה שלו בחשבון שלכם אינה עושה דבר.
            </p>
          ) : (
            <p className="mt-3 text-start text-sm text-slate-500">
              מעכשיו זו רשימת שוברים אחת לשני החשבונות: כל הוספה, עריכה, סימון כנוצל או מחיקה יופיעו
              מיד אצל שניכם, בלי לשתף כל שובר בנפרד. אפשר לנתק את החיבור בכל רגע במסך החשבון.
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
