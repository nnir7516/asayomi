/* 朝読みログ Service Worker：オフライン表示とプッシュ通知の受信 */
var VERSION = "v2";
var SHELL_CACHE = "shell-" + VERSION;
var DATA_CACHE = "data-" + VERSION;
var FONT_CACHE = "fonts-" + VERSION;
var SHELL = [
  "./", "index.html", "app.css", "app.js", "manifest.webmanifest", "push-config.json",
  "icons/icon-192.png", "icons/icon-512.png", "icons/badge-96.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return [SHELL_CACHE, DATA_CACHE, FONT_CACHE].indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, cacheName) {
  return fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(cacheName).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || Response.error(); });
  });
}
function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  });
}
function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(function (c) {
    return c.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf("/data/") >= 0) { e.respondWith(networkFirst(req, DATA_CACHE)); return; }
    if (req.mode === "navigate") { e.respondWith(networkFirst(req, SHELL_CACHE)); return; }
    e.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(cacheFirst(req, FONT_CACHE));
  }
});

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  var title = d.title || "朝読みログ";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "新しい記事が届きました",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: d.tag || "asayomi",
    renotify: true,
    data: { hash: d.hash || "#home" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var hash = (e.notification.data && e.notification.data.hash) || "#home";
  var target = new URL(hash, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.url.indexOf(self.registration.scope) === 0) {
        c.postMessage({ type: "open", hash: hash });
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
