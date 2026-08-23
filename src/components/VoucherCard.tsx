import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Voucher } from '../types'
import { useVouchers, type ShareParticipant } from '../context/VouchersContext'
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
  const {
    getPhotoUrl,
    markAsUsed,
    markAsActive,
    removeVoucher,
    leaveShare,
    isOwner,
    canManage,
    isLinked,
    linkedAccounts,
    memberCount,
    shareParticipants,
    removeMember,
  } = useVouchers()
  const navigate = useNavigate()
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingAction>(null)
  const [sharing, setSharing] = useState(false)
  const [revealCode, setRevealCode] = useState(false)
  const [showSharedWith, setShowSharedWith] = useState(false)
  const [removingMember, setRemovingMember] = useState<ShareParticipant | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { user } = useAuth()
  const owner = isOwner(voucher)
  // A linked account is not a guest: it can do everything the owner can.
  const manage = canManage(voucher)
  const viaLink = !owner && isLinked(voucher.user_id)
  const ownerEmail = linkedAccounts.find((a) => a.user_id === voucher.user_id)?.email
  const others = memberCount(voucher.id)
  const people = shareParticipants(voucher.id)
  // Also used as the title attribute, so desktop hover works without a tap.
  const sharedWithSummary = people.length
    ? `משותף עם: ${people.map((p) => p.email).join(', ')}`
    : 'עם מי השובר משותף'
  // The voucher is a single shared row, so it counts as shared either when
  // someone else has joined it or when you are the one who joined. A voucher
  // reaching you through a linked account is not "shared with you" in that
  // sense — it is part of the joint collection, and says so separately.
  const isShared = others > 0 || (!owner && !viaLink)
  // Handing out links and deleting for everyone are the owner's powers, held
  // by a linked account too.
  const canShare = manage

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
          : manage
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
    delete: manage
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

  async function handleRemoveMember() {
    if (!removingMember) return
    setBusy(true)
    const { error } = await removeMember(voucher.id, removingMember.user_id)
    setBusy(false)
    setRemovingMember(null)
    setActionError(error)
  }

  return (
    // No overflow-hidden on the card: it would clip the shared-with panel at
    // the card edge. The photo rounds its own top corners instead.
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      {photoUrl && (
        <img
          src={photoUrl}
          alt={`שובר ${voucher.store_name}`}
          className="h-36 w-full rounded-t-2xl object-cover"
        />
      )}
      <div className="p-4">
        {/* The panel is anchored to this whole row, not to the heading: the
            heading column is narrowed by the amount badge, and a panel pinned
            there runs off a 360px screen. */}
        <div className="relative flex items-start justify-between gap-3">
          <div>
            {/* The badge flows inline with the name so it sits straight after
                the text, rather than dropping onto a line of its own when the
                store name is long. */}
              <h3 className="font-semibold text-slate-900">
                {voucher.store_name}
                {viaLink && (
                  <span
                    title={`השובר נוסף על ידי ${ownerEmail ?? 'החשבון המקושר'}`}
                    className="ms-2 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 align-middle text-xs font-medium text-sky-700"
                  >
                    <span aria-hidden="true">🔗</span>
                    חשבון מקושר
                  </span>
                )}
                {isShared && (
                  <span className="ms-2 inline-flex items-center gap-1 align-middle">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {manage ? `משותף · ${others}` : 'שותפו איתכם'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSharedWith((v) => !v)}
                      aria-label="עם מי השובר משותף"
                      aria-expanded={showSharedWith}
                      title={sharedWithSummary}
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-200 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      i
                    </button>
                  </span>
                )}
              </h3>

              {isShared && showSharedWith && (
                <>
                  {/* Tap-away layer: a hover tooltip alone is unusable on a phone. */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowSharedWith(false)}
                    aria-hidden="true"
                  />
                  {/* Pinned to the left edge and opening rightwards (end-0 is
                      the left side in RTL), so the panel always has the full
                      card width to grow into, wherever the icon happens to sit
                      after a long store name. */}
                  <div className="absolute top-full z-20 mt-1 w-64 max-w-[calc(100vw-3rem)] rounded-xl border border-slate-200 bg-white p-3 text-start shadow-lg end-0">
                        <p className="text-xs font-semibold text-slate-500">השובר משותף עם</p>
                        <ul className="mt-2 space-y-1.5">
                          {people.map((p) => (
                            <li key={p.user_id} className="flex items-center justify-between gap-2">
                              <span className="break-all text-xs text-slate-700">
                                {p.email}
                                {p.is_owner && <span className="ms-1 text-slate-400">(הבעלים)</span>}
                                {p.user_id === user?.id && (
                                  <span className="ms-1 text-slate-400">(אתם)</span>
                                )}
                              </span>
                              {manage && !p.is_owner && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowSharedWith(false)
                                    setRemovingMember(p)
                                  }}
                                  aria-label={`הסרת ${p.email} מהשובר`}
                                  className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-red-600 hover:bg-red-50"
                                >
                                  הסרה
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {manage && others > 0 && (
                          <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-snug text-slate-400">
                            הסרת חשבון מבטלת גם את קישורי השיתוף הקיימים לשובר זה.
                          </p>
                        )}
                  </div>
                </>
              )}

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
            aria-label={manage ? 'מחיקת השובר' : 'הסרת השובר מהחשבון שלכם'}
            title={manage ? 'מחיקה' : 'הסרה'}
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

      {removingMember && (
        <ConfirmDialog
          open
          title="להסיר את החשבון מהשובר?"
          message={`${removingMember.email} לא יראה יותר את השובר של ${voucher.store_name}. כל קישורי השיתוף הקיימים לשובר זה יבוטלו, כדי שלא יהיה אפשר להצטרף איתם מחדש — תוכלו ליצור קישור חדש בכל עת.`}
          confirmLabel="כן, להסיר"
          tone="danger"
          busy={busy}
          onConfirm={handleRemoveMember}
          onCancel={() => setRemovingMember(null)}
        />
      )}

      {sharing && <ShareDialog voucher={voucher} onClose={() => setSharing(false)} />}
    </div>
  )
}
