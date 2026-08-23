import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  resendConfirmation: (email: string) => Promise<{ error: string | null }>
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>
  verifyRecoveryLink: () => Promise<{ error: string | null }>
  updatePassword: (password: string) => Promise<{ error: string | null }>
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const AUTH_ERROR_TRANSLATIONS: Record<string, string> = {
  'Invalid login credentials': 'אימייל או סיסמה שגויים.',
  'Email not confirmed': 'האימייל טרם אושר. בדקו את תיבת הדואר שלכם.',
  'User already registered': 'כבר קיים חשבון עם אימייל זה.',
  'Password should be at least 8 characters.': 'הסיסמה חייבת להכיל לפחות 8 תווים.',
  'Email link is invalid or has expired': 'הקישור אינו תקין או שפג תוקפו. בקשו קישור חדש.',
  'Token has expired or is invalid': 'הקישור אינו תקין או שפג תוקפו. בקשו קישור חדש.',
  'New password should be different from the old password.':
    'הסיסמה החדשה חייבת להיות שונה מהסיסמה הקודמת.',
  'Email rate limit exceeded':
    'נשלחו יותר מדי אימיילים בזמן קצר. המתינו מספר דקות ונסו שוב.',
  'For security purposes, you can only request this after':
    'מטעמי אבטחה יש להמתין מעט לפני בקשה נוספת. נסו שוב בעוד כדקה.',
  'Auth session missing': 'הקישור אינו תקין או שפג תוקפו. בקשו קישור חדש.',
}

function translateAuthError(message: string) {
  if (AUTH_ERROR_TRANSLATIONS[message]) return AUTH_ERROR_TRANSLATIONS[message]
  // Several Supabase auth errors carry variable detail (wait times, counts), so
  // fall back to matching on the stable prefix of the message.
  const key = Object.keys(AUTH_ERROR_TRANSLATIONS).find((k) => message.includes(k))
  return key ? AUTH_ERROR_TRANSLATIONS[key] : message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? translateAuthError(error.message) : null }
  }

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    })
    return { error: error ? translateAuthError(error.message) : null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  /** Sends the confirmation email again for an account that was never verified. */
  async function resendConfirmation(email: string) {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    })
    return { error: error ? translateAuthError(error.message) : null }
  }

  async function sendPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error: error ? translateAuthError(error.message) : null }
  }

  /**
   * Establishes the short-lived recovery session from a reset link. Supabase
   * sends either a `token_hash` in the query string (PKCE) or the tokens in the
   * URL fragment (implicit), which the client exchanges on its own, so both
   * shapes are handled here.
   */
  async function verifyRecoveryLink() {
    const query = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

    const linkError = query.get('error_description') ?? hash.get('error_description')
    if (linkError) return { error: translateAuthError(linkError) }

    const tokenHash = query.get('token_hash')
    if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      return { error: error ? translateAuthError(error.message) : null }
    }

    const { data } = await supabase.auth.getSession()
    if (data.session) return { error: null }

    return { error: 'הקישור אינו תקין או שפג תוקפו. בקשו קישור חדש.' }
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password })
    return { error: error ? translateAuthError(error.message) : null }
  }

  /**
   * Changes the password for a signed-in user. Supabase would accept
   * updateUser({ password }) on the strength of the session alone, so the
   * current password is verified first — otherwise anyone reaching an unlocked
   * device could take the account over without knowing the existing password.
   */
  async function changePassword(currentPassword: string, newPassword: string) {
    const email = session?.user?.email
    if (!email) return { error: 'לא מחוברים.' }

    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })
    if (reauthError) return { error: 'הסיסמה הנוכחית שגויה.' }

    return updatePassword(newPassword)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signIn,
        signUp,
        signOut,
        resendConfirmation,
        sendPasswordReset,
        verifyRecoveryLink,
        updatePassword,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
