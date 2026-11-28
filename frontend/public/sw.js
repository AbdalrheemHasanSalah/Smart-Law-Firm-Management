/*
 * Qadiyati's service worker: push notifications only.
 *
 * It shows the alerts the server pushes and opens the right page when one is tapped. It has no
 * fetch handler and caches nothing, so the site always loads fresh from the network exactly as it
 * does without it.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'قضيتي', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'قضيتي'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin))
      if (open) {
        open.navigate(url)
        return open.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
