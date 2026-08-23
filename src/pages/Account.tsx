import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'

export function Account() {
  const { user, changePassword, signOut } = useAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setDone(false)

    if (newPassword.length < 8) {
      setError('הסיסמה החדשה חייבת להכיל לפחות 8 תווים.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('הסיסמאות אינן תואמות.')
      return
    }
    if (newPassword === currentPassword) {
      setError('הסיסמה החדשה חייבת להיות שונה מהסיסמה הנוכחית.')
      return
    }

    setSaving(true)
    const { error } = await changePassword(currentPassword, newPassword)
    setSaving(false)

    if (error) {
      setError(error)
      return
    }

    setDone(true)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">החשבון שלי</h1>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500">מחוברים כ־</p>
        <p className="mt-1 break-all font-medium text-slate-900">{user?.email}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">שינוי סיסמה</h2>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">סיסמה נוכחית</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">סיסמה חדשה</label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-slate-400">לפחות 8 תווים</p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">אימות סיסמה חדשה</label>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {done && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            הסיסמה עודכנה בהצלחה.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'שומר…' : 'עדכון סיסמה'}
        </button>
      </form>

      <button
        onClick={() => signOut()}
        className="mt-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        התנתקות
      </button>
    </div>
  )
}
