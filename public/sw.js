// Service Worker: praca offline po pierwszym załadowaniu (N-01).
// Nawigacja: najpierw sieć (żeby dostać nową wersję), przy braku sieci kopia z cache.
// Pozostałe pliki z tego samego źródła: najpierw cache, w tle zapis z sieci.
const CACHE = "prompter-v1";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

// Pliki zbudowane przez Vite mają w nazwie skrót treści, więc ich listę bierzemy z index.html.
async function precache() {
  const cache = await caches.open(CACHE);
  const html = await (await fetch("./index.html", { cache: "no-store" })).text();
  const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.addAll([...CORE, ...assets]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
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
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
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
