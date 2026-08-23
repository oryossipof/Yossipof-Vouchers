import { useEffect, useState } from 'react'
import type { Voucher } from '../types'
import { useVouchers } from '../context/VouchersContext'
import { shareAllMessage, translateShareError, whatsappUrl } from '../lib/share'

/**
 * "Share all": one link covering every voucher passed in, sent as a single
 * WhatsApp message. The caller decides which vouchers qualify — only ones the
 * user owns can be shared, so vouchers shared *with* them are left out.
 */
export function ShareAllDialog({
  vouchers,
  excludedCount,
  onClose,
}: {
  vouchers: Voucher[]
  excludedCount: number
  onClose: () => void
}) {
  const { createShareAllLink } = useVouchers()
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // A stable dependency for the effect: the array identity changes on every
  // render of the parent, the set of ids does not.
  const idsKey = vouchers.map((v) => v.id).join(',')

  useEffect(() => {
    let cancelled = false
    const ids = idsKey ? idsKey.split(',') : []
    createShareAllLink(ids).then(({ url, error }) => {
      if (cancelled) return
      if (error) setError(translateShareError(error))
      else setLink(url)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

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
        aria-labelledby="share-all-dialog-title"
        className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="share-all-dialog-title" className="text-base font-semibold text-slate-900">
          שיתוף כל השוברים ({vouchers.length})
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          קישור אחד לכל השוברים. מי שילחץ עליו יקבל את כולם בבת אחת, וכל שובר משותף שיסומן כנוצל
          יסומן כך בכל החשבונות.
        </p>

        {/* Named, not just counted: the sender should see exactly what goes out. */}
        <ul className="mt-3 max-h-32 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {vouchers.map((v) => (
            <li key={v.id} className="truncate">
              • {v.store_name}
            </li>
          ))}
        </ul>

        {excludedCount > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            {excludedCount === 1
              ? 'שובר אחד ששותף איתכם אינו נכלל — רק הבעלים יכול לשתף אותו הלאה.'
              : `${excludedCount} שוברים ששותפו איתכם אינם נכללים — רק הבעלים יכול לשתף אותם הלאה.`}
          </p>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!link && !error && <p className="mt-3 text-sm text-slate-500">מכין קישור…</p>}

        {link && (
          <>
            <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {link}
            </p>

            <a
              href={whatsappUrl(shareAllMessage(vouchers, link))}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <span>שיתוף הכל בוואטסאפ</span>
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
