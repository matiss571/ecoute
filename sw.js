// Écoute offline service worker. Page + fonts cached by version; audio lives in its own cache so updates don't re-download it.
const SHELL = "ecoute-shell-11b2699e9b", AUDIO = "ecoute-audio-1964c6f14e", FONTS = "ecoute-fonts";
const SHELL_FILES = ["./", "index.html", "manifest.json", "icon-180.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith("ecoute-shell-") && k !== SHELL) || (k.startsWith("ecoute-audio") && k !== AUDIO)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Safari asks for audio in byte ranges, so cached audio must be answered with 206 slices.
async function sliced(resp, range) {
  if (!range) return resp;
  const buf = await resp.arrayBuffer(), size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : Math.max(0, size - +(m[2] || size)), end = m[1] && m[2] ? +m[2] : size - 1;
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), { status: 206, headers: {
    "Content-Type": resp.headers.get("Content-Type") || "audio/mp4", "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" } });
}
async function audio(req) {
  const url = new URL(req.url); url.search = "";
  const c = await caches.open(AUDIO);
  let r = await c.match(url.href);
  if (!r) { const net = await fetch(url.href); if (!net.ok) return net; await c.put(url.href, net.clone()); r = net; }
  return sliced(r, req.headers.get("range"));
}
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.origin === location.origin && url.pathname.includes("/audio/")) return e.respondWith(audio(req));
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    return e.respondWith(caches.open(FONTS).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
  }
  if (url.origin === location.origin) {
    // Cached copy first (works offline); refresh it in the background when online.
    e.respondWith(caches.open(SHELL).then(async c => {
      const key = req.mode === "navigate" ? "index.html" : req;
      const hit = await c.match(key, { ignoreSearch: true });
      const net = fetch(req).then(r => { if (r.ok) c.put(key, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || new Response("Offline", { status: 503 });
    }));
  }
});
