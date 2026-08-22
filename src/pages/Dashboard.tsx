import { Link } from 'react-router-dom'
import { useVouchers } from '../context/VouchersContext'
import { VoucherCard } from '../components/VoucherCard'

export function Dashboard() {
  const { active, loading, error } = useVouchers()

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Active vouchers</h1>
        <Link
          to="/add"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Add
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && active.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div className="text-3xl">🎟️</div>
          <p className="mt-2 text-sm text-slate-500">No active vouchers yet.</p>
          <Link to="/add" className="mt-3 inline-block text-sm font-medium text-indigo-600">
            Add your first one
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {active.map((v) => (
          <VoucherCard key={v.id} voucher={v} />
        ))}
      </div>
    </div>
  )
}
