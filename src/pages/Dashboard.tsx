import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useVouchers } from '../context/VouchersContext'
import { VoucherCard } from '../components/VoucherCard'
import { ShareAllDialog } from '../components/ShareAllDialog'
import { StoreSearchInput } from '../components/StoreSearchInput'

export function Dashboard() {
  const { active, loading, error, canManage } = useVouchers()
  const [query, setQuery] = useState('')
  const [sharingAll, setSharingAll] = useState(false)

  const searching = query.trim().length > 0
  const filtered = active.filter((v) => v.store_name.toLowerCase().includes(query.trim().toLowerCase()))

  // "Share all" follows whatever the list is currently showing, so a search
  // doubles as a way to share just part of the collection. Only vouchers you
  // own — or that a linked account owns — can go out: a voucher merely shared
  // *with* you stays with its owner to pass on.
  const shareable = filtered.filter(canManage)
  const excludedCount = filtered.length - shareable.length

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-900">שוברים פעילים</h1>
        {/* In RTL the first child sits furthest right, so "share all" lands to
            the right of the add button, as one pair of actions. */}
        <div className="flex items-center gap-2">
          {/* One voucher already has a share button on its own card; this is
              for sending the whole list in a single message. */}
          {shareable.length > 1 && (
            <button
              type="button"
              onClick={() => setSharingAll(true)}
              title={
                searching
                  ? `שיתוף ${shareable.length} השוברים שמופיעים כאן`
                  : `שיתוף כל ${shareable.length} השוברים בוואטסאפ`
              }
              className="flex items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <span aria-hidden="true">💬</span>
              שיתוף הכל ({shareable.length})
            </button>
          )}
          <Link
            to="/add"
            className="whitespace-nowrap rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + הוספה
          </Link>
        </div>
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

      {sharingAll && (
        <ShareAllDialog
          vouchers={shareable}
          excludedCount={excludedCount}
          onClose={() => setSharingAll(false)}
        />
      )}
    </div>
  )
}
