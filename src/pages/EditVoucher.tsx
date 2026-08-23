import { useNavigate, useParams } from 'react-router-dom'
import { useVouchers } from '../context/VouchersContext'
import { VoucherForm } from '../components/VoucherForm'
import type { VoucherFormInput } from '../types'

export function EditVoucher() {
  const { id } = useParams<{ id: string }>()
  const { getVoucher, updateVoucher, loading, isOwner, memberCount } = useVouchers()
  const navigate = useNavigate()

  const voucher = id ? getVoucher(id) : null

  if (loading) return <p className="text-sm text-slate-500">טוען…</p>

  if (!voucher) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">השובר לא נמצא.</p>
        <button onClick={() => navigate('/')} className="mt-3 text-sm font-medium text-indigo-600">
          חזרה לשוברים
        </button>
      </div>
    )
  }

  async function handleSubmit(input: VoucherFormInput) {
    if (!id) return { error: 'השובר לא נמצא' }
    const { error } = await updateVoucher(id, input)
    if (!error) navigate(voucher?.status === 'used' ? '/used' : '/')
    return { error }
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">עריכת שובר</h1>
      {(memberCount(voucher.id) > 0 || !isOwner(voucher)) && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          שובר זה משותף. כל שינוי כאן — שם, קוד, סכום, הערה או תמונה — יופיע מיד בכל החשבונות
          שהשובר משותף איתם.
        </p>
      )}
      <VoucherForm
        voucher={voucher}
        submitLabel="שמירת שינויים"
        savingLabel="שומר…"
        onSubmit={handleSubmit}
        onCancel={() => navigate(-1)}
      />
    </div>
  )
}
