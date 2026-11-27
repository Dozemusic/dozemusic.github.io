// Version 6.9.0 : change le nom du cache à chaque version publiée.
const CACHE = "ecrin-6.9.0";
const OFFLINE = "ecrin-offline-v1";   // chansons téléchargées : jamais effacées lors d'une mise à jour
const LIBS = "ecrin-libs-v1";
const WARM = "ecrin-warm-v1";        // fin des fichiers MP4 de Suno (leur sommaire « moov ») gardée d'avance pour démarrer vite         // bibliothèque Supabase et polices, pour démarrer sans connexion
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![CACHE, OFFLINE, LIBS, WARM].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Sert une chanson téléchargée depuis le téléphone, avec prise en charge des requêtes partielles (Range)
// qu'exigent Safari et Chrome pour lire l'audio et avancer dans le morceau.
async function fromOffline(req) {
  const hit = await (await caches.open(OFFLINE)).match(req.url);
  if (!hit) return (await fromWarm(req)) || fetch(req);
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

// Démarrage rapide : les MP4 de Suno ont leur sommaire (« moov ») à la fin du fichier. Le lecteur le demande après le
// premier morceau de données ; s'il a été préparé d'avance par l'appli, on le sert tout de suite depuis le téléphone.
async function fromWarm(req) {
  try {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") || ""); if (!m) return null;
    const w = await (await caches.open(WARM)).match(req.url.split(/[?#]/)[0] + "?doze-tail"); if (!w) return null;
    const s0 = +w.headers.get("X-Start"), tot = +w.headers.get("X-Total"), a = +m[1];
    if (!(a >= s0 && a < tot)) return null;
    const b = Math.min(m[2] ? +m[2] : tot - 1, tot - 1), buf = await w.arrayBuffer();
    return new Response(buf.slice(a - s0, b - s0 + 1), { status: 206, headers: {
      "Content-Type": "video/mp4", "Content-Range": `bytes ${a}-${b}/${tot}`, "Content-Length": String(b - a + 1), "Accept-Ranges": "bytes" } });
  } catch { return null; }
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
  // Fichiers versionnés (?v=…) : servis directement depuis le téléphone, ils ne changent jamais pour une version donnée.
  if (url.search.includes("v=") && /\.(js|css)$/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })));
    return;
  }
  // Images et icônes de l'appli : copie locale d'abord, mise à jour en arrière-plan.
  if (/\.(png|webp|jpg|svg|mp3)$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // Le reste (page, config, tendances) : réseau d'abord, mais si le réseau traîne plus de 3 s, la copie locale prend le relais.
  e.respondWith((async () => {
    const net = fetch(e.request, { cache: "no-store" }).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; });
    const local = caches.match(e.request, { ignoreSearch: e.request.mode === "navigate" });
    const slow = new Promise(res => setTimeout(res, 3000)).then(() => local);
    try { return (await Promise.race([net, slow])) || (await net); }
    catch { return (await local) || (e.request.mode === "navigate" ? (await caches.match("./")) || (await caches.match("./index.html", { ignoreSearch: true })) : Response.error()); }
  })());
});
