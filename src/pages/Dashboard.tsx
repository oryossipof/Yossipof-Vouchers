import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useVouchers } from '../context/VouchersContext'
import { VoucherCard } from '../components/VoucherCard'
import { StoreSearchInput } from '../components/StoreSearchInput'

export function Dashboard() {
  const { active, loading, error } = useVouchers()
  const [query, setQuery] = useState('')

  const filtered = active.filter((v) => v.store_name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">שוברים פעילים</h1>
        <Link
          to="/add"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + הוספה
        </Link>
      </div>

      {active.length > 0 && <StoreSearchInput value={query} onChange={setQuery} />}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">טוען…</p>}

      {!loading && active.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div className="text-3xl">🎟️</div>
          <p className="mt-2 text-sm text-slate-500">אין עדיין שוברים פעילים.</p>
          <Link to="/add" className="mt-3 inline-block text-sm font-medium text-indigo-600">
            הוסיפו את הראשון שלכם
          </Link>
        </div>
      )}

      {!loading && active.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-slate-500">לא נמצאו שוברים בשם חנות זה.</p>
      )}

      <div className="space-y-3">
        {filtered.map((v) => (
          <VoucherCard key={v.id} voucher={v} />
        ))}
      </div>
    </div>
  )
}
