import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Login() {
  const { signIn, resendConfirmation } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNeedsConfirmation(false)
    setResent(false)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      setError(error)
      // Supabase reports an unverified account as a distinct error, so the
      // resend option only appears when it is actually the problem.
      if (error.includes('טרם אושר')) setNeedsConfirmation(true)
    } else navigate(from, { replace: true })
  }

  async function handleResend() {
    setResending(true)
    setError(null)
    const { error } = await resendConfirmation(email.trim())
    setResending(false)
    if (error) setError(error)
    else {
      setResent(true)
      setNeedsConfirmation(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl">🎁</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">ברוכים השבים</h1>
          <p className="text-sm text-slate-500">התחברו כדי לצפות בשוברים שלכם</p>
        </div>

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
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="block text-sm font-medium text-slate-700">סיסמה</label>
              <Link to="/forgot-password" className="text-xs font-medium text-indigo-600">
                שכחתי סיסמה
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {resent && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              נשלח אימייל אישור חדש. בדקו את תיבת הדואר, כולל תיקיית הספאם.
            </p>
          )}

          {needsConfirmation && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || !email.trim()}
              className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {resending ? 'שולח…' : 'שליחת אימייל אישור מחדש'}
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'מתחבר…' : 'התחברות'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          אין לכם חשבון?{' '}
          <Link to="/signup" state={location.state} className="font-medium text-indigo-600">
            הרשמה
          </Link>
        </p>

        <p className="mt-2 text-center text-sm text-slate-500">
          לא קיבלתם אימייל אישור?{' '}
          <Link to="/resend-confirmation" className="font-medium text-indigo-600">
            שליחה מחדש
          </Link>
        </p>
      </div>
    </div>
  )
}
