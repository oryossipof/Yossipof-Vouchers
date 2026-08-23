import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const COOLDOWN_SECONDS = 60

export function ResendConfirmation() {
  const { resendConfirmation } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // The project's email quota is small, so discourage rapid repeat sends.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await resendConfirmation(email.trim())
    setLoading(false)

    // Rate-limit errors are worth showing, because the user needs to know to
    // wait. Anything else stays neutral so this page cannot be used to test
    // which addresses are registered or already confirmed.
    if (error && (error.includes('יותר מדי') || error.includes('להמתין'))) {
      setError(error)
      return
    }

    setSent(true)
    setCooldown(COOLDOWN_SECONDS)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl">📧</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">שליחת אימייל אישור מחדש</h1>
          <p className="text-sm text-slate-500">
            לא קיבלתם את אימייל האישור? נשלח אותו שוב
          </p>
        </div>

        {sent && (
          <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
            אם קיים חשבון שטרם אושר עם הכתובת הזו, נשלח אליו אימייל אישור חדש. בדקו גם בתיקיית
            הספאם ובדואר הזבל.
          </p>
        )}

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
            disabled={loading || cooldown > 0}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading
              ? 'שולח…'
              : cooldown > 0
                ? `אפשר לשלוח שוב בעוד ${cooldown} שניות`
                : sent
                  ? 'שליחה נוספת'
                  : 'שליחת אימייל אישור'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          <Link to="/login" className="font-medium text-indigo-600">
            חזרה להתחברות
          </Link>
        </p>
      </div>
    </div>
  )
}
