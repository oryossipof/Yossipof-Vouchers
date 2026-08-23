import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Voucher } from '../types'
import { useVouchers } from '../context/VouchersContext'
import { useAuth } from '../context/AuthContext'
import { ConfirmDialog } from './ConfirmDialog'
import { ShareDialog } from './ShareDialog'

const currency = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })
const dateFormatter = new Intl.DateTimeFormat('he-IL')

type PendingAction = 'used' | 'active' | 'delete' | null

const iconButtonClass =
  'rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-50'

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M4 20h4l10-10-4-4L4 16v4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 6.5l4 4" strokeLinecap="round" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3" strokeLinecap="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function VoucherCard({ voucher }: { voucher: Voucher }) {
  const { getPhotoUrl, markAsUsed, markAsActive, removeVoucher, leaveShare, isOwner, memberCount } =
    useVouchers()
  const navigate = useNavigate()
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction>(null)
  const [sharing, setSharing] = useState(false)
  const [revealCode, setRevealCode] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useAuth()
  const owner = isOwner(voucher)
  const others = memberCount(voucher.id)
  // The voucher is a single shared row, so it counts as shared either when
  // someone else has joined it or when you are the one who joined.
  const isShared = others > 0 || !owner
  // Only the owner hands out links, and only the owner can delete for everyone.
  const canShare = owner

  useEffect(() => {
    let cancelled = false
    if (voucher.photo_path) {
      getPhotoUrl(voucher.photo_path).then((url) => {
        if (!cancelled) setPhotoUrl(url)
      })
    } else {
      setPhotoUrl(null)
    }
    return () => {
      cancelled = true
    }
  }, [voucher.photo_path, getPhotoUrl])

  async function runPendingAction() {
    if (!pending) return
    setBusy(true)
    const { error } =
      pending === 'used'
        ? await markAsUsed(voucher.id)
        : pending === 'active'
          ? await markAsActive(voucher.id)
          : owner
            ? await removeVoucher(voucher.id, voucher.photo_path)
            : await leaveShare(voucher.id)
    setBusy(false)
    setPending(null)
    setActionError(error)
  }

  const confirmCopy = {
    used: {
      title: 'לסמן את השובר כנוצל?',
      message: isShared
        ? `השובר של ${voucher.store_name} יעבור לרשימת השוברים שנוצלו, גם אצל מי שהשובר משותף איתו.`
        : `השובר של ${voucher.store_name} יעבור לרשימת השוברים שנוצלו. תמיד אפשר להחזיר אותו לפעילים.`,
      confirmLabel: 'כן, נוצל',
      tone: 'primary' as const,
    },
    active: {
      title: 'להחזיר את השובר לפעילים?',
      message: isShared
        ? `השובר של ${voucher.store_name} יחזור לרשימת השוברים הפעילים, גם אצל מי שהשובר משותף איתו.`
        : `השובר של ${voucher.store_name} יחזור לרשימת השוברים הפעילים.`,
      confirmLabel: 'כן, להחזיר',
      tone: 'primary' as const,
    },
    delete: owner
      ? {
          title: 'למחוק את השובר?',
          message: isShared
            ? `השובר של ${voucher.store_name} יימחק לצמיתות — גם מהחשבונות שהוא משותף איתם. לא ניתן לשחזר פעולה זו.`
            : `השובר של ${voucher.store_name} יימחק לצמיתות. לא ניתן לשחזר פעולה זו.`,
          confirmLabel: 'כן, למחוק',
          tone: 'danger' as const,
        }
      : {
          title: 'להסיר את השובר מהחשבון שלכם?',
          message: `השובר של ${voucher.store_name} שותף איתכם. הוא יוסר מהרשימה שלכם, אך יישאר אצל הבעלים ואצל שאר החשבונות.`,
          confirmLabel: 'כן, להסיר',
          tone: 'danger' as const,
        },
  }

  const dialog = pending ? confirmCopy[pending] : null

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {photoUrl && (
        <img src={photoUrl} alt={`שובר ${voucher.store_name}`} className="h-36 w-full object-cover" />
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">
              {voucher.store_name}
              {isShared && (
                <span className="ms-2 rounded-full bg-emerald-50 px-2 py-0.5 align-middle text-xs font-medium text-emerald-700">
                  {owner ? `משותף · ${others}` : 'שותפו איתכם'}
                </span>
              )}
            </h3>
            <p className="text-sm text-slate-500">
              נוסף בתאריך {dateFormatter.format(new Date(voucher.created_at))}
              {voucher.used_at && ` · נוצל בתאריך ${dateFormatter.format(new Date(voucher.used_at))}`}
            </p>
          </div>
          {voucher.amount !== null && (
            <span className="whitespace-nowrap rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">
              {currency.format(voucher.amount)}
            </span>
          )}
        </div>

        <button
          onClick={() => setRevealCode((v) => !v)}
          className="mt-3 w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-start font-mono text-sm text-slate-700"
        >
          {revealCode ? voucher.code : '•'.repeat(Math.max(voucher.code.length, 8))}
          <span className="ms-2 text-xs text-slate-400">{revealCode ? '(הקישו להסתרה)' : '(הקישו לחשיפה)'}</span>
        </button>

        {voucher.note && (
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {voucher.note}
          </p>
        )}

        {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

        <div className="mt-4 flex items-center gap-2">
          {voucher.status === 'active' ? (
            <button
              onClick={() => setPending('used')}
              disabled={busy}
              className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              סימון כנוצל
            </button>
          ) : (
            <button
              onClick={() => setPending('active')}
              disabled={busy}
              className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              החזרה לפעילים
            </button>
          )}

          <button
            onClick={() => navigate(`/edit/${voucher.id}`)}
            disabled={busy}
            aria-label="עריכת השובר"
            title="עריכה"
            className={iconButtonClass}
          >
            <EditIcon />
          </button>

          {canShare && (
            <button
              onClick={() => setSharing(true)}
              disabled={busy}
              aria-label="שיתוף השובר"
              title="שיתוף"
              className={iconButtonClass}
            >
              <ShareIcon />
            </button>
          )}

          <button
            onClick={() => setPending('delete')}
            disabled={busy}
            aria-label={owner ? 'מחיקת השובר' : 'הסרת השובר מהחשבון שלכם'}
            title={owner ? 'מחיקה' : 'הסרה'}
            className={`${iconButtonClass} hover:border-red-200 hover:bg-red-50 hover:text-red-600`}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {dialog && (
        <ConfirmDialog
          open
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          tone={dialog.tone}
          busy={busy}
          onConfirm={runPendingAction}
          onCancel={() => setPending(null)}
        />
      )}

      {sharing && <ShareDialog voucher={voucher} onClose={() => setSharing(false)} />}
    </div>
  )
}
