/* Service worker: system notifications for the gift pages.
   Pushes arrive empty (no payload to encrypt); the text is read from api/push/inbox. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  e.waitUntil((async () => {
    const scope = self.registration.scope;
    let msg = { title: "Dárky", body: "Máš nové upozornění.", url: "" };
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const r = await fetch(new URL(`api/push/inbox?e=${encodeURIComponent(sub.endpoint)}`, scope), { cache: "no-store" });
        if (r.ok) msg = await r.json();
      }
    } catch { /* show the generic text */ }
    await self.registration.showNotification(msg.title || "Dárky", {
      body: msg.body || "",
      tag: msg.tag || undefined,
      renotify: !!msg.tag,
      icon: new URL("icon-192.png", scope).href,
      badge: new URL("badge-96.png", scope).href,
      data: { url: new URL(msg.url || "", scope).href }
    });
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = all.find(c => c.url.split("#")[0] === url.split("#")[0]);
    if (same) { same.focus(); same.postMessage({ type: "xd:notification" }); return; }
    await self.clients.openWindow(url);
  })());
});
