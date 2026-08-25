import { useEffect, useState } from 'react'
import { disablePush, enablePush, pushState, resolvePushState, type PushState } from '../lib/push'

/**
 * The reminders switch, plus an honest account of why it might not be offered.
 *
 * The interesting cases are the ones where a button would be a lie. On an
 * iPhone using Safari normally, Web Push does not exist at all until the app is
 * added to the Home Screen, so the panel explains that instead of rendering a
 * control that cannot work.
 */
export function PushSettings() {
  // The synchronous answer is the starting point so the panel does not flash
  // empty; whether a subscription actually exists needs an await, and until
  // that resolves 'granted' may be overstating things.
  const [state, setState] = useState<PushState>(pushState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    resolvePushState().then((resolved) => {
      if (!cancelled) setState(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleEnable() {
    setError(null)
    setBusy(true)
    const { state: next, error: err } = await enablePush()
    setBusy(false)
    setState(next)
    if (err) setError(err)
  }

  async function handleDisable() {
    setError(null)
    setBusy(true)
    const { error: err } = await disablePush()
    setBusy(false)
    if (err) setError(err)
    else setState(await resolvePushState())
  }

  if (state === 'unsupported') return null

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">התראות על שוברים שפגים</h2>
      <p className="mt-1 text-sm text-slate-600">
        תזכורת בשעה 10:00 שבוע לפני שהשובר פג, יום לפני, וביום עצמו — גם כשהאפליקציה סגורה.
      </p>

      {state === 'granted' && (
        <>
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            ✓ ההתראות פעילות במכשיר הזה
          </p>
          <button
            type="button"
            onClick={handleDisable}
            disabled={busy}
            className="mt-2 text-sm font-medium text-red-600 disabled:opacity-50"
          >
            {busy ? 'מבטל…' : 'ביטול ההתראות במכשיר הזה'}
          </button>
        </>
      )}

      {state === 'ready' && (
        <button
          type="button"
          onClick={handleEnable}
          disabled={busy}
          className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'מפעיל…' : '🔔 הפעלת התראות במכשיר הזה'}
        </button>
      )}

      {state === 'needs-install' && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">כדי לקבל התראות באייפון, התקינו את האפליקציה:</p>
          <ol className="mt-1 list-inside list-decimal space-y-0.5">
            <li>הקישו על כפתור השיתוף בסרגל התחתון</li>
            <li>בחרו "הוספה למסך הבית"</li>
            <li>פתחו את האפליקציה מסמל שנוסף למסך הבית</li>
          </ol>
          <p className="mt-1 text-xs">
            זו מגבלה של אפל: בספארי רגיל אין התראות לאתרים שנשמרו כלשונית.
          </p>
        </div>
      )}

      {state === 'ios-too-old' && (
        <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          התראות דורשות iOS 16.4 ומעלה. עדכנו את גרסת המערכת כדי להפעיל אותן.
        </p>
      )}

      {state === 'denied' && (
        <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          ההתראות חסומות בדפדפן. אפשר להפעיל אותן מחדש בהגדרות האתר במכשיר, ואז לרענן את הדף.
        </p>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
