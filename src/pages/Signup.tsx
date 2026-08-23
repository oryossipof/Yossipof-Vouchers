import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Signup() {
  const { signUp, resendConfirmation } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [registered, setRegistered] = useState(false)
  const [resending, setResending] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)

    if (password.length < 8) {
      setError('הסיסמה חייבת להכיל לפחות 8 תווים.')
      return
    }
    if (password !== confirmPassword) {
      setError('הסיסמאות אינן תואמות.')
      return
    }

    setLoading(true)
    const { error } = await signUp(email, password)
    setLoading(false)

    if (error) {
      setError(error)
      return
    }
    setRegistered(true)
    setInfo('החשבון נוצר. בדקו את תיבת האימייל שלכם לאישור, ולאחר מכן התחברו.')
  }

  async function handleResend() {
    setResending(true)
    setError(null)
    const { error } = await resendConfirmation(email.trim())
    setResending(false)
    if (error) setError(error)
    else setInfo('נשלח אימייל אישור חדש. בדקו גם בתיקיית הספאם.')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl">🎁</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">יצירת חשבון</h1>
          <p className="text-sm text-slate-500">התחילו לעקוב אחרי כרטיסי המתנה והקופונים שלכם</p>
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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">אימות סיסמה</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-emerald-600">{info}</p>}

          {registered ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                {resending ? 'שולח…' : 'לא קיבלתי — שליחה מחדש'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/login', { state: location.state })}
                className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                מעבר להתחברות
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'יוצר חשבון…' : 'הרשמה'}
            </button>
          )}
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          כבר יש לכם חשבון?{' '}
          <Link to="/login" state={location.state} className="font-medium text-indigo-600">
            התחברות
          </Link>
        </p>
      </div>
    </div>
  )
}
