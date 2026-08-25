import { useState } from 'react'
import { useVouchers } from '../context/VouchersContext'
import { VoucherCard } from '../components/VoucherCard'
import { StoreSearchInput } from '../components/StoreSearchInput'

export function ExpiredVouchers() {
  const { expired, loading, error } = useVouchers()
  const [query, setQuery] = useState('')

  const filtered = expired.filter((v) =>
    v.store_name.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">שוברים שפג תוקפם</h1>

      {expired.length > 0 && <StoreSearchInput value={query} onChange={setQuery} />}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-slate-500">טוען…</p>}

      {!loading && expired.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <div className="text-3xl">⏰</div>
          <p className="mt-2 text-sm text-slate-500">אין שוברים שפג תוקפם.</p>
        </div>
      )}

      {!loading && expired.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-slate-500">לא נמצאו שוברים בשם חנות זה.</p>
      )}

      {/* The cards keep their full set of controls, including "mark as used":
          a store may honour a coupon past its date, and that should still be
          recordable. Deleting is the other common thing to do from here. */}
      <div className="space-y-3">
        {filtered.map((v) => (
          <VoucherCard key={v.id} voucher={v} />
        ))}
      </div>
    </div>
  )
}
