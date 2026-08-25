/**
 * Messages the service worker sends to open tabs.
 *
 * The worker cannot route the SPA or touch Supabase itself — it has no router
 * and no session — so anything that needs either is handed to a page.
 */
export type SwMessage =
  /**
   * A notification was tapped. `notificationclick` focuses an existing tab and
   * sends this rather than calling `client.navigate()`, which is unreliable
   * inside an iOS standalone web app.
   */
  | { type: 'NAVIGATE'; url: string }
  /** A reminder just arrived, so a list being read right now is out of date. */
  | { type: 'EXPIRY_REMINDER'; payload: { title: string; body: string; url?: string } }
  /**
   * Chrome rotated the push endpoint. The worker has no Supabase session, so a
   * page has to write the new subscription.
   */
  | {
      type: 'PUSH_RESUBSCRIBED'
      oldEndpoint?: string
      subscription: { endpoint: string; keys?: { p256dh?: string; auth?: string } }
    }

export function isSwMessage(data: unknown): data is SwMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string'
  )
}
