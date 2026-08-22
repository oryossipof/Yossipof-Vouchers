import { useEffect, useState } from 'react'
import type { Voucher } from '../types'
import { useVouchers } from '../context/VouchersContext'

const currency = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })
const dateFormatter = new Intl.DateTimeFormat('he-IL')

export function VoucherCard({ voucher }: { voucher: Voucher }) {
  const { getPhotoUrl, markAsUsed, markAsActive, removeVoucher } = useVouchers()
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [revealCode, setRevealCode] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (voucher.photo_path) {
      getPhotoUrl(voucher.photo_path).then((url) => {
        if (!cancelled) setPhotoUrl(url)
      })
    }
    return () => {
      cancelled = true
    }
  }, [voucher.photo_path, getPhotoUrl])

  async function handleMarkUsed() {
    setBusy(true)
    const { error } = await markAsUsed(voucher.id)
    setActionError(error)
    setBusy(false)
  }

  async function handleMarkActive() {
    setBusy(true)
    const { error } = await markAsActive(voucher.id)
    setActionError(error)
    setBusy(false)
  }

  async function handleDelete() {
    setBusy(true)
    const { error } = await removeVoucher(voucher.id, voucher.photo_path)
    setActionError(error)
    setBusy(false)
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {photoUrl && (
        <img src={photoUrl} alt={`שובר ${voucher.store_name}`} className="h-36 w-full object-cover" />
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">{voucher.store_name}</h3>
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

        {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

        {voucher.status === 'active' && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleMarkUsed}
              disabled={busy}
              className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              סימון כנוצל
            </button>
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                מחיקה
              </button>
            ) : (
              <button
                onClick={handleDelete}
                disabled={busy}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                לאשר?
              </button>
            )}
          </div>
        )}

        {voucher.status === 'used' && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleMarkActive}
              disabled={busy}
              className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              החזרה לפעילים
            </button>
            {!confirmingDelete ? (
              <button
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                מחיקה
              </button>
            ) : (
              <button
                onClick={handleDelete}
                disabled={busy}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                לאשר?
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
