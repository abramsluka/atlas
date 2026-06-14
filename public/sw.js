// Kill-switch service worker.
//
// The previous version used a cache-first strategy on HTML documents with a
// hardcoded, never-bumped cache name. After every Vercel deploy it kept serving
// stale app-shell HTML that pointed at deleted /_next/* chunks, producing white
// pages, missing content, and net::ERR_FAILED. We no longer ship a service
// worker. This file exists only so already-installed clients (which still have
// the old SW registered) fetch new bytes on their next update check, then heal
// themselves: purge all caches, unregister, and reload open windows.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Wipe every cache this origin created (kills the stale app shell).
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))

      // Take control of existing tabs/PWA windows so we can reload them.
      await self.clients.claim()

      // Remove this registration entirely — no SW going forward.
      await self.registration.unregister()

      // Force-refresh open clients so they pull fresh HTML from the network.
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        client.navigate(client.url)
      }
    })()
  )
})

// No fetch handler: every request goes straight to the network.
