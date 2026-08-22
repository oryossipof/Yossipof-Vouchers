import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { translateAuthError } from '../lib/authErrors'

/**
 * Landing page for the links in Supabase auth emails (signup confirmation,
 * magic link, recovery). Supabase can hand the session back in three shapes,
 * depending on project flow settings, so handle all of them:
 *   - `?code=...`               → PKCE, exchange for a session
 *   - `?token_hash=&type=`      → verify the OTP directly
 *   - `#access_token=...`       → implicit, the client picks it up itself
 */
export function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    async function handleCallback() {
      const query = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

      const errorDescription = query.get('error_description') ?? hash.get('error_description')
      if (errorDescription) {
        setError(translateAuthError(errorDescription))
        return
      }

      const code = query.get('code')
      const tokenHash = query.get('token_hash')
      const type = query.get('type') as EmailOtpType | null

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setError(translateAuthError(error.message))
          return
        }
      } else if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        if (error) {
          setError(translateAuthError(error.message))
          return
        }
      }

      // Implicit flow: the client parses the hash on init, so just read back
      // whatever session ended up being stored.
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        navigate('/', { replace: true })
        return
      }

      navigate('/login', {
        replace: true,
        state: { notice: 'האימייל אושר. אפשר להתחבר עכשיו.' },
      })
    }

    handleCallback()
  }, [navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
        <div className="text-3xl">🎁</div>
        {error ? (
          <>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">האישור נכשל</h1>
            <p className="mt-2 text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="mt-4 w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              חזרה להתחברות
            </button>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">מאשר את האימייל…</p>
        )}
      </div>
    </div>
  )
}
