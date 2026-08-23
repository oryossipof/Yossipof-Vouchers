import { useEffect, useState } from 'react'
import { useVouchers } from '../context/VouchersContext'
import { whatsappUrl } from '../lib/share'

const ERROR_TRANSLATIONS: Record<string, string> = {
  'Not authenticated': 'יש להתחבר כדי לחבר חשבונות.',
}

function translate(message: string) {
  const key = Object.keys(ERROR_TRANSLATIONS).find((k) => message.includes(k))
  return key ? ERROR_TRANSLATIONS[key] : message
}

function inviteMessage(link: string) {
  return [
    'בואו נחבר בין החשבונות שלנו באפליקציית השוברים.',
    'אחרי החיבור נראה את אותם שוברים בדיוק: כל הוספה, עריכה, סימון כנוצל או מחיקה יופיעו אצל שנינו, בלי לשתף כל שובר בנפרד.',
    link,
  ].join('\n')
}

/**
 * Invites another account to link with this one. The link is single use and
 * expires after a week, and minting a new one retires the previous invite —
 * it hands over the whole collection, so only the newest should ever be live.
 */
export function LinkAccountDialog({ onClose }: { onClose: () => void }) {
  const { createAccountLinkInvite } = useVouchers()
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    createAccountLinkInvite().then(({ url, error }) => {
      if (cancelled) return
      if (error) setError(translate(error))
      else setLink(url)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('העתקה נכשלה. אפשר לסמן את הקישור ולהעתיק ידנית.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-account-dialog-title"
        className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="link-account-dialog-title" className="text-base font-semibold text-slate-900">
          חיבור חשבון
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          מי שילחץ על הקישור יתחבר לחשבון שלכם, ומאותו רגע תנהלו רשימת שוברים אחת: כל הוספה, עריכה,
          סימון כנוצל או מחיקה יופיעו אצל שניכם — בלי לשתף כל שובר בנפרד.
        </p>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          שלחו את הקישור רק למי שאתם סומכים עליו: הוא נותן גישה מלאה לכל השוברים שלכם, כולל מחיקה.
          הקישור תקף לשבוע ולשימוש אחד בלבד, ויצירת קישור חדש מבטלת את הקודם.
        </p>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!link && !error && <p className="mt-3 text-sm text-slate-500">מכין קישור…</p>}

        {link && (
          <>
            <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {link}
            </p>

            <a
              href={whatsappUrl(inviteMessage(link))}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <span>שליחה בוואטסאפ</span>
              <span aria-hidden="true">💬</span>
            </a>

            <button
              type="button"
              onClick={handleCopy}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {copied ? 'הקישור הועתק ✓' : 'העתקת הקישור'}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
        >
          סגירה
        </button>
      </div>
    </div>
  )
}
