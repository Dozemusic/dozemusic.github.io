// Version 5.4.0 : change le nom du cache à chaque version publiée.
const CACHE = "ecrin-5.4.0";
const OFFLINE = "ecrin-offline-v1";   // chansons téléchargées : jamais effacées lors d'une mise à jour
const LIBS = "ecrin-libs-v1";         // bibliothèque Supabase et polices, pour démarrer sans connexion
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![CACHE, OFFLINE, LIBS].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Sert une chanson téléchargée depuis le téléphone, avec prise en charge des requêtes partielles (Range)
// qu'exigent Safari et Chrome pour lire l'audio et avancer dans le morceau.
async function fromOffline(req) {
  const hit = await (await caches.open(OFFLINE)).match(req.url);
  if (!hit) return fetch(req);
  const range = req.headers.get("range");
  if (!range) return hit;
  const blob = await hit.blob(), size = blob.size, m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : size - 1;
  if (!m[1] && m[2]) { start = Math.max(0, size - +m[2]); end = size - 1; }
  end = Math.min(end, size - 1);
  return new Response(blob.slice(start, end + 1), { status: 206, headers: {
    "Content-Type": hit.headers.get("Content-Type") || "audio/mp4", "Content-Range": `bytes ${start}-${end}/${size}`,
    "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes" } });
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (/^cdn\d?\.suno\.ai$/.test(url.hostname) || url.pathname.includes("/storage/v1/object/public/songs/")) { e.respondWith(fromOffline(e.request)); return; }
  if (["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(LIBS).then(c => c.put(e.request, copy)); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // Réseau d'abord, sans cache HTTP, pour toujours servir la dernière version ; copie locale seulement hors connexion.
  e.respondWith(fetch(e.request, { cache: "no-store" }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(async () => (await caches.match(e.request)) || (e.request.mode === "navigate" ? (await caches.match("./")) || (await caches.match("./index.html", { ignoreSearch: true })) : Response.error())));
});
