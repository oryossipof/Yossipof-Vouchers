import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface LoginLocationState {
  notice?: string
  email?: string
}

export function Login() {
  const { signIn, resendConfirmation } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? null) as LoginLocationState | null
  const [email, setEmail] = useState(state?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(state?.notice ?? null)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) setError(error)
    else navigate('/')
  }

  async function handleResend() {
    setError(null)
    setNotice(null)
    if (!email) {
      setError('הזינו אימייל כדי לשלוח מחדש את מייל האישור.')
      return
    }
    setResending(true)
    const { error } = await resendConfirmation(email)
    setResending(false)
    if (error) setError(error)
    else setNotice('מייל אישור חדש נשלח. בדקו את תיבת הדואר (וגם את תיקיית הספאם).')
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
            <label className="mb-1 block text-sm font-medium text-slate-700">סיסמה</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-emerald-600">{notice}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'מתחבר…' : 'התחברות'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          לא קיבלתם מייל אישור?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="font-medium text-indigo-600 disabled:opacity-50"
          >
            {resending ? 'שולח…' : 'שליחה מחדש'}
          </button>
        </p>

        <p className="mt-2 text-center text-sm text-slate-500">
          אין לכם חשבון?{' '}
          <Link to="/signup" className="font-medium text-indigo-600">
            הרשמה
          </Link>
        </p>
      </div>
    </div>
  )
}
