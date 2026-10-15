/**
 * Szablon Service Workera (zwykły JavaScript w łańcuchu, bo sw.js nie przechodzi przez bundler).
 * Przy budowaniu buildServiceWorker podmienia VERSION i ASSETS.
 */
export const SW_TEMPLATE = `// Service Worker: praca offline po pierwszym załadowaniu (N-01).
// Nawigacja: najpierw sieć (żeby dostać nową wersję), przy braku sieci kopia z cache.
// Pozostałe pliki z tego samego źródła: najpierw cache, w tle zapis z sieci.
//
// Szablon: przy budowaniu (vite.config.ts, sw/build.ts) VERSION i ASSETS są podmieniane na skrót
// i listę plików z assets/. Dzięki temu każda nowa wersja aplikacji daje inny sw.js: przeglądarka
// instaluje go od nowa, zapisuje wszystkie pliki nowej wersji (także pdf.js do importu PDF)
// i usuwa cache poprzedniej.
const VERSION = "dev";
const ASSETS = /*ASSETS*/ [];
const CACHE = "prompter-" + VERSION;
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...new Set([...CORE, ...ASSETS])]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Tylko poprawna strona zastępuje kopię: 404 lub błąd serwera nie może trafić do cache jako aplikacja.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
