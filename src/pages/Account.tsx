import { useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import { useVouchers, type LinkedAccount } from '../context/VouchersContext'
import { LinkAccountDialog } from '../components/LinkAccountDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PushSettings } from '../components/PushSettings'

const dateFormatter = new Intl.DateTimeFormat('he-IL')

export function Account() {
  const { user, changePassword, signOut } = useAuth()
  const { linkedAccounts, removeAccountLink } = useVouchers()

  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState<LinkedAccount | null>(null)
  const [unlinkBusy, setUnlinkBusy] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

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

  async function handleUnlink() {
    if (!unlinking) return
    setUnlinkBusy(true)
    const { error } = await removeAccountLink(unlinking.user_id)
    setUnlinkBusy(false)
    setUnlinking(null)
    setLinkError(error)
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-slate-900">החשבון שלי</h1>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500">מחוברים כ־</p>
        <p className="mt-1 break-all font-medium text-slate-900">{user?.email}</p>
      </div>

      <PushSettings />

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">חשבונות מקושרים</h2>
        <p className="mt-1 text-sm text-slate-600">
          חיבור בין שני חשבונות יוצר רשימת שוברים אחת: כל הוספה, עריכה, סימון כנוצל או מחיקה חלה על
          שני החשבונות, בלי לשתף כל שובר בנפרד.
        </p>

        {linkedAccounts.length > 0 && (
          <ul className="mt-3 space-y-2">
            {linkedAccounts.map((a) => (
              <li
                key={a.user_id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block break-all text-sm text-slate-800">{a.email}</span>
                  <span className="block text-xs text-slate-400">
                    מחובר מאז {dateFormatter.format(new Date(a.linked_at))}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setUnlinking(a)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  ניתוק
                </button>
              </li>
            ))}
          </ul>
        )}

        {linkError && <p className="mt-2 text-sm text-red-600">{linkError}</p>}

        <button
          type="button"
          onClick={() => setLinking(true)}
          className="mt-3 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
        >
          🔗 חיבור חשבון
        </button>
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

      {linking && <LinkAccountDialog onClose={() => setLinking(false)} />}

      {unlinking && (
        <ConfirmDialog
          open
          title="לנתק את החשבונות?"
          message={`${unlinking.email} לא יראה יותר את השוברים שלכם, ואתם לא תראו את שלו. שוברים שכל אחד מכם הוסיף נשארים אצלו. שוברים ששותפו ביניכם אחד-אחד דרך קישור שיתוף אינם מושפעים.`}
          confirmLabel="כן, לנתק"
          tone="danger"
          busy={unlinkBusy}
          onConfirm={handleUnlink}
          onCancel={() => setUnlinking(null)}
        />
      )}
    </div>
  )
}
