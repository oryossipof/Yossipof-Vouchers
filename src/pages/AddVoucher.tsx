import { useNavigate } from 'react-router-dom'
import { useVouchers } from '../context/VouchersContext'
import { VoucherForm } from '../components/VoucherForm'
import type { VoucherFormInput } from '../types'

export function AddVoucher() {
  const { addVoucher } = useVouchers()
  const navigate = useNavigate()

  async function handleSubmit(input: VoucherFormInput) {
    const { error } = await addVoucher(input)
    if (!error) navigate('/')
    return { error }
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">הוספת שובר</h1>
      <VoucherForm submitLabel="שמירת שובר" savingLabel="שומר…" onSubmit={handleSubmit} />
    </div>
  )
}
