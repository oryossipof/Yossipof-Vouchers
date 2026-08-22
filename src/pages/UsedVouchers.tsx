import { useVouchers } from '../context/VouchersContext'
import { VoucherCard } from '../components/VoucherCard'

export function UsedVouchers() {
  const { used, loading, error } = useVouchers()

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">Used vouchers</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && used.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div className="text-3xl">📦</div>
          <p className="mt-2 text-sm text-slate-500">No used vouchers yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {used.map((v) => (
          <VoucherCard key={v.id} voucher={v} />
        ))}
      </div>
    </div>
  )
}
