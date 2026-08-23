import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ForgotPassword() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await sendPasswordReset(email.trim())
    setLoading(false)
    if (error) setError(error)
    else setSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl">🔑</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">איפוס סיסמה</h1>
          <p className="text-sm text-slate-500">נשלח אליכם קישור לבחירת סיסמה חדשה</p>
        </div>

        {sent ? (
          <>
            <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              אם קיים חשבון עם הכתובת הזו, נשלח אליו קישור לאיפוס הסיסמה. בדקו גם בתיקיית הספאם.
              תוקף הקישור שעה אחת.
            </p>
            <Link
              to="/login"
              className="mt-4 block w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-700"
            >
              חזרה להתחברות
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">אימייל</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'שולח…' : 'שליחת קישור לאיפוס'}
            </button>
          </form>
        )}

        {!sent && (
          <p className="mt-4 text-center text-sm text-slate-500">
            נזכרתם?{' '}
            <Link to="/login" className="font-medium text-indigo-600">
              חזרה להתחברות
            </Link>
          </p>
        )}

        <p className="mt-2 text-center text-sm text-slate-500">
          החשבון טרם אושר?{' '}
          <Link to="/resend-confirmation" className="font-medium text-indigo-600">
            שליחת אימייל אישור
          </Link>
        </p>
      </div>
    </div>
  )
}
