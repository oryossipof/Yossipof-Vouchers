import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVouchers } from '../context/VouchersContext'

export function AddVoucher() {
  const { addVoucher } = useVouchers()
  const navigate = useNavigate()

  const [storeName, setStoreName] = useState('')
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setPhotoFile(file)
    setPhotoPreview(file ? URL.createObjectURL(file) : null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const parsedAmount = parseFloat(amount)
    if (!storeName.trim() || !code.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please fill in store name, code, and a valid amount.')
      return
    }

    setSaving(true)
    const { error } = await addVoucher({
      store_name: storeName.trim(),
      code: code.trim(),
      amount: parsedAmount,
      photoFile,
    })
    setSaving(false)

    if (error) setError(error)
    else navigate('/')
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Add a voucher</h1>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Store name *</label>
          <input
            required
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="e.g. Amazon, Starbucks"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Code *</label>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Voucher / gift card code"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Amount / credit *</label>
          <input
            required
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Photo (optional)</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
          />
          {photoPreview && (
            <img src={photoPreview} alt="Preview" className="mt-3 h-40 w-full rounded-lg object-cover" />
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save voucher'}
        </button>
      </form>
    </div>
  )
}
