"use strict";

// Bump this whenever index.html, style.css, or app.js changes. Installed apps
// serve the shell cache-first, so without a bump they keep showing the old UI.
const CACHE_VERSION = "hg-v1";

// The app shell: everything needed to paint a window with no network.
const PRECACHE = [
    "/",
    "/style.css",
    "/app.js",
    "/manifest.json",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
];

// Never cached: these carry per-user data or drive the OAuth redirect flow.
// A stale habit list would be worse than no habit list.
const NETWORK_ONLY = ["/api/", "/oauth2/", "/login/", "/logout"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    // Let the browser handle fonts/CDN itself; offline just falls back to
    // system fonts instead of failing the whole page.
    if (url.origin !== self.location.origin) return;
    if (NETWORK_ONLY.some((prefix) => url.pathname.startsWith(prefix))) return;

    event.respondWith(
        caches.match(req).then((hit) => {
            if (hit) return hit;
            return fetch(req)
                .then((res) => {
                    if (res.ok && res.type === "basic") {
                        const copy = res.clone();
                        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
                    }
                    return res;
                })
                .catch(() => {
                    // Offline and not in cache: still give navigations the shell.
                    if (req.mode === "navigate") return caches.match("/");
                    throw new Error("offline");
                });
        })
    );
});
