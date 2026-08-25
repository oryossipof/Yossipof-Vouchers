/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import type { PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

/**
 * The app's service worker.
 *
 * This file exists because the expiry reminders need a `push` handler, and
 * `vite-plugin-pwa` only lets you write one under the `injectManifest`
 * strategy. Everything above the push section is what `generateSW` used to
 * produce on its own — it has to be restated here, because switching strategy
 * means the plugin no longer generates any of it.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (PrecacheEntry | string)[]
}

// `registerType: 'autoUpdate'` used to inject these two. Without them a new
// version sits waiting until every tab is closed, which on an installed PWA
// can be days.
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// generateSW added an implicit SPA fallback. Without it, opening the app
// offline — or hard-refreshing a deep link like /edit/:id — returns a 404 from
// the cache rather than the app shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// The `voucher-photos` rule from the old `workbox.runtimeCaching` config,
// restated as code: `runtimeCaching` has no equivalent under injectManifest.
registerRoute(
  ({ url }) => url.pathname.startsWith('/storage/v1/object'),
  new CacheFirst({
    cacheName: 'voucher-photos',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
)

// ---------------------------------------------------------------------------
// Expiry reminders
// ---------------------------------------------------------------------------

/** The payload the reminder function sends. Kept small: the encrypted push
 *  body has a hard 4 KB ceiling. */
interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  // iOS revokes push permission from an app that receives a push and does not
  // show a notification, so this path must always reach showNotification --
  // hence the fallback copy rather than an early return on a bad payload.
  let payload: PushPayload = {
    title: 'שוברים',
    body: 'יש לכם שובר שעומד לפוג',
  }

  if (event.data) {
    try {
      payload = { ...payload, ...(event.data.json() as Partial<PushPayload>) }
    } catch {
      payload = { ...payload, body: event.data.text() }
    }
  }

  const shown = payload

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(shown.title, {
        body: shown.body,
        dir: 'rtl',
        lang: 'he',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        // One tag for all expiry reminders, so a retry replaces the earlier
        // notification instead of stacking a second one on the lock screen.
        tag: shown.tag ?? 'voucher-expiry',
        data: { url: shown.url ?? '/' },
      })

      // Tell any open tab that a reminder landed, so a list being looked at
      // right now reflects it without waiting for the next refresh.
      const windows = await self.clients.matchAll({ includeUncontrolled: true })
      for (const client of windows) {
        client.postMessage({ type: 'EXPIRY_REMINDER', payload: shown })
      }
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data as { url?: string } | undefined
  const target = new URL(data?.url ?? '/', self.location.origin)

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      for (const client of windows) {
        if (new URL(client.url).origin !== target.origin) continue
        await client.focus()
        // client.navigate() is unreliable inside an iOS standalone web app, so
        // the open tab is told to route itself and the SPA router does the work.
        client.postMessage({ type: 'NAVIGATE', url: target.pathname + target.search })
        return
      }

      await self.clients.openWindow(target.href)
    })()
  )
})

/**
 * Chrome and Firefox fire this when they rotate an endpoint. Safari never does,
 * so the app also re-registers its subscription on every start; this handler is
 * the faster path where it exists. The worker has no Supabase session of its
 * own, so an open tab has to perform the write.
 */
self.addEventListener('pushsubscriptionchange', ((event: ExtendableEvent & {
  oldSubscription?: PushSubscription
  newSubscription?: PushSubscription
}) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey ?? undefined
      const fresh =
        event.newSubscription ??
        (await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        }))

      const windows = await self.clients.matchAll({ includeUncontrolled: true })
      for (const client of windows) {
        client.postMessage({
          type: 'PUSH_RESUBSCRIBED',
          oldEndpoint: event.oldSubscription?.endpoint,
          subscription: fresh.toJSON(),
        })
      }
    })()
  )
}) as EventListener)
