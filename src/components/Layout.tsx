import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useVouchers } from '../context/VouchersContext'
import { isSwMessage } from '../lib/swMessages'
import { supabase } from '../lib/supabase'

const navItems = [
  { to: '/', label: 'פעילים', icon: '🎟️' },
  { to: '/expired', label: 'פג תוקף', icon: '⏰' },
  { to: '/used', label: 'נוצלו', icon: '📦' },
  { to: '/add', label: 'הוספה', icon: '➕' },
  { to: '/account', label: 'חשבון', icon: '⚙️' },
]

export function Layout() {
  const { signOut, user } = useAuth()
  const { refresh } = useVouchers()
  const navigate = useNavigate()

  // The service worker's half of the conversation. It has no router and no
  // Supabase session, so tapping a notification and rotating a push endpoint
  // both end up here.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    function onMessage(event: MessageEvent) {
      if (!isSwMessage(event.data)) return

      if (event.data.type === 'NAVIGATE') {
        navigate(event.data.url)
      } else if (event.data.type === 'EXPIRY_REMINDER') {
        // The reminder means something crossed a milestone; the open list is
        // now stale. Silent, so it does not flash over what is being read.
        void refresh(true)
      } else if (event.data.type === 'PUSH_RESUBSCRIBED') {
        const { subscription, oldEndpoint } = event.data
        void (async () => {
          if (oldEndpoint) {
            await supabase.rpc('delete_push_subscription', { p_endpoint: oldEndpoint })
          }
          await supabase.rpc('save_push_subscription', {
            p_endpoint: subscription.endpoint,
            p_p256dh: subscription.keys?.p256dh ?? '',
            p_auth: subscription.keys?.auth ?? '',
            p_user_agent: navigator.userAgent,
          })
        })()
      }
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate, refresh])

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎁</span>
            <span className="text-lg font-semibold text-slate-900">שוברים</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden truncate text-xs text-slate-500 sm:inline">{user?.email}</span>
            <button
              onClick={() => signOut()}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              התנתקות
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-5 pb-24">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                // Five tabs have to fit a 360px screen, so the label is a
                // notch smaller than the four-tab version was and is kept on
                // one line rather than wrapping mid-word.
                `flex flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
                  isActive ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                }`
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
