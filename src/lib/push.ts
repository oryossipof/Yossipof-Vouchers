import { supabase } from './supabase'

/**
 * Web Push wiring for the expiry reminders.
 *
 * The awkward part of this is not the subscribing, it is telling the user
 * honestly whether notifications can work at all on the device they are
 * holding. On iOS they only exist for a web app installed to the Home Screen —
 * in a Safari tab `window.PushManager` is simply undefined, and there is no
 * flag or workaround short of shipping a native app. Showing an "enable
 * notifications" button there would be a button that silently does nothing.
 */
export type PushState =
  /** Notifications are on for this device. */
  | 'granted'
  /** Supported and available; the user has not been asked yet. */
  | 'ready'
  /** The user said no. The browser will not ask again from the page. */
  | 'denied'
  /** iOS, and the app is not installed to the Home Screen. */
  | 'needs-install'
  /** iOS older than 16.4, which predates Web Push entirely. */
  | 'ios-too-old'
  /** No Web Push on this browser at all. */
  | 'unsupported'

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS 13+ reports itself as a Mac, and is only distinguishable by the
  // fact that it has a touch screen.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own non-standard flag, which is what actually answers on iOS.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Best-effort iOS version from the user agent; null when it cannot be read. */
function iosVersion(): [number, number] | null {
  const m = /OS (\d+)[._](\d+)/.exec(navigator.userAgent)
  if (!m) return null
  return [Number(m[1]), Number(m[2])]
}

/**
 * What can be worked out synchronously. Permission alone is not enough to say
 * reminders are on -- see resolvePushState -- so 'granted' here means only
 * "permitted", and the caller must confirm a subscription exists.
 */
export function pushState(): PushState {
  if (typeof window === 'undefined') return 'unsupported'

  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  if (!hasApi) {
    if (isIos()) {
      const v = iosVersion()
      if (v && (v[0] < 16 || (v[0] === 16 && v[1] < 4))) return 'ios-too-old'
      // On iOS the API is missing precisely because the app is not installed.
      if (!isStandalone()) return 'needs-install'
    }
    return 'unsupported'
  }

  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  return 'ready'
}

/** Whether this device actually holds a push subscription. */
export async function hasSubscription(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    return Boolean(await reg?.pushManager.getSubscription())
  } catch {
    return false
  }
}

/**
 * The real state, which needs an await.
 *
 * Permission and subscription are separate things, and they come apart in
 * practice: granting notifications from the browser's own settings page leaves
 * permission 'granted' with no subscription at all, and unsubscribing elsewhere
 * does the same. Reporting that as "reminders are on" would be a lie -- nothing
 * would ever arrive. Since permission is already granted, the button shown in
 * that state subscribes without prompting again.
 */
export async function resolvePushState(): Promise<PushState> {
  const state = pushState()
  if (state !== 'granted') return state
  return (await hasSubscription()) ? 'granted' : 'ready'
}

/**
 * The application server key has to reach `subscribe` as raw bytes. Backed by
 * an explicit ArrayBuffer rather than `new Uint8Array(length)`, because the
 * latter is typed over ArrayBufferLike -- which admits SharedArrayBuffer and so
 * is not assignable to BufferSource.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

function keysOf(sub: PushSubscription) {
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
  return { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' }
}

async function store(sub: PushSubscription) {
  const { p256dh, auth } = keysOf(sub)
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent,
  })
  return error?.message ?? null
}

/**
 * Turns reminders on for this device.
 *
 * `Notification.requestPermission()` must be the first thing that runs in the
 * click handler. On iOS the prompt is tied to the user gesture, and awaiting
 * anything beforehand consumes it — the prompt is then dropped with no error.
 */
export async function enablePush(): Promise<{ state: PushState; error: string | null }> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { state: permission === 'denied' ? 'denied' : 'ready', error: null }
  }

  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!key) return { state: 'ready', error: 'התראות אינן מוגדרות באפליקציה.' }

  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        // Required by every browser, and iOS revokes permission from an app
        // that receives a push without showing something.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }))

    const error = await store(sub)
    return { state: error ? 'ready' : 'granted', error }
  } catch (e) {
    return { state: 'ready', error: e instanceof Error ? e.message : 'רישום ההתראות נכשל.' }
  }
}

/** Turns reminders off for this device only. */
export async function disablePush(): Promise<{ error: string | null }> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return { error: null }

    const { endpoint } = sub
    await sub.unsubscribe()
    const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint })
    return { error: error?.message ?? null }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'ביטול ההתראות נכשל.' }
  }
}

/**
 * Re-registers the current subscription on app start.
 *
 * Safari never fires `pushsubscriptionchange`, and even on Chrome the event can
 * fire with no page open to act on it, so this is the mechanism that actually
 * keeps endpoints current. It also refreshes `last_seen_at`, and re-points the
 * row at this account when a device is shared.
 */
export async function syncPushSubscription(): Promise<void> {
  if (pushState() !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await store(sub)
  } catch {
    // A failed re-sync is not worth surfacing: the next start tries again.
  }
}

/** Drops this device's subscription so the next account does not inherit it. */
export async function forgetPushSubscriptionOnSignOut(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint })
    await sub.unsubscribe()
  } catch {
    // Best effort — sign-out must not fail because of this.
  }
}
