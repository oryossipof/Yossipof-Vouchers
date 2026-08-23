import { useEffect, useState } from 'react'
import type { Voucher } from '../types'
import { useVouchers } from '../context/VouchersContext'
import { shareOneMessage, translateShareError, whatsappUrl } from '../lib/share'

export function ShareDialog({ voucher, onClose }: { voucher: Voucher; onClose: () => void }) {
  const { createShareLink } = useVouchers()
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    createShareLink(voucher.id).then(({ url, error }) => {
      if (cancelled) return
      if (error) setError(translateShareError(error))
      else setLink(url)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucher.id])

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
        aria-labelledby="share-dialog-title"
        className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 id="share-dialog-title" className="text-base font-semibold text-slate-900">
          שיתוף השובר של {voucher.store_name}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          מי שילחץ על הקישור יקבל את השובר לחשבון שלו. כששובר משותף מסומן כנוצל באחד החשבונות, הוא
          מסומן כנוצל גם בשאר.
        </p>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {!link && !error && <p className="mt-3 text-sm text-slate-500">מכין קישור…</p>}

        {link && (
          <>
            <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {link}
            </p>

            <a
              href={whatsappUrl(shareOneMessage(voucher, link))}
              target="_blank"
              rel="noreferrer"
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <span>שיתוף בוואטסאפ</span>
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
