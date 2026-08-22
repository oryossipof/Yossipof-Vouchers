/**
 * Absolute base URL of the deployed app, used for auth email links.
 *
 * Without an explicit `emailRedirectTo`, Supabase falls back to the project's
 * "Site URL" setting, which defaults to http://localhost:3000 — that is why
 * confirmation emails pointed at localhost. `VITE_SITE_URL` lets a deployment
 * pin the canonical origin; otherwise we use the origin the user is on.
 */
export function getSiteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL
  if (configured) return configured.replace(/\/+$/, '')
  return window.location.origin
}

export function getAuthRedirectUrl(path = '/auth/callback'): string {
  return `${getSiteUrl()}${path}`
}
