import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

type Stage =
  | { kind: 'verifying' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready' }
  | { kind: 'done' }

export function ResetPassword() {
  const { verifyRecoveryLink, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage>({ kind: 'verifying' })
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const verified = useRef(false)

  useEffect(() => {
    if (verified.current) return
    verified.current = true

    verifyRecoveryLink().then(({ error }) => {
      setStage(error ? { kind: 'invalid', message: error } : { kind: 'ready' })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('הסיסמה חייבת להכיל לפחות 8 תווים.')
      return
    }
    if (password !== confirmPassword) {
      setError('הסיסמאות אינן תואמות.')
      return
    }

    setSaving(true)
    const { error } = await updatePassword(password)
    setSaving(false)

    if (error) setError(error)
    else {
      setStage({ kind: 'done' })
      setTimeout(() => navigate('/', { replace: true }), 2000)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl">🔐</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">בחירת סיסמה חדשה</h1>
        </div>

        {stage.kind === 'verifying' && (
          <p className="text-center text-sm text-slate-500">בודק את הקישור…</p>
        )}

        {stage.kind === 'invalid' && (
          <>
            <p className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">{stage.message}</p>
            <Link
              to="/forgot-password"
              className="mt-4 block w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-700"
            >
              שליחת קישור חדש
            </Link>
          </>
        )}

        {stage.kind === 'done' && (
          <p className="rounded-lg bg-emerald-50 px-3 py-3 text-center text-sm text-emerald-800">
            הסיסמה עודכנה. מעבירים אתכם לשוברים…
          </p>
        )}

        {stage.kind === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">סיסמה חדשה</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <p className="mt-1 text-xs text-slate-400">לפחות 8 תווים</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">אימות סיסמה</label>
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

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'שומר…' : 'עדכון סיסמה'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
