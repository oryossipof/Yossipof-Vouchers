import { useEffect, useState, type FormEvent } from 'react'
import type { Voucher, VoucherFormInput } from '../types'
import { useVouchers } from '../context/VouchersContext'

interface VoucherFormProps {
  voucher?: Voucher
  submitLabel: string
  savingLabel: string
  onSubmit: (input: VoucherFormInput) => Promise<{ error: string | null }>
  onCancel?: () => void
}

export function VoucherForm({ voucher, submitLabel, savingLabel, onSubmit, onCancel }: VoucherFormProps) {
  const { findVoucherByCode, getPhotoUrl } = useVouchers()

  const [storeName, setStoreName] = useState(voucher?.store_name ?? '')
  const [code, setCode] = useState(voucher?.code ?? '')
  const [amount, setAmount] = useState(voucher?.amount != null ? String(voucher.amount) : '')
  const [note, setNote] = useState(voucher?.note ?? '')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const duplicate = findVoucherByCode(code, voucher?.id)

  useEffect(() => {
    let cancelled = false
    if (voucher?.photo_path) {
      getPhotoUrl(voucher.photo_path).then((url) => {
        if (!cancelled) setExistingPhotoUrl(url)
      })
    }
    return () => {
      cancelled = true
    }
  }, [voucher?.photo_path, getPhotoUrl])

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setPhotoFile(file)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
    if (file) setRemovePhoto(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!storeName.trim() || !code.trim()) {
      setError('נא למלא שם חנות וקוד.')
      return
    }

    if (duplicate) {
      setError(
        `קוד זה כבר קיים אצלכם — שובר של ${duplicate.store_name} (${
          duplicate.status === 'used' ? 'כבר נוצל' : 'פעיל'
        }).`
      )
      return
    }

    const trimmedAmount = amount.trim()
    let parsedAmount: number | null = null
    if (trimmedAmount !== '') {
      parsedAmount = parseFloat(trimmedAmount)
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        setError('הסכום חייב להיות מספר גדול מאפס, או שאפשר להשאיר אותו ריק.')
        return
      }
    }

    setSaving(true)
    const { error } = await onSubmit({
      store_name: storeName.trim(),
      code: code.trim(),
      amount: parsedAmount,
      note: note.trim() === '' ? null : note.trim(),
      photoFile,
      removePhoto,
    })
    setSaving(false)

    if (error) setError(error)
  }

  const showExistingPhoto = existingPhotoUrl && !photoPreview && !removePhoto

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">שם חנות *</label>
        <input
          required
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          placeholder="לדוגמה: איקאה, קפה קפה"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">קוד *</label>
        <input
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="קוד השובר / כרטיס המתנה"
          className={`w-full rounded-lg border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 ${
            duplicate
              ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-500'
              : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500'
          }`}
        />
        {duplicate && (
          <p className="mt-1 text-sm text-amber-700">
            קוד זה כבר קיים אצלכם — שובר של {duplicate.store_name} (
            {duplicate.status === 'used' ? 'כבר נוצל' : 'פעיל'}).
          </p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">סכום / יתרה (אופציונלי)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="השאירו ריק אם אין סכום כספי"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">הערה (אופציונלי)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="לדוגמה: תקף עד סוף השנה, לא כולל מבצעים"
          className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">תמונה (אופציונלי)</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoChange}
          className="w-full text-sm text-slate-600 file:me-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
        />
        {photoPreview && (
          <img src={photoPreview} alt="תצוגה מקדימה" className="mt-3 h-40 w-full rounded-lg object-cover" />
        )}
        {showExistingPhoto && (
          <div className="mt-3">
            <img src={existingPhotoUrl} alt="התמונה הנוכחית" className="h-40 w-full rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => setRemovePhoto(true)}
              className="mt-2 text-sm font-medium text-red-600"
            >
              הסרת התמונה
            </button>
          </div>
        )}
        {removePhoto && !photoPreview && (
          <p className="mt-2 text-sm text-slate-500">
            התמונה תוסר בשמירה.{' '}
            <button type="button" onClick={() => setRemovePhoto(false)} className="font-medium text-indigo-600">
              ביטול
            </button>
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? savingLabel : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            ביטול
          </button>
        )}
      </div>
    </form>
  )
}
