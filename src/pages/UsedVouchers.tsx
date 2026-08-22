import { useState } from 'react'
import { useVouchers } from '../context/VouchersContext'
import { VoucherCard } from '../components/VoucherCard'
import { StoreSearchInput } from '../components/StoreSearchInput'

export function UsedVouchers() {
  const { used, loading, error } = useVouchers()
  const [query, setQuery] = useState('')

  const filtered = used.filter((v) => v.store_name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">שוברים שנוצלו</h1>

      {used.length > 0 && <StoreSearchInput value={query} onChange={setQuery} />}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">טוען…</p>}

      {!loading && used.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div className="text-3xl">📦</div>
          <p className="mt-2 text-sm text-slate-500">אין עדיין שוברים שנוצלו.</p>
        </div>
      )}

      {!loading && used.length > 0 && filtered.length === 0 && (
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
