import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Voucher, VoucherFormInput } from '../types'
import { useVouchers } from '../context/VouchersContext'
import { formatDate, maskDateInput, parseDate, todayInIsrael } from '../lib/expiry'

interface VoucherFormProps {
  voucher?: Voucher
  /**
   * Fields to drop into the form after it has mounted -- what the SMS parser
   * found. Only the keys present are applied, so a partial parse leaves
   * anything the user has already typed alone.
   */
  prefill?: Partial<VoucherFormInput> | null
  submitLabel: string
  savingLabel: string
  onSubmit: (input: VoucherFormInput) => Promise<{ error: string | null }>
  onCancel?: () => void
}

export function VoucherForm({
  voucher,
  prefill,
  submitLabel,
  savingLabel,
  onSubmit,
  onCancel,
}: VoucherFormProps) {
  const { findVoucherByCode, getPhotoUrl } = useVouchers()

  const [storeName, setStoreName] = useState(voucher?.store_name ?? '')
  const [code, setCode] = useState(voucher?.code ?? '')
  const [amount, setAmount] = useState(voucher?.amount != null ? String(voucher.amount) : '')
  const [note, setNote] = useState(voucher?.note ?? '')
  // Held as the dd/mm/yyyy text the user sees; converted to ISO only on save.
  const [expiry, setExpiry] = useState(formatDate(voucher?.expires_at ?? null))
  // Backs the calendar button: a real date input, kept out of the layout, so
  // the platform's own picker can be opened without it dictating the format
  // shown in the field.
  const datePickerRef = useRef<HTMLInputElement>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const duplicate = findVoucherByCode(code, voucher?.id)

  const trimmedExpiry = expiry.trim()
  const parsedExpiry = parseDate(trimmedExpiry)
  // Only complain once the field is full: eight digits typed and still no
  // valid date means something like 31/02/2026, not a half-finished entry.
  const expiryInvalid = trimmedExpiry.length === 10 && parsedExpiry === null
  // ISO dates compare correctly as plain strings, so this needs no date maths.
  const expiryAlreadyPast = parsedExpiry !== null && parsedExpiry < todayInIsrael()

  function openDatePicker() {
    const el = datePickerRef.current
    if (!el) return
    // Seed it with whatever is typed, or today when the field is empty, so the
    // picker opens on the current month rather than on 1970.
    el.value = parsedExpiry ?? todayInIsrael()
    // showPicker is the supported way in; older browsers fall back to a click,
    // which opens the picker on the (visually hidden but focusable) input.
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.click()
  }

  // Applying the parsed fields during render rather than from an effect is
  // React's documented way to adjust state when a prop changes: it avoids the
  // extra commit an effect would cause, so the form never paints empty for a
  // frame after a successful parse.
  const [appliedPrefill, setAppliedPrefill] = useState(prefill)
  if (prefill !== appliedPrefill) {
    setAppliedPrefill(prefill)
    // Only the fields the parser actually found, so a partial parse leaves
    // anything already typed alone.
    if (prefill?.store_name != null) setStoreName(prefill.store_name)
    if (prefill?.code != null) setCode(prefill.code)
    if (prefill?.amount != null) setAmount(String(prefill.amount))
    if (prefill?.note != null) setNote(prefill.note)
    if (prefill?.expires_at != null) setExpiry(formatDate(prefill.expires_at))
  }

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

    if (trimmedExpiry !== '' && parsedExpiry === null) {
      setError('תאריך התפוגה אינו תקין. הקלידו אותו בצורה דד/חח/שששש, לדוגמה 30/11/2026.')
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
      expires_at: parsedExpiry,
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
        <label className="mb-1 block text-sm font-medium text-slate-700">תוקף עד (אופציונלי)</label>
        {/* Typing and picking, rather than one or the other. The visible field
            is plain text with a mask, because a bare <input type="date"> renders
            in the device's locale and would show some users mm/dd/yyyy — for a
            date like 03/04 that silently means a different day. The calendar
            button opens the platform picker for people who would rather not
            type, and its result is written back as dd/mm/yyyy. */}
        <div className="relative">
          <input
            value={expiry}
            onChange={(e) => setExpiry(maskDateInput(e.target.value))}
            inputMode="numeric"
            placeholder="dd/mm/yyyy"
            maxLength={10}
            dir="ltr"
            className={`w-full rounded-lg border py-2 pe-3 ps-11 text-start text-sm focus:outline-none focus:ring-1 ${
              expiryInvalid
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500'
            }`}
          />
          <button
            type="button"
            onClick={openDatePicker}
            aria-label="בחירת תאריך מלוח שנה"
            title="בחירה מלוח שנה"
            className="absolute inset-y-0 start-0 flex w-10 items-center justify-center text-slate-400 hover:text-indigo-600"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
            </svg>
          </button>
          {/* Visually hidden, but still focusable and clickable so the fallback
              works where showPicker is unavailable. */}
          <input
            ref={datePickerRef}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => setExpiry(formatDate(e.target.value))}
            className="pointer-events-none absolute bottom-0 start-0 h-0 w-0 opacity-0"
          />
        </div>
        {expiryInvalid && (
          <p className="mt-1 text-sm text-red-600">תאריך זה אינו קיים. לדוגמה: 30/11/2026.</p>
        )}
        {!expiryInvalid && expiryAlreadyPast && (
          <p className="mt-1 text-sm text-amber-700">
            התאריך כבר עבר — השובר יישמר בלשונית "פג תוקף".
          </p>
        )}
        {!expiryInvalid && !expiryAlreadyPast && (
          <p className="mt-1 text-xs text-slate-400">השאירו ריק אם לשובר אין תאריך תפוגה.</p>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">הערה (אופציונלי)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="לדוגמה: לא כולל מבצעים, לא כולל פריטי סייל"
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
