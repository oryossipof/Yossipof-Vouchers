interface StoreSearchInputProps {
  value: string
  onChange: (value: string) => void
}

export function StoreSearchInput({ value, onChange }: StoreSearchInputProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="חיפוש לפי שם חנות…"
      className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    />
  )
}
