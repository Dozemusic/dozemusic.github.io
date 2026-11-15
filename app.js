/* DOZE 4.2.0 */
  const VERSION = "4.2.0";
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const cfg = window.ECRIN_CONFIG || {};
  const ready = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = ready ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  // ---------- mémoire locale (propre à chaque auditeur) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ecrin." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ecrin." + k, JSON.stringify(v)); } catch {} }
  };
  const favs = new Set(store.get("favs", []));
  let myLists = store.get("playlists", []);
  const offline = store.get("offline", {});
  const owned = store.get("owned", {});               // { idTitre: clé } : titres publiés depuis cet appareil
  let adminKey = store.get("admin", null);
  const editKey = t => t && (owned[t.id] || adminKey);            // { id: { t: titre, lyrics, size, at } } : chansons téléchargées          // [{ id, key, name }] (key nulle = playlist d'un autre, enregistrée)
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  let device = store.get("device", null); if (!device) { device = uuid(); store.set("device", device); }
  // Pays approximatif de l'auditeur, déduit du fuseau horaire puis de la langue (aucune donnée personnelle envoyée).
  const TZ_CC = { "Africa/Abidjan": "CI", "Africa/Accra": "GH", "Africa/Bamako": "ML", "Africa/Dakar": "SN", "Africa/Lome": "TG", "Africa/Ouagadougou": "BF", "Africa/Conakry": "GN", "Africa/Porto-Novo": "BJ", "Africa/Lagos": "NG", "Africa/Douala": "CM", "Africa/Libreville": "GA", "Africa/Kinshasa": "CD", "Africa/Lubumbashi": "CD", "Africa/Brazzaville": "CG", "Africa/Niamey": "NE", "Africa/Ndjamena": "TD", "Africa/Bangui": "CF", "Africa/Malabo": "GQ", "Africa/Nouakchott": "MR", "Africa/Freetown": "SL", "Africa/Monrovia": "LR", "Africa/Banjul": "GM", "Africa/Bissau": "GW", "Africa/Casablanca": "MA", "Africa/Algiers": "DZ", "Africa/Tunis": "TN", "Africa/Cairo": "EG", "Africa/Johannesburg": "ZA", "Africa/Nairobi": "KE", "Africa/Kigali": "RW", "Africa/Bujumbura": "BI", "Africa/Addis_Ababa": "ET", "Africa/Dar_es_Salaam": "TZ", "Africa/Kampala": "UG", "Indian/Antananarivo": "MG", "Indian/Reunion": "RE", "Indian/Mauritius": "MU", "Europe/Paris": "FR", "Europe/Brussels": "BE", "Europe/Zurich": "CH", "Europe/Luxembourg": "LU", "Europe/Monaco": "MC", "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Lisbon": "PT", "Europe/Amsterdam": "NL", "America/Montreal": "CA", "America/Toronto": "CA", "America/Vancouver": "CA", "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US", "America/Port-au-Prince": "HT", "America/Martinique": "MQ", "America/Guadeloupe": "GP", "America/Cayenne": "GF", "America/Sao_Paulo": "BR", "America/Mexico_City": "MX", "Asia/Dubai": "AE", "Asia/Tokyo": "JP", "Asia/Shanghai": "CN", "Asia/Kolkata": "IN", "Asia/Beirut": "LB" };
  function myCountry() {
    try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (TZ_CC[tz]) return TZ_CC[tz]; } catch {}
    for (const l of navigator.languages || [navigator.language || ""]) { const m = /[-_]([A-Z]{2})$/i.exec(l); if (m) return m[1].toUpperCase(); }
    return null;
  }
  const regionName = (() => { try { const d = new Intl.DisplayNames(["fr"], { type: "region" }); return c => { try { return d.of(c); } catch { return c; } }; } catch { return c => c; } })();
  const flag = c => /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map(x => 0x1F1E6 + x.charCodeAt(0) - 65)) : "🌍";
  let history = store.get("history", []);

  // ---------- état ----------
  const S = {
    all: [], loaded: false, error: false, week: [], hasV2: false,
    view: "accueil", param: null, q: "", genre: null,
    ctx: {},                               // listes affichées, pour lancer la lecture depuis n'importe quel rayon
    queue: [], order: [], pos: -1,
    shuffle: store.get("shuffle", false),
    repeat: store.get("repeat", "off"),    // off | all | one
    counted: false,
    sleepAt: 0, sleepEnd: false
  };
  // Un seul lecteur pour toutes les sources : fichier ou Suno (élément <audio>), SoundCloud et YouTube
  // (leurs lecteurs officiels, affichés à l'écran comme l'exigent leurs conditions).
  const media = $("audio");
  const EXT_SC = /^https:\/\/soundcloud\.com\//, EXT_YT = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/;
  const corsOk = u => /^https:\/\/(cdn\d?\.suno\.ai|[a-z0-9]+\.supabase\.co)\//.test(u);
  const loadScript = src => new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
  let scApi, ytApi;
  const scReady = () => scApi || (scApi = loadScript("https://w.soundcloud.com/player/api.js"));
  const ytReady = () => ytApi || (ytApi = new Promise((res, rej) => { if (window.YT && YT.Player) return res(); window.onYouTubeIframeAPIReady = res; loadScript("https://www.youtube.com/iframe_api").catch(rej); }));
  class Player extends EventTarget {
    constructor(el) { super(); this.el = el; this.ext = null; this.bind(el); }
    bind(el) { for (const ev of ["play", "pause", "timeupdate", "ended", "loadedmetadata", "error"]) el.addEventListener(ev, () => { if (el === this.el && !this.ext) this.emit(ev); }); }
    // Remplace l'élément <audio> par un neuf, au même endroit du morceau : seule façon de « débrancher »
    // le moteur d'effets sur Safari, où ce branchement est définitif.
    swapElement() {
      const old = this.el, n = document.createElement("audio");
      const src = old.getAttribute("src"), t = old.currentTime, playing = !old.paused;
      n.preload = "metadata"; n.volume = old.volume; n.loop = old.loop; n.playbackRate = old.playbackRate;
      this.el = n; this.bind(n);
      old.pause(); old.removeAttribute("src"); old.load(); old.replaceWith(n); n.id = "audio";
      if (src && !this.ext) {
        if (corsOk(src)) n.crossOrigin = "anonymous";
        n.src = src;
        n.addEventListener("loadedmetadata", () => { try { n.currentTime = t; } catch {} }, { once: true });
        if (playing) n.play().catch(() => {});
      }
    }
    emit(ev) { this.dispatchEvent(new Event(ev)); }
    get paused() { return this.ext ? this.ext.paused : this.el.paused; }
    get currentTime() { return this.ext ? this.ext.time : this.el.currentTime; }
    set currentTime(v) { if (this.ext) this.ext.seek(v); else this.el.currentTime = v; }
    get duration() { return this.ext ? this.ext.dur : this.el.duration; }
    get error() { return this.ext ? this.ext.err : this.el.error; }
    get src() { return this.ext ? this.ext.url : (this.el.getAttribute("src") || ""); }
    set src(u) { this.load(u); }
    get loop() { return this.el.loop; } set loop(v) { this.el.loop = v; }
    get volume() { return this.el.volume; } set volume(v) { this.el.volume = v; if (this.ext) this.ext.setVolume(v); }
    get playbackRate() { return this.el.playbackRate; } set playbackRate(v) { this.el.playbackRate = v; }
    get webkitShowPlaybackTargetPicker() { return this.ext || !this.el.webkitShowPlaybackTargetPicker ? undefined : this.el.webkitShowPlaybackTargetPicker.bind(this.el); }
    get remote() { return this.ext ? undefined : this.el.remote; }
    get isExternal() { return !!this.ext; }
    play() { if (this.ext) { this.ext.play(); return Promise.resolve(); } return this.el.play(); }
    pause() { if (this.ext) this.ext.pause(); else this.el.pause(); }
    removeAttribute(a) { if (a === "src") { this.dropExt(); this.el.removeAttribute("src"); this.el.load(); } }
    dropExt() { if (this.ext) { this.ext.destroy(); this.ext = null; } }
    load(u) {
      this.dropExt();
      if (EXT_SC.test(u) || EXT_YT.test(u)) { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); this.ext = (EXT_SC.test(u) ? makeSC : makeYT)(u, this); return; }
      if (corsOk(u)) this.el.crossOrigin = "anonymous"; else this.el.removeAttribute("crossorigin");
      this.el.src = u;
    }
  }
  function extHost() { const h = $("ext-host"); h.innerHTML = ""; h.hidden = false; placeExt(); return h; }
  function makeSC(url, P) {
    const host = extHost(), ifr = document.createElement("iframe");
    ifr.allow = "autoplay; encrypted-media"; ifr.title = "Lecteur SoundCloud";
    ifr.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&visual=true&show_comments=false&hide_related=true&show_teaser=false&show_reposts=false`;
    host.appendChild(ifr); host.dataset.kind = "sc";
    const x = { url, paused: true, time: 0, dur: NaN, err: null, w: null, pending: false,
      play() { x.pending = true; if (x.w) x.w.play(); }, pause() { x.pending = false; if (x.w) x.w.pause(); },
      seek(sec) { if (x.w) x.w.seekTo(sec * 1000); }, setVolume(v) { if (x.w) x.w.setVolume(Math.round(v * 100)); },
      destroy() { x.dead = true; host.innerHTML = ""; host.hidden = true; } };
    scReady().then(() => {
      if (x.dead) return;
      const w = SC.Widget(ifr), E = SC.Widget.Events; x.w = w;
      w.bind(E.READY, () => { w.getDuration(d => { x.dur = d / 1000; P.emit("loadedmetadata"); }); w.setVolume(Math.round(P.volume * 100)); if (x.pending) w.play(); });
      w.bind(E.PLAY, () => { x.paused = false; P.emit("play"); });
      w.bind(E.PAUSE, () => { x.paused = true; P.emit("pause"); });
      w.bind(E.FINISH, () => { x.paused = true; P.emit("pause"); P.emit("ended"); });
      w.bind(E.PLAY_PROGRESS, e => { x.time = e.currentPosition / 1000; P.emit("timeupdate"); });
      w.bind(E.ERROR, () => { x.err = { code: 4 }; P.emit("error"); });
    }).catch(() => { x.err = { code: 4 }; P.emit("error"); });
    return x;
  }
  function makeYT(url, P) {
    const id = EXT_YT.exec(url)[1], host = extHost(), div = document.createElement("div");
    host.appendChild(div); host.dataset.kind = "yt";
    const x = { url, paused: true, time: 0, dur: NaN, err: null, p: null, pending: false, timer: 0,
      play() { x.pending = true; if (x.p && x.p.playVideo) x.p.playVideo(); }, pause() { x.pending = false; if (x.p && x.p.pauseVideo) x.p.pauseVideo(); },
      seek(sec) { if (x.p && x.p.seekTo) x.p.seekTo(sec, true); }, setVolume(v) { if (x.p && x.p.setVolume) x.p.setVolume(Math.round(v * 100)); },
      destroy() { x.dead = true; clearInterval(x.timer); try { if (x.p) x.p.destroy(); } catch {} host.innerHTML = ""; host.hidden = true; } };
    ytReady().then(() => {
      if (x.dead) return;
      x.p = new YT.Player(div, { videoId: id, width: "100%", height: "100%", playerVars: { playsinline: 1, rel: 0, modestbranding: 1 }, events: {
        onReady: () => { x.dur = x.p.getDuration() || NaN; P.emit("loadedmetadata"); x.p.setVolume(Math.round(P.volume * 100)); if (x.pending) x.p.playVideo(); },
        onStateChange: e => {
          if (e.data === 1) { x.paused = false; if (!(x.dur > 0)) { x.dur = x.p.getDuration(); P.emit("loadedmetadata"); } P.emit("play"); }
          else if (e.data === 2) { x.paused = true; P.emit("pause"); }
          else if (e.data === 0) { x.paused = true; P.emit("pause"); P.emit("ended"); }
        },
        onError: () => { x.err = { code: 4 }; P.emit("error"); } } });
      x.timer = setInterval(() => { if (x.p && x.p.getCurrentTime && !x.paused) { x.time = x.p.getCurrentTime(); P.emit("timeupdate"); } }, 250);
    }).catch(() => { x.err = { code: 4 }; P.emit("error"); });
    return x;
  }
  // Le lecteur SoundCloud / YouTube se place sur la pochette en plein écran, sinon dans une petite fenêtre.
  function placeExt() {
    const h = $("ext-host"); if (!h || h.hidden) return;
    const npOpen = !$("np").hidden;
    if (npOpen) {
      const r = document.querySelector(".np-art").getBoundingClientRect();
      Object.assign(h.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      h.classList.remove("docked");
    } else { h.removeAttribute("style"); h.classList.add("docked"); }
  }
  addEventListener("resize", placeExt);
  const audio = new Player(media);
  audio.volume = store.get("vol", 1);
  $("vol").value = audio.volume;

  // ---------- utilitaires ----------
  const fmt = s => { if (!isFinite(s)) return "0:00"; s = Math.floor(s); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const nf = new Intl.NumberFormat("fr-FR");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const plural = (n, w) => nf.format(n) + " " + w + (n > 1 ? "s" : "");
  function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function fallbackCover(t) {
    const h = hue((t.title || "") + (t.artist || ""));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},75%,58%)"/><stop offset="1" stop-color="hsl(${(h + 70) % 360},70%,28%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="63" font-family="sans-serif" font-size="36" font-weight="800" text-anchor="middle" fill="rgba(255,255,255,.9)">${esc((t.title || "?")[0].toUpperCase())}</text></svg>`;
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }
  const coverOf = t => t.cover_url || fallbackCover(t);
  const imgTag = (t, cls = "") => `<img class="${cls}" src="${esc(coverOf(t))}" data-fb="${esc(t.id)}" alt="" loading="lazy">`;
  document.addEventListener("error", e => {
    const img = e.target;
    if (img.tagName === "IMG" && img.dataset.fb && !img.dataset.failed) {
      img.dataset.failed = "1";
      const t = S.all.find(x => x.id === img.dataset.fb) || { title: "?", artist: "" };
      img.src = fallbackCover(t);
    }
  }, true);
  // Suno bloque le MP3 direct : la vidéo MP4 publique contient la même piste audio.
  const playable = url => String(url || "").replace(/^(https:\/\/cdn1\.suno\.ai\/[0-9a-f-]{36})\.mp3$/i, "$1.mp4");
  const current = () => S.queue[S.order[S.pos]];
  let toastTimer;
  function toast(msg) { const el = $("toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, Math.max(2800, msg.length * 55)); }
  function shareUrl(t) { const u = new URL(location.href); u.search = "?t=" + t.id; u.hash = ""; return u.toString(); }
  function share(t) {
    openShare({ kind: "titre", title: `« ${t.title} » de ${t.artist}`, text: `🎧 Écoute « ${t.title} » de ${t.artist} sur DOZE`, url: shareUrl(t), cover: coverOf(t) });
  }
  const appUrl = () => { const u = new URL(location.href); u.search = ""; u.hash = ""; return u.toString(); };
  function shareApp() {
    openShare({ kind: "appli", title: "DOZE", text: "🎧 Découvre DOZE : la musique des talents en herbe, des artistes et des créateurs IA. Gratuit et sans pub. Chaque talent mérite d'être entendu.", url: appUrl(), cover: "icon-192.png" });
  }
  function shuffled(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  const GENRE_COLORS = {
    "afrobeat": ["#FF7A18", "#AF002D"], "coupe-decale": ["#00C9A7", "#005F73"], "zouglou": ["#F9D423", "#E65C00"],
    "rap": ["#8E2DE2", "#4A00E0"], "r&b": ["#EC008C", "#7A0BC0"], "pop": ["#FF5F6D", "#FFC371"], "gospel": ["#F2C766", "#8A5A00"],
    "reggae": ["#56AB2F", "#1D5C2F"], "electro": ["#00D2FF", "#3A47D5"], "rock": ["#CB356B", "#3D0F1F"], "jazz": ["#3A6073", "#16222A"],
    "classique": ["#C9B07A", "#4B3B1F"]
  };
  function genreColors(g) { const k = norm(g); if (GENRE_COLORS[k]) return GENRE_COLORS[k]; const h = hue(k); return [`hsl(${h},70%,52%)`, `hsl(${(h + 50) % 360},70%,26%)`]; }
  const genreBg = g => { const [a, b] = genreColors(g); return `linear-gradient(135deg, ${a}, ${b})`; };

  // ---------- Suno ----------
  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  function parseSuno(input) {
    const s = String(input || "").trim();
    const m = s.match(new RegExp("suno\\.(?:com|ai)/song/(" + UUID + ")", "i"))
      || s.match(new RegExp("cdn\\d?\\.suno\\.ai/(?:image_(?:large_)?)?(" + UUID + ")", "i"))
      || s.match(new RegExp("^(" + UUID + ")$", "i"));
    if (m) return { id: m[1].toLowerCase() };
    if (/suno\.(com|ai)\/s\//i.test(s)) return { short: true };
    return null;
  }
  const sunoAudio = id => `https://cdn1.suno.ai/${id}.mp4`;
  const sunoCover = id => `https://cdn2.suno.ai/image_large_${id}.jpeg`;

  // ---------- données ----------
  async function load() {
    if (!sb) { S.loaded = true; const off = Object.values(offline); if (off.length) { S.offlineMode = true; S.all = off.map(o => ({ likes: 0, ...o.t })); } render(); return; }
    const cols = "id,title,artist,genre,source,suno_id,audio_url,cover_url,plays,likes,created_at";
    let { data, error } = await sb.from("tracks").select(cols + ",ai,made_with").order("created_at", { ascending: false }).limit(1000);
    S.hasV3 = !error;
    if (error) ({ data, error } = await sb.from("tracks").select(cols).order("created_at", { ascending: false }).limit(1000));
    S.hasV2 = S.hasV3 || !error;
    if (error) ({ data, error } = await sb.from("tracks").select("*").order("created_at", { ascending: false }).limit(1000));
    S.loaded = true;
    if (error) {
      const off = Object.values(offline);
      if (off.length) { S.offlineMode = true; S.all = off.map(o => ({ likes: 0, ...o.t })); render(); return; }
      S.error = true; render(); return;
    }
    S.offlineMode = false;
    S.all = (data || []).map(t => ({ likes: 0, ...t }));
    render();
    sb.rpc("can_edit", { p_id: "00000000-0000-4000-8000-000000000000", p_key: "00000000-0000-4000-8000-000000000000" }).then(r => { S.hasV4 = !r.error; });
    if (S.hasV2) {
      const w = await sb.rpc("top_week", { p_limit: 20 });
      if (!w.error && w.data) { S.week = w.data.map(r => { const t = byId(r.track_id); return t && { ...t, weekLikes: r.n }; }).filter(Boolean); if (S.view === "accueil") render(); }
    }
  }
  const byId = id => S.all.find(t => t.id === id);
  const newest = () => S.all.slice();
  const popular = () => S.all.slice().sort((a, b) => b.plays - a.plays || (b.created_at > a.created_at ? 1 : -1));
  function gems() {
    // Pépites : les titres encore peu écoutés, mélangés à chaque visite, pour que chacun ait sa chance.
    if (S.all.length < 2) return [];
    const sorted = S.all.slice().sort((a, b) => a.plays - b.plays);
    return shuffled(sorted.slice(0, Math.max(6, Math.ceil(sorted.length / 2)))).slice(0, 14);
  }
  function artists() {
    const m = new Map();
    for (const t of S.all) {
      const k = norm(t.artist);
      if (!m.has(k)) m.set(k, { name: t.artist, tracks: [], plays: 0 });
      const a = m.get(k); a.tracks.push(t); a.plays += t.plays;
    }
    return [...m.values()].sort((a, b) => b.plays - a.plays || b.tracks.length - a.tracks.length);
  }
  function genres() {
    const m = new Map();
    for (const t of S.all) { if (!t.genre) continue; const k = norm(t.genre); if (!m.has(k)) m.set(k, { name: t.genre, n: 0 }); m.get(k).n++; }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }

  // ---------- rendu : composants ----------
  function card(t, ctx, i) {
    const cur = current();
    return `<div class="card${cur && cur.id === t.id ? " is-current" : ""}" style="--i:${Math.min(i, 12)}" data-ctx="${ctx}" data-i="${i}" role="button" tabindex="0" aria-label="Écouter ${esc(t.title)} de ${esc(t.artist)}">
      <div class="art">${imgTag(t)}${t.ai ? '<span class="ai-tag">IA</span>' : ""}
        <button class="fab" type="button" tabindex="-1" aria-hidden="true">${cur && cur.id === t.id && !audio.paused ? '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'}</button></div>
      <strong>${esc(t.title)}</strong><span class="sub">${esc(t.artist)}</span></div>`;
  }
  function shelf(title, sub, tracks, ctx, more) {
    if (!tracks.length) return "";
    S.ctx[ctx] = tracks;
    return `<section><div class="sec-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>${more || ""}</div>
      <div class="shelf">${tracks.map((t, i) => card(t, ctx, i)).join("")}</div></section>`;
  }
  function artistShelf(list) {
    if (!list.length) return "";
    return `<section><div class="sec-head"><div><h2>Artistes</h2><p>Les talents de DOZE, connus ou en herbe</p></div></div>
      <div class="shelf">${list.slice(0, 20).map(a => `<div class="card artist" data-artist="${esc(a.name)}" role="button" tabindex="0">
        <div class="art">${imgTag(a.tracks[0])}</div><strong>${esc(a.name)}</strong><span class="sub">${plural(a.tracks.length, "titre")}</span></div>`).join("")}</div></section>`;
  }
  function rows(tracks, ctx, opts = {}) {
    if (!tracks.length) return "";
    S.ctx[ctx] = tracks;
    const cur = current();
    return `<ol class="list">${tracks.map((t, i) => {
      const playing = cur && cur.id === t.id;
      return `<li class="row-t${playing ? " is-current" : ""}" data-ctx="${ctx}" data-i="${i}" tabindex="0">
        <span class="t-num">${playing ? `<span class="eq${audio.paused ? " paused" : ""}"><i></i><i></i><i></i></span>` : i + 1}</span>
        ${imgTag(t, "t-cover")}
        <span class="t-text"><span class="t-title">${offline[t.id] ? '<svg class="dl-mark" viewBox="0 0 24 24" aria-label="Téléchargé"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m-1 5h2v6l2.6-2.6L17 11.8 12 16.8l-5-5 1.4-1.4L11 13z"/></svg>' : ""}${esc(t.title)}</span><span class="t-sub">${opts.noArtist ? (t.genre ? esc(t.genre) : "Single") : `<button type="button" data-artist="${esc(t.artist)}">${esc(t.artist)}</button>`}</span></span>
        <span class="t-genre">${t.genre ? esc(t.genre) : ""}</span>
        <span class="t-plays">${plural(t.plays, "écoute")}${t.likes ? ` · ${nf.format(t.likes)} ♥` : ""}</span>
        <span class="t-acts">
          <button class="ic like" type="button" data-like="${t.id}" aria-pressed="${favs.has(t.id)}" aria-label="Coup de cœur"><svg viewBox="0 0 24 24"><path d="M12 21 10.6 19.7C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1a6 6 0 0 1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z"/></svg></button>
          ${opts.removable ? `<button class="ic" type="button" data-remove="${i}" aria-label="Retirer de la playlist"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>` : ""}
          <button class="ic" type="button" data-menu="${t.id}" aria-label="Plus d'options"><svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/></svg></button>
        </span></li>`;
    }).join("")}</ol>`;
  }
  const mobileBrand = `<div class="mobile-brand"><a class="brand" href="#accueil"><img class="brand-logo" src="brand/logo-doze.webp" alt="DOZE"></a><span class="mb-actions"><button class="ic" type="button" data-install title="Installer l'appli" aria-label="Installer l'appli"><svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg></button><button class="ic" type="button" data-share-app title="Partager DOZE" aria-label="Partager DOZE"><svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 0 0-2 .8L8.9 12.7a3 3 0 0 0 0-1.4L16 7.2A3 3 0 1 0 15 5l.1.7L8 9.8a3 3 0 1 0 0 4.4l7.1 4.2-.1.6a3 3 0 1 0 3-3"/></svg></button><span class="ver">v${VERSION}</span></span></div>`;
  const playIcon = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const shuffleIcon = '<svg viewBox="0 0 24 24"><path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2z"/></svg>';
  function greeting() { const h = new Date().getHours(); return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; }

  // ---------- vues ----------
  const views = {
    accueil() {
      if (!S.loaded) return mobileBrand + `<h1 class="greet">${greeting()}</h1><div class="empty">Chargement des créations…</div>`;
      if (S.offlineMode && !S.all.length) return mobileBrand + `<div class="empty">Pas de connexion et aucun titre téléchargé.</div>`;
      if (S.error) return mobileBrand + `<div class="empty">Impossible de charger les chansons. Vérifie ta connexion, puis recharge la page.</div>`;
      if (!S.all.length) return mobileBrand + `<h1 class="greet">${greeting()}</h1><div class="empty"><strong>DOZE attend sa première chanson.</strong><span>Publie la tienne : elle sera la première que le monde entendra ici.</span><a class="btn btn-gold" href="#publier">Publier ma chanson</a></div>`;
      const top = popular()[0];
      S.ctx.hero = [top];
      const recent = history.map(byId).filter(Boolean).slice(0, 12);
      const showInstall = !isInstalled() && matchMedia("(max-width: 860px)").matches && !store.get("noInstallBanner", false);
      return mobileBrand + `${S.offlineMode ? '<div class="offline-banner">📴 Hors connexion : tu écoutes tes titres téléchargés.</div>' : ""}${showInstall ? `<div class="install-banner"><img src="icon-192.png" alt=""><span><b>Installe DOZE</b>Sur ton écran d'accueil, comme une vraie appli, même hors connexion.</span><button class="btn btn-gold" type="button" data-install>Installer</button><button class="ic" type="button" data-hide-install aria-label="Masquer"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button></div>` : ""}<h1 class="greet">${greeting()}</h1>
        <section class="hero">
          <div class="hero-bg" style="background-image:url('${esc(coverOf(top))}')"></div>
          ${imgTag(top)}
          <div class="hero-text">
            <span class="eyebrow">À la une · le plus écouté</span>
            <h1>${esc(top.title)}</h1>
            <span class="by">${esc(top.artist)}${top.genre ? " · " + esc(top.genre) : ""}</span>
            <div class="stats"><span>${plural(top.plays, "écoute")}</span>${top.likes ? `<span>${nf.format(top.likes)} ♥</span>` : ""}</div>
            <div class="hero-actions">
              <button class="btn btn-gold" type="button" data-ctx="hero" data-i="0">${playIcon} Écouter</button>
              <button class="btn" type="button" data-shuffle-all>${shuffleIcon} Tout en aléatoire</button>
            </div>
          </div>
        </section>
        ${shelf("Écoutés récemment", "", recent, "recent")}
        ${shelf("Coups de cœur de la semaine", "Les titres les plus aimés ces 7 derniers jours", S.week, "week")}
        ${shelf("Nouveautés", "Les dernières créations publiées", newest().slice(0, 16), "new", `<a class="link" href="#rechercher">Tout voir</a>`)}
        ${shelf("Pépites à découvrir", "Des titres encore peu écoutés, mis en avant à tour de rôle", gems(), "gems")}
        ${shelf("Les plus écoutées", "", popular().slice(0, 16), "top")}
        ${artistShelf(artists())}
        ${genres().length ? `<section><div class="sec-head"><div><h2>Parcourir par genre</h2></div></div><div class="genres">${genres().map(g => `<button class="genre" type="button" data-genre="${esc(g.name)}" style="background:${genreBg(g.name)}">${esc(g.name)}<small>${plural(g.n, "titre")}</small></button>`).join("")}</div></section>` : ""}`;
    },
    rechercher() {
      const q = norm(S.q);
      const g = S.genre ? norm(S.genre) : null;
      const res = S.all.filter(t => (!g || norm(t.genre) === g) && (!q || norm(t.title + " " + t.artist + " " + (t.genre || "")).includes(q)));
      const gs = genres();
      return mobileBrand + `<h1 class="greet">Rechercher</h1>
        <label class="search"><svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9"/></svg>
          <input id="q" type="search" placeholder="Titre, artiste ou genre" value="${esc(S.q)}" autocomplete="off" aria-label="Rechercher"></label>
        ${gs.length ? `<div class="chips"><button class="chip${!S.genre ? " is-on" : ""}" type="button" data-chip="">Tout</button>${gs.map(x => `<button class="chip${g === norm(x.name) ? " is-on" : ""}" type="button" data-chip="${esc(x.name)}">${esc(x.name)}</button>`).join("")}</div>` : ""}
        <div class="sec-head"><div><h2>${q || g ? plural(res.length, "résultat") : "Tous les titres"}</h2></div>${res.length ? `<button class="link" type="button" data-play-ctx="search">Tout écouter</button>` : ""}</div>
        ${res.length ? rows(res, "search") : `<div class="empty">Aucune chanson ne correspond${S.q ? ` à « ${esc(S.q)} »` : ""}.</div>`}`;
    },
    bibliotheque() {
      const f = [...favs].map(byId).filter(Boolean);
      const h = history.map(byId).filter(Boolean);
      return mobileBrand + `<div class="page-head"><div class="ph-bg" style="background:linear-gradient(135deg,#2E4A8C,#0F121B 75%)"></div>
          <div class="ph-text"><span class="eyebrow">Ma bibliothèque</span><h1>Coups de cœur</h1><span class="stats">${plural(f.length, "titre")} · gardés sur cet appareil, sans compte</span></div></div>
        ${f.length ? `<div class="page-actions"><button class="btn btn-gold" type="button" data-play-ctx="favs">${playIcon} Écouter</button><button class="btn" type="button" data-shuffle-ctx="favs">${shuffleIcon} Aléatoire</button></div>${rows(f, "favs")}`
          : `<div class="empty">Touche le cœur à côté d'une chanson pour la retrouver ici.</div>`}
        <div class="sec-head"><div><h2>Téléchargés</h2><p>${Object.keys(offline).length ? plural(Object.keys(offline).length, "titre") + " · " + fmtSize(Object.values(offline).reduce((a, o) => a + (o.size || 0), 0)) + " · écoutables sans connexion" : "Écoute tes titres sans connexion, comme sur Deezer"}</p></div>${f.some(x => canOffline(x) && !offline[x.id]) ? `<button class="link" type="button" data-dl-favs>⬇ Télécharger mes coups de cœur</button>` : ""}</div>
        ${Object.keys(offline).length ? `<div class="page-actions"><button class="btn btn-gold" type="button" data-play-ctx="off">${playIcon} Écouter</button><button class="btn" type="button" data-shuffle-ctx="off">${shuffleIcon} Aléatoire</button></div>${rows(Object.values(offline).sort((a, b) => b.at - a.at).map(o => byId(o.t.id) || o.t), "off")}`
          : `<div class="empty">Touche ⋮ sur une chanson puis « Télécharger », ou le bouton ⬇ dans le lecteur.</div>`}
        <div class="sec-head"><div><h2>Mes playlists</h2><p>Partage-les avec un simple lien</p></div><button class="link" type="button" data-newlist>+ Nouvelle playlist</button></div>
        ${myLists.length ? `<div class="shelf">${myLists.map(pl => `<div class="card" data-open-list="${esc(pl.id)}" role="button" tabindex="0"><div class="art playlist-art" style="background:${genreBg(pl.name)}"><svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-2V8h2v6.2a3 3 0 1 1-2 2.8z"/></svg></div><strong>${esc(pl.name)}</strong><span class="sub">${pl.key ? "Ma playlist" : "Enregistrée"}</span></div>`).join("")}</div>`
          : `<div class="empty">Crée une playlist, puis ajoute des titres avec le menu ⋮ d'une chanson.</div>`}
        ${h.length ? `<div class="sec-head"><div><h2>Historique</h2><p>Tes dernières écoutes</p></div></div>${rows(h.slice(0, 30), "hist")}` : ""}`;
    },
    playlist() {
      const pl = S.list;
      if (!pl) return mobileBrand + `<div class="empty">Chargement de la playlist…</div>`;
      if (pl.missing) return mobileBrand + `<div class="empty">Cette playlist n'existe plus.</div>`;
      const mine = myLists.find(x => x.id === pl.id);
      const owner = !!(mine && mine.key);
      const list = pl.tracks.map(byId).filter(Boolean);
      return mobileBrand + `<div class="page-head"><div class="ph-bg" style="background:linear-gradient(135deg, ${genreColors(pl.name)[0]}, #0F121B 80%)"></div>
          <div class="ph-art square playlist-art" style="background:${genreBg(pl.name)}"><svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-2V8h2v6.2a3 3 0 1 1-2 2.8z"/></svg></div>
          <div class="ph-text"><span class="eyebrow">Playlist</span><h1>${esc(pl.name)}</h1><span class="stats">${plural(list.length, "titre")}</span></div></div>
        <div class="page-actions">
          ${list.length ? `<button class="btn btn-gold" type="button" data-play-ctx="pl">${playIcon} Écouter</button><button class="btn" type="button" data-shuffle-ctx="pl">${shuffleIcon} Aléatoire</button>` : ""}
          <button class="btn" type="button" data-share-list>Partager</button>
          ${owner ? `<button class="btn" type="button" data-rename-list>Renommer</button><button class="btn" type="button" data-delete-list>Supprimer</button>` : mine ? "" : `<button class="btn" type="button" data-save-list>Enregistrer</button>`}
        </div>
        ${list.length ? rows(list, "pl", { removable: owner }) : `<div class="empty">${owner ? "Ajoute des titres avec le menu ⋮ d'une chanson, puis « Ajouter à une playlist »." : "Cette playlist est vide."}</div>`}`;
    },
    artiste() {
      const name = S.param || "";
      const list = S.all.filter(t => norm(t.artist) === norm(name));
      if (!list.length) return mobileBrand + `<div class="empty">Cet artiste n'a pas encore de chanson sur DOZE.</div>`;
      const plays = list.reduce((s, t) => s + t.plays, 0);
      const [a, b] = genreColors(name);
      return mobileBrand + `<div class="page-head"><div class="ph-bg" style="background:linear-gradient(135deg, ${a}, #0F121B 80%)"></div>
          ${imgTag(list[0], "ph-art")}
          <div class="ph-text"><span class="eyebrow">Artiste</span><h1>${esc(name)}</h1><span class="stats">${plural(list.length, "titre")} · ${plural(plays, "écoute")}</span></div></div>
        <div class="page-actions"><button class="btn btn-gold" type="button" data-play-ctx="artist">${playIcon} Écouter</button><button class="btn" type="button" data-shuffle-ctx="artist">${shuffleIcon} Aléatoire</button></div>
        ${rows(list.sort((x, y) => y.plays - x.plays), "artist", { noArtist: true })}
        <section class="stats-box" id="stats" aria-live="polite"></section>`;
    },
    genre() {
      const name = S.param || "";
      const list = S.all.filter(t => norm(t.genre) === norm(name)).sort((x, y) => y.plays - x.plays);
      return mobileBrand + `<div class="page-head"><div class="ph-bg" style="background:${genreBg(name)}"></div>
          <div class="ph-text"><span class="eyebrow">Genre</span><h1>${esc(name)}</h1><span class="stats">${plural(list.length, "titre")}</span></div></div>
        ${list.length ? `<div class="page-actions"><button class="btn btn-gold" type="button" data-play-ctx="genre">${playIcon} Écouter</button><button class="btn" type="button" data-shuffle-ctx="genre">${shuffleIcon} Aléatoire</button></div>${rows(list, "genre")}` : `<div class="empty">Aucun titre dans ce genre pour l'instant.</div>`}`;
    },
    publier() {
      const tools = ["Suno", "Udio", "BandLab", "FL Studio", "GarageBand", "Logic Pro", "Ableton Live", "Mureka", "Enregistrement maison", "Studio"];
      return mobileBrand + `<div class="publish">
        <div>
          <div class="publish-head"><span class="eyebrow">Gratuit · sans compte · ouvert à tous</span><h1>Publie ta chanson</h1>
            <p>Talent en herbe, artiste confirmé ou créateur IA : ta musique rejoint DOZE et devient écoutable par tout le monde. Les nouveaux titres passent dans « Pépites à découvrir » pour trouver leurs premiers auditeurs.</p></div>
          <div class="seg seg4" role="group" aria-label="Méthode">
            <button class="${pubMode === "link" ? "is-on" : ""}" data-mode="link" type="button">Suno</button>
            <button class="${pubMode === "pl" ? "is-on" : ""}" data-mode="pl" type="button">Playlist · profil Suno</button>
            <button class="${pubMode === "file" ? "is-on" : ""}" data-mode="file" type="button">Fichier audio</button>
            <button class="${pubMode === "ext" ? "is-on" : ""}" data-mode="ext" type="button">SoundCloud · YouTube</button>
          </div>
          <form id="add-form" novalidate>
            <div class="suno-steps" data-for="link" ${pubMode === "link" ? "" : "hidden"}>
              <strong>Avant de coller ton lien : ta chanson doit être <em>publique</em> sur Suno</strong>
              <ol>
                <li>Sur Suno, ouvre ta chanson, touche <b>⋯</b> puis <b>Visibilité › Publique</b>.</li>
                <li>Attends une à deux minutes que Suno prépare la version publique.</li>
                <li>Touche <b>⋯ › Partager › Copier le lien</b>, puis colle-le ci-dessous.</li>
              </ol>
              <span>Une chanson privée n'a pas de son pour les autres : DOZE la refusera. Tu peux aussi choisir « Fichier audio ».</span>
            </div>
            <div class="field" data-for="link" ${pubMode === "link" ? "" : "hidden"}>
              <label for="f-link">Lien de la chanson sur Suno</label>
              <input id="f-link" type="url" inputmode="url" placeholder="https://suno.com/song/…" autocomplete="off">
              <small>Format attendu : https://suno.com/song/…</small>
            </div>
            <div class="suno-steps" data-for="file" ${pubMode === "file" ? "" : "hidden"}>
              <strong>Depuis n'importe quelle appli ou ton studio</strong>
              <span>Udio, BandLab, FL Studio, GarageBand, Mureka, un enregistrement au téléphone… Exporte ta chanson en <b>MP3</b>, <b>M4A</b> ou <b>WAV</b> (15 Mo max), puis choisis le fichier ci-dessous.</span>
            </div>
            <div class="field" data-for="file" ${pubMode === "file" ? "" : "hidden"}>
              <label for="f-audio">Fichier audio</label>
              <input id="f-audio" type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a">
            </div>
            <div class="field" data-for="file" ${pubMode === "file" ? "" : "hidden"}>
              <label for="f-cover">Pochette (facultatif, JPG ou PNG)</label>
              <input id="f-cover" type="file" accept="image/jpeg,image/png,image/webp">
            </div>
            <div class="suno-steps" data-for="pl" ${pubMode === "pl" ? "" : "hidden"}>
              <strong>Importe une playlist ou tout ton profil Suno en une fois</strong>
              <span>Colle le lien d'une <b>playlist</b> (⋯ › Partager › Copier le lien) ou de ton <b>profil</b> (suno.com/@ton-pseudo) : DOZE liste tes chansons, tu coches et tu importes. Seules les chansons <b>publiques</b> sur Suno peuvent être importées. Ta liste « J'aime » n'est pas accessible : elle n'est visible que connecté à ton compte.</span>
            </div>
            <div class="field" data-for="pl" ${pubMode === "pl" ? "" : "hidden"}>
              <label for="f-pl">Lien de la playlist ou de ton profil Suno</label>
              <input id="f-pl" type="url" inputmode="url" placeholder="https://suno.com/playlist/… ou https://suno.com/@ton-pseudo" autocomplete="off">
            </div>
            <div id="pl-box" class="pl-box" data-for="pl" ${pubMode === "pl" ? "" : "hidden"}></div>
            <div class="suno-steps" data-for="ext" ${pubMode === "ext" ? "" : "hidden"}>
              <strong>Ta chanson est déjà sur SoundCloud ou YouTube ?</strong>
              <span>Colle son lien : elle sera lue sur DOZE avec le lecteur officiel de SoundCloud ou YouTube, qui s'affiche sur la pochette. La chanson doit être publique et autoriser l'intégration.</span>
            </div>
            <div class="field" data-for="ext" ${pubMode === "ext" ? "" : "hidden"}>
              <label for="f-ext">Lien SoundCloud ou YouTube</label>
              <input id="f-ext" type="url" inputmode="url" placeholder="https://soundcloud.com/… ou https://youtu.be/…" autocomplete="off">
              <small>Exemples : soundcloud.com/artiste/titre · youtube.com/watch?v=… · youtu.be/…</small>
            </div>
            <div class="two">
              <div class="field" ${pubMode === "pl" ? "hidden" : ""}><label for="f-title">Titre</label><input id="f-title" maxlength="120" required autocomplete="off"></div>
              <div class="field"><label for="f-artist">Nom d'artiste</label><input id="f-artist" maxlength="80" required autocomplete="nickname" value="${esc(store.get("artist", ""))}"></div>
            </div>
            <div class="two">
              <div class="field"><label for="f-genre">Genre (facultatif)</label><input id="f-genre" maxlength="40" list="genres-list" autocomplete="off">
                <datalist id="genres-list">${["Afrobeat", "Coupé-décalé", "Zouglou", "Rap", "R&B", "Pop", "Gospel", "Reggae", "Électro", "Rock", "Jazz", "Classique", ...genres().map(g => g.name)].filter((v, i, a) => a.indexOf(v) === i).map(g => `<option>${esc(g)}</option>`).join("")}</datalist></div>
              <div class="field"><label for="f-made">Créé avec (facultatif)</label><input id="f-made" maxlength="40" list="tools-list" autocomplete="off" ${pubMode === "link" || pubMode === "pl" ? 'value="Suno"' : ""}>
                <datalist id="tools-list">${tools.map(x => `<option>${x}</option>`).join("")}</datalist></div>
            </div>
            <label class="check" ${pubMode === "pl" ? "hidden" : ""}><input id="f-ai" type="checkbox" ${pubMode === "link" ? "checked disabled" : ""}><span>Cette chanson a été créée avec l'aide de l'IA. <small>Les auditeurs voient une petite mention « IA » : la transparence rassure.</small></span></label>
            <div class="field" ${pubMode === "pl" ? "hidden" : ""}><label for="f-lyrics">Paroles (facultatif)</label><textarea id="f-lyrics" rows="6" maxlength="8000" placeholder="Colle ici les paroles. Elles défileront sur la pochette pendant l'écoute."></textarea>
              <small>Astuce : au format LRC (<code>[01:23.45] ma ligne</code>), elles seront parfaitement synchronisées. Sinon, DOZE estime le rythme.</small></div>
            <label class="check"><input id="f-rights" type="checkbox" required><span>Je suis l'auteur de cette chanson (ou j'ai le droit de la diffuser) et j'accepte qu'elle soit écoutée gratuitement par tous.</span></label>
            <p id="form-msg" class="form-msg" role="status"></p>
            <div><button id="submit" class="btn btn-gold" type="submit">Publier</button></div>
          </form>
          <ul class="perks"><li>Aucun compte à créer, aucune pub, aucun frais.</li><li>Ouvert à tous : débutants, artistes confirmés et créateurs IA.</li><li>Les nouveaux titres sont mis en avant, pas seulement les plus écoutés.</li></ul>
        </div>
        <aside class="preview-card" id="preview" aria-live="polite">
          <div class="art"><img id="pv-cover" alt="" hidden></div>
          <strong id="pv-title">Aperçu</strong><span class="t-sub" id="pv-artist">Ta pochette et ton son apparaîtront ici</span>
          <audio id="pv-audio" controls preload="none" hidden></audio>
          <p class="hint">Vérifie que le son se lance avant de publier.</p>
        </aside></div>`;
    }
  };

  function render() {
    $("setup").hidden = ready;
    S.ctx = {};
    const v = views[S.view] ? S.view : "accueil";
    try { $("view").innerHTML = views[v](); }
    catch (err) { console.error(err); $("view").innerHTML = `<div class="empty"><strong>Un souci d'affichage est survenu.</strong><button class="btn btn-gold" type="button" onclick="location.reload()">Recharger</button></div>`; return; }
    document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("is-on", a.dataset.nav === (v === "artiste" || v === "genre" ? "rechercher" : v === "playlist" ? "bibliotheque" : v)));
    syncInstall();
    if (v === "publier") bindPublish();
    if (v === "artiste") loadStats(S.param);
    if (v === "rechercher") { const q = $("q"); q.oninput = e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; const pos = q.selectionStart; render(); const nq = $("q"); nq.focus(); nq.setSelectionRange(pos, pos); }, 250); }; }
  }
  let qTimer;
  // Mise à jour légère de l'état « en cours » sans tout redessiner (garde le défilement des rayons).
  function refreshCurrent() {
    const cur = current();
    document.querySelectorAll(".card[data-ctx], .row-t[data-ctx]").forEach(el => {
      const t = (S.ctx[el.dataset.ctx] || [])[+el.dataset.i]; if (!t) return;
      const on = !!cur && cur.id === t.id;
      el.classList.toggle("is-current", on);
      if (el.classList.contains("row-t")) el.querySelector(".t-num").innerHTML = on ? `<span class="eq${audio.paused ? " paused" : ""}"><i></i><i></i><i></i></span>` : (+el.dataset.i + 1);
      const fab = el.querySelector(".fab"); if (fab) fab.innerHTML = on && !audio.paused ? '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>' : playIcon;
    });
  }

  // ---------- navigation ----------
  const ROUTES = ["accueil", "rechercher", "bibliotheque", "publier"];
  function go(view, param) {
    S.view = view; S.param = param ?? null;
    if (ROUTES.includes(view) && location.hash !== "#" + view) location.hash = view;
    render(); $("main").scrollTop = 0; closeNP();
  }
  document.querySelectorAll("[data-nav]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); go(a.dataset.nav); }));
  document.querySelectorAll(".brand").forEach(a => a.addEventListener("click", e => { e.preventDefault(); go("accueil"); }));
  $("view").addEventListener("click", e => { const a = e.target.closest('a[href^="#"]'); if (a && ROUTES.includes(a.getAttribute("href").slice(1))) { e.preventDefault(); go(a.getAttribute("href").slice(1)); } });
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (ROUTES.includes(h) && (S.view !== h)) { S.view = h; S.param = null; render(); $("main").scrollTop = 0; closeNP(); }
  });

  // ---------- clics dans les vues ----------
  $("view").addEventListener("click", e => {
    const like = e.target.closest("[data-like]"); if (like) { toggleFav(like.dataset.like); return; }
    if (e.target.closest("[data-newlist]")) { newList(); return; }
    if (e.target.closest("[data-dl-favs]")) { (async () => { for (const x of [...favs].map(byId).filter(x => x && canOffline(x) && !offline[x.id])) await downloadTrack(x, true); toast("Tes coups de cœur sont disponibles hors ligne"); })(); return; }
    const ol = e.target.closest("[data-open-list]"); if (ol) { openList(ol.dataset.openList); return; }
    const rm = e.target.closest("[data-remove]"); if (rm) { editList(S.list.id, ids => ids.filter((_, k) => k !== +rm.dataset.remove)); return; }
    if (e.target.closest("[data-share-list]")) { shareList(S.list); return; }
    if (e.target.closest("[data-rename-list]")) { const n = prompt("Nouveau nom de la playlist", S.list.name); if (n && n.trim()) editList(S.list.id, ids => ids, n.trim().slice(0, 80)); return; }
    if (e.target.closest("[data-delete-list]")) { deleteList(e.target.closest("[data-delete-list]")); return; }
    if (e.target.closest("[data-save-list]")) { myLists.push({ id: S.list.id, key: null, name: S.list.name }); store.set("playlists", myLists); toast("Playlist enregistrée dans ta bibliothèque"); render(); return; }
    const menu = e.target.closest("[data-menu]"); if (menu) { openMenu(menu, byId(menu.dataset.menu)); return; }
    const art = e.target.closest("[data-artist]"); if (art) { go("artiste", art.dataset.artist); return; }
    const gen = e.target.closest("[data-genre]"); if (gen) { go("genre", gen.dataset.genre); return; }
    const chip = e.target.closest("[data-chip]"); if (chip) { S.genre = chip.dataset.chip || null; render(); return; }
    const pc = e.target.closest("[data-play-ctx]"); if (pc) { const l = S.ctx[pc.dataset.playCtx]; if (l) { setShuffle(false); startQueue(l, 0, true, ctxLabel(pc.dataset.playCtx)); } return; }
    const sc = e.target.closest("[data-shuffle-ctx]"); if (sc) { const l = S.ctx[sc.dataset.shuffleCtx]; if (l) { setShuffle(true); startQueue(l, Math.floor(Math.random() * l.length), true, ctxLabel(sc.dataset.shuffleCtx)); } return; }
    if (e.target.closest("[data-shuffle-all]")) { setShuffle(true); startQueue(S.all, Math.floor(Math.random() * S.all.length), true, ["Aléatoire", "Tout DOZE"]); return; }
    const item = e.target.closest("[data-ctx]");
    if (item) {
      const list = S.ctx[item.dataset.ctx]; const i = +item.dataset.i; const t = list && list[i]; if (!t) return;
      const cur = current();
      if (cur && cur.id === t.id) { togglePlay(); return; }
      startQueue(list, i, true, ctxLabel(item.dataset.ctx));
    }
  });
  $("view").addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-ctx][tabindex], [data-artist][tabindex], [data-open-list][tabindex]")) { e.preventDefault(); e.target.click(); }
  });

  document.addEventListener("click", e => {
    if (e.target.closest("[data-install]")) { e.preventDefault(); installApp(); }
    else if (e.target.closest("[data-share-app]")) { e.preventDefault(); shareApp(); }
    else if (e.target.closest("[data-hide-install]")) { store.set("noInstallBanner", true); const b = e.target.closest(".install-banner"); if (b) b.remove(); }
  });

  // ---------- coups de cœur ----------
  function toggleFav(id) {
    const on = !favs.has(id);
    if (on) { favs.add(id); toast("Ajouté à tes coups de cœur"); } else { favs.delete(id); toast("Retiré de tes coups de cœur"); }
    store.set("favs", [...favs]);
    if (sb && S.hasV2) sb.rpc("like_track", { p_track: id, p_device: device, p_on: on }).then(r => {
      if (r.error || typeof r.data !== "number") return;
      const t = byId(id); if (t) t.likes = r.data;
      const c = current(); if (c && c.id === id) { c.likes = r.data; renderTags(c); }
    });
    document.querySelectorAll(`[data-like="${CSS.escape(id)}"]`).forEach(b => b.setAttribute("aria-pressed", favs.has(id)));
    syncLike();
    if (S.view === "bibliotheque") render();
  }
  function syncLike() { const t = current(); const on = !!t && favs.has(t.id); ["b-like", "np-like"].forEach(i => { $(i).setAttribute("aria-pressed", on); $(i).disabled = !t; }); }

  // ---------- menu contextuel ----------
  let menuEl;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMenu(btn, t, items) {
    closeMenu();
    menuEl = document.createElement("div");
    menuEl.className = "menu";
    menuEl.innerHTML = items || `<button type="button" data-a="next">Écouter juste après</button><button type="button" data-a="radio">📻 Radio de ce titre</button><button type="button" data-a="dedic">🎁 Dédicacer ce son</button>${t && canOffline(t) ? (offline[t.id] ? '<button type="button" data-a="undl">✓ Retirer des téléchargements</button>' : '<button type="button" data-a="dl">⬇ Télécharger (hors ligne)</button>') : ""}<button type="button" data-a="addlist">Ajouter à une playlist</button><button type="button" data-a="artist">Voir l'artiste</button><button type="button" data-a="share">Partager</button>${t && editKey(t) && S.hasV4 ? '<button type="button" data-a="lyredit">✎ Paroles et synchro</button>' : ""}<div class="sep"></div><button type="button" data-a="report" class="danger">Signaler un abus</button>${t && adminKey && S.hasV4 ? '<button type="button" data-a="admdel" class="danger">🗑 Supprimer ce titre (admin)</button>' : ""}`;
    document.body.appendChild(menuEl);
    const r = btn.getBoundingClientRect(), mh = menuEl.offsetHeight;
    const top = r.bottom + 6 + mh > innerHeight ? r.top - mh - 6 : r.bottom + 6;
    menuEl.style.top = (scrollY + Math.max(8, top)) + "px";
    menuEl.style.left = Math.max(8, Math.min(scrollX + r.right - menuEl.offsetWidth, innerWidth - menuEl.offsetWidth - 8)) + "px";
    menuEl.onclick = async ev => {
      const b = ev.target.closest("button"); if (!b) return;
      const a = b.dataset.a;
      if (a === "share") share(t);
      if (a === "artist") go("artiste", t.artist);
      if (a === "next") playNext(t);
      if (a === "dl") downloadTrack(t);
      if (a === "lyredit") { S.editTrack = t; closeMenu(); openSheet("lyredit"); return; }
      if (a === "admdel") {
        if (menuEl.dataset.del !== "1") { menuEl.dataset.del = "1"; b.textContent = "Confirmer la suppression définitive"; return; }
        const r = await sb.rpc("admin_delete_track", { p_id: t.id, p_key: adminKey });
        toast(r.data === true ? "Titre supprimé" : "Suppression impossible"); if (r.data === true) { if (offline[t.id]) removeOffline(t.id); await load(); }
      }
      if (a === "undl") removeOffline(t.id);
      if (a === "radio") { startRadio(t); closeMenu(); return; }
      if (a === "dedic") { S.dedTrack = t; closeMenu(); openSheet("dedic"); return; }
      if (a === "addlist") { const own = myLists.filter(x => x.key); closeMenu(); openMenu(btn, t, own.map(x => `<button type="button" data-a="to:${esc(x.id)}">${esc(x.name)}</button>`).join("") + (own.length ? '<div class="sep"></div>' : "") + '<button type="button" data-a="tonew">+ Nouvelle playlist…</button>'); return; }
      if (a && a.startsWith("to:")) editList(a.slice(3), ids => ids.includes(t.id) ? ids : [...ids, t.id], null, "Ajouté à « %s »");
      if (a === "tonew") newList([t.id]);
      if (a === "report") {
        if (menuEl.dataset.confirm !== "1") { menuEl.dataset.confirm = "1"; b.textContent = "Confirmer le signalement"; return; }
        if (sb) await sb.rpc("report_track", { track: t.id });
        toast("Merci, la chanson a été signalée.");
      }
      if (a && a.startsWith("sleep")) setSleep(a.slice(6));
      closeMenu();
    };
  }
  document.addEventListener("click", e => { if (menuEl && e.target.isConnected && !menuEl.contains(e.target) && !e.target.closest("[data-menu], #b-sleep, #np-more")) closeMenu(); });

  // ---------- étiquettes, paroles ----------
  function renderTags(t) {
    $("np-tags").innerHTML = `${t.ai ? `<span class="ai">Créé avec l'IA${t.made_with ? " · " + esc(t.made_with) : ""}</span>` : t.made_with ? `<span>${esc(t.made_with)}</span>` : ""}${t.genre ? `<span>${esc(t.genre)}</span>` : ""}<span>${plural(t.plays, "écoute")}</span>${t.likes ? `<span>${nf.format(t.likes)} ♥</span>` : ""}`;
  }
  S.npTab = "queue";
  S.showLyr = store.get("showLyr", true);
  // Paroles : format LRC ([01:23.45] ligne) si l'artiste l'a fourni, sinon synchronisation estimée sur la durée.
  function parseLyrics(text) {
    const timed = [], plain = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2}(?:[.,]\d{1,3})?)\]/g)];
      const line = raw.replace(/\[[^\]]*\]/g, "").trim();
      if (tags.length) { for (const m of tags) timed.push({ t: +m[1] * 60 + parseFloat(m[2].replace(",", ".")), text: line }); continue; }
      if (!line) { if (/^\s*\[[^\]]+\]\s*$/.test(raw) && plain.length) plain[plain.length - 1].gap = true; continue; }
      if (/^\(.*\)$/.test(line)) continue;
      plain.push({ text: line });
    }
    if (timed.length >= 3) return { lines: timed.filter(l => l.text).sort((a, b) => a.t - b.t), timed: true };
    return { lines: plain, timed: false };
  }
  function estimateTimes(L, dur) {
    if (L.timed || !(dur > 0) || !L.lines.length) return;
    // Durée de chaque ligne proportionnelle à sa longueur, plus une respiration après chaque section.
    const start = Math.min(14, dur * .07), end = dur * .94, w = L.lines.map(l => l.text.length + 14 + (l.gap ? 40 : 0)), tot = w.reduce((a, b) => a + b, 0);
    let acc = start; L.lines.forEach((l, i) => { l.t = acc; acc += (end - start) * w[i] / tot; });
    L.estimated = true;
  }
  async function loadLyr(t) {
    S.lyr = { id: t.id, lines: [], timed: false, loading: true }; renderLyr(true);
    let text = null;
    if (offline[t.id] && offline[t.id].lyrics) text = offline[t.id].lyrics;
    else if (sb && S.hasV2 && !S.offlineMode) { try { const r = await sb.from("tracks").select("lyrics").eq("id", t.id).maybeSingle(); text = r.data && r.data.lyrics; } catch {} }
    if (!current() || current().id !== t.id) return;
    S.lyrRaw = text || "";
    S.lyr = { id: t.id, ...parseLyrics(text) }; applyMySync(S.lyr); estimateTimes(S.lyr, audio.duration); S.lyrIdx = -1; renderLyr(true);
  }
  function renderLyr(full) {
    const L = S.lyr, box = $("lyr"), pill = $("lyr-pill");
    const has = !!(L && L.lines && L.lines.length);
    pill.hidden = !has; pill.setAttribute("aria-pressed", S.showLyr);
    box.hidden = !(has && S.showLyr);
    if (!has || !S.showLyr) return;
    if (full) {
      $("lyr-lines").innerHTML = L.lines.map((l, i) => `<p data-l="${i}">${esc(l.text)}</p>`).join("");
      $("lyr-note").textContent = L.mine ? "Ta synchronisation" : L.timed ? "Paroles synchronisées" : "Synchronisation estimée · ajustable";
      $("lyr-off").textContent = fmtOff(lyrOff[L.id] || 0);
      S.lyrIdx = -1;
    }
    syncLyr();
  }
  function syncLyr() {
    const L = S.lyr; if (!L || !L.lines.length || $("lyr").hidden || $("np").hidden) return;
    if (!L.timed && !L.estimated) estimateTimes(L, audio.duration);
    if (S.tap) return;
    const tt = audio.currentTime + (lyrOff[L.id] || 0); let i = -1;
    for (let k = 0; k < L.lines.length; k++) { if (L.lines[k].t <= tt + .15) i = k; else break; }
    if (i === S.lyrIdx) return;
    S.lyrIdx = i;
    const ps = $("lyr-lines").children;
    for (let k = 0; k < ps.length; k++) { ps[k].classList.toggle("on", k === i); ps[k].classList.toggle("past", k < i); }
    const cur = ps[Math.max(0, i)];
    if (cur) { const box = $("lyr-lines"); box.scrollTo({ top: cur.offsetTop - box.clientHeight * .38, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  }
  $("lyr-pill").onclick = () => { S.showLyr = !S.showLyr; store.set("showLyr", S.showLyr); renderLyr(true); };
  // Réglages propres à cet appareil : décalage (secondes) et synchronisation faite au toucher
  const lyrOff = store.get("lyrOff", {}), mySync = store.get("lyrSync", {});
  const fmtOff = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1).replace(".", ",") + " s";
  function applyMySync(L) {
    const m = mySync[L.id];
    if (m && m.length === L.lines.length && !L.timed) { L.lines.forEach((l, i) => l.t = m[i]); L.timed = true; L.mine = true; }
  }
  function toLRC(L) { return L.lines.map(l => { const m = Math.floor(l.t / 60), sec = (l.t - m * 60).toFixed(2).padStart(5, "0"); return `[${String(m).padStart(2, "0")}:${sec}] ${l.text}`; }).join("\n"); }
  $("lyr").addEventListener("click", async e => {
    const b = e.target.closest("[data-lt]"); if (!b || !S.lyr) return;
    e.stopPropagation();
    const L = S.lyr, act = b.dataset.lt;
    if (act === "earlier" || act === "later") {
      lyrOff[L.id] = Math.round(((lyrOff[L.id] || 0) + (act === "earlier" ? .5 : -.5)) * 10) / 10; store.set("lyrOff", lyrOff);
      $("lyr-off").textContent = fmtOff(lyrOff[L.id]); S.lyrIdx = -2; syncLyr(); return;
    }
    if (act === "tap") { startTap(); return; }
    if (act === "next") { tapNext(); return; }
    if (act === "cancel") { S.tap = null; $("lyr").classList.remove("tapping"); renderLyr(true); return; }
    if (act === "publish") { publishSync(); return; }
  });
  function startTap() {
    const L = S.lyr; if (!L || !L.lines.length) return;
    S.tap = { i: 0, times: [] };
    $("lyr").classList.add("tapping");
    markTap();
    audio.currentTime = 0; if (audio.paused) audio.play().catch(() => {});
    toast("Touche « Ligne suivante » au moment où chaque ligne commence");
  }
  function markTap() {
    const ps = $("lyr-lines").children, i = S.tap.i;
    for (let k = 0; k < ps.length; k++) { ps[k].classList.toggle("on", k === i); ps[k].classList.toggle("past", k < i); }
    const cur = ps[i]; if (cur) $("lyr-lines").scrollTo({ top: cur.offsetTop - $("lyr-lines").clientHeight * .38, behavior: "smooth" });
    $("lyr-tap-count").textContent = `Ligne ${Math.min(i + 1, ps.length)} / ${ps.length}`;
  }
  function tapNext() {
    const T = S.tap, L = S.lyr; if (!T) return;
    T.times[T.i] = Math.max(0, audio.currentTime - .15); T.i++;
    if (T.i < L.lines.length) { markTap(); return; }
    mySync[L.id] = T.times; store.set("lyrSync", mySync);
    L.lines.forEach((l, i) => l.t = T.times[i]); L.timed = true; L.mine = true; lyrOff[L.id] = 0; store.set("lyrOff", lyrOff);
    S.tap = null; $("lyr").classList.remove("tapping"); renderLyr(true);
    const t = current();
    $("lyr-publish").hidden = !(t && editKey(t) && S.hasV4);
    toast(t && editKey(t) && S.hasV4 ? "Synchro enregistrée. Touche « Publier pour tous » pour la partager." : "Synchro enregistrée sur cet appareil");
  }
  async function publishSync() {
    const t = current(), L = S.lyr; if (!t || !L || !L.timed) return;
    const r = await sb.rpc("update_track_lyrics", { p_id: t.id, p_key: editKey(t), p_lyrics: toLRC(L) });
    if (r.data === true) { toast("Paroles synchronisées publiées pour tout le monde"); $("lyr-publish").hidden = true; if (offline[t.id]) { offline[t.id].lyrics = toLRC(L); store.set("offline", offline); } }
    else toast("Publication impossible : seul l'appareil qui a publié ce titre peut le modifier.");
  }
  document.addEventListener("keydown", e => { if (S.tap && (e.code === "Space" || e.key === "Enter") && !e.target.matches("input, textarea")) { e.preventDefault(); tapNext(); } }, true);
  $("lyr-lines").addEventListener("click", e => { const p = e.target.closest("[data-l]"); if (p && S.lyr && S.lyr.lines[+p.dataset.l].t != null) { audio.currentTime = S.lyr.lines[+p.dataset.l].t; if (audio.paused) audio.play(); } });
  async function loadLyrics() {
    const t = current(), box = $("np-lyrics"); if (!t) return;
    if (S.lyricsFor === t.id) return;
    S.lyricsFor = t.id; box.textContent = "Chargement des paroles…";
    let text = null;
    if (sb && S.hasV2) { const r = await sb.from("tracks").select("lyrics").eq("id", t.id).maybeSingle(); text = r.data && r.data.lyrics; }
    if (current() !== t) return;
    box.textContent = text || "Pas de paroles pour ce titre. L'artiste peut les ajouter en le publiant.";
    box.classList.toggle("none", !text);
  }
  document.querySelectorAll("[data-np-tab]").forEach(b => b.onclick = () => {
    S.npTab = b.dataset.npTab;
    document.querySelectorAll("[data-np-tab]").forEach(x => x.setAttribute("aria-selected", x === b));
    $("np-queue").hidden = S.npTab !== "queue"; $("np-lyrics").hidden = S.npTab !== "lyrics";
    if (S.npTab === "lyrics") loadLyrics();
  });

  // ---------- statistiques d'artiste ----------
  async function loadStats(name) {
    const box = $("stats"); if (!box || !sb || !S.hasV2) return;
    const r = await sb.rpc("artist_stats", { p_artist: name });
    if (r.error || !r.data || S.view !== "artiste" || S.param !== name) return;
    const st = r.data, days = [], map = new Map((st.days || []).map(d => [d.day, d.n]));
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = d.toISOString().slice(0, 10); days.push({ k, d, n: map.get(k) || 0 }); }
    const max = Math.max(1, ...days.map(d => d.n));
    const W = 600, H = 150, bw = W / 30;
    const df = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
    const bars = days.map((d, i) => { const h = d.n ? Math.max(4, d.n / max * (H - 8)) : 0; const x = i * bw + 1;
      return `<g class="bar"><rect class="hit" x="${i * bw}" y="0" width="${bw}" height="${H}"></rect>${h ? `<path d="M${x} ${H}V${H - h + 4}q0-4 4-4h${bw - 10}q4 0 4 4V${H}z"></path>` : `<rect class="zero" x="${x}" y="${H - 1}" width="${bw - 2}" height="1"></rect>`}<title>${df.format(d.d)} : ${plural(d.n, "écoute")}</title></g>`; }).join("");
    const cs = (st.countries || []); const cmax = Math.max(1, ...cs.map(c => c.n)); const ctot = cs.reduce((s, c) => s + c.n, 0);
    box.innerHTML = `<div class="sec-head"><div><h2>Statistiques</h2><p>Chiffres publics et anonymes, mis à jour à chaque écoute de plus de 30 secondes</p></div></div>
      <div class="stats-grid">
        <div class="kpi"><span>7 derniers jours</span><strong>${nf.format(st.week || 0)}</strong><em>écoutes</em></div>
        <div class="kpi"><span>30 derniers jours</span><strong>${nf.format(st.month || 0)}</strong><em>écoutes</em></div>
        <div class="chart-card"><h3>Écoutes par jour · 30 derniers jours</h3>
          <svg class="chart" viewBox="0 0 ${W} ${H + 22}" preserveAspectRatio="none" role="img" aria-label="Écoutes par jour sur 30 jours, maximum ${max}">
            <line class="base" x1="0" y1="${H}" x2="${W}" y2="${H}"></line>${bars}
          </svg>
          <div class="chart-x"><span>${df.format(days[0].d)}</span><span>${df.format(days[14].d)}</span><span>Aujourd'hui</span></div>
          <p class="chart-note">Plus haute journée : ${plural(max === 1 && !days.some(d => d.n) ? 0 : max, "écoute")}</p></div>
        <div class="chart-card"><h3>Pays des auditeurs</h3>
          ${cs.length ? `<ol class="countries">${cs.map(c => `<li><span class="cn">${flag(c.country)} ${c.country === "??" ? "Inconnu" : esc(regionName(c.country))}</span><span class="cbar"><i style="width:${(c.n / cmax * 100).toFixed(1)}%"></i></span><span class="cv">${Math.round(c.n / ctot * 100)} %</span></li>`).join("")}</ol>` : `<p class="chart-note">Les pays apparaîtront après les premières écoutes.</p>`}
          <p class="chart-note">Pays estimé d'après le fuseau horaire de l'appareil.</p></div>
      </div>`;
  }

  // ---------- playlists ----------
  async function openList(id) {
    S.view = "playlist"; S.param = id; S.list = null; render(); $("main").scrollTop = 0; closeNP();
    if (!sb) return;
    const r = await sb.rpc("get_playlist", { p_id: id });
    if (S.param !== id) return;
    S.list = r.data ? r.data : { missing: true };
    const mine = myLists.find(x => x.id === id); if (mine && r.data && mine.name !== r.data.name) { mine.name = r.data.name; store.set("playlists", myLists); }
    render();
  }
  async function newList(initial = []) {
    if (!sb || !S.hasV2) { toast("Les playlists arrivent bientôt."); return; }
    const name = prompt("Nom de la nouvelle playlist", "Ma playlist");
    if (!name || !name.trim()) return;
    const key = uuid();
    const r = await sb.rpc("save_playlist", { p_id: null, p_key: key, p_name: name.trim().slice(0, 80), p_tracks: initial });
    if (r.error) { toast("Impossible de créer la playlist. Réessaie."); return; }
    myLists.unshift({ id: r.data, key, name: name.trim().slice(0, 80) }); store.set("playlists", myLists);
    toast(initial.length ? "Playlist créée avec ce titre" : "Playlist créée");
    if (S.view === "bibliotheque") render();
  }
  async function editList(id, fn, newName, okMsg) {
    const mine = myLists.find(x => x.id === id && x.key); if (!mine) return;
    const cur = (S.list && S.list.id === id) ? S.list : (await sb.rpc("get_playlist", { p_id: id })).data;
    if (!cur) { toast("Cette playlist n'existe plus."); return; }
    const tracks = fn(cur.tracks.slice()), name = newName || cur.name;
    const r = await sb.rpc("save_playlist", { p_id: id, p_key: mine.key, p_name: name, p_tracks: tracks });
    if (r.error) { toast("Modification impossible. Réessaie."); return; }
    mine.name = name; store.set("playlists", myLists);
    if (S.list && S.list.id === id) { S.list = { ...cur, name, tracks }; render(); }
    if (okMsg) toast(okMsg.replace("%s", name));
  }
  async function deleteList(btn) {
    if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Confirmer la suppression"; return; }
    const mine = myLists.find(x => x.id === S.list.id && x.key);
    if (mine) await sb.rpc("delete_playlist", { p_id: mine.id, p_key: mine.key });
    myLists = myLists.filter(x => x.id !== S.list.id); store.set("playlists", myLists);
    toast("Playlist supprimée"); go("bibliotheque");
  }
  function shareList(pl) {
    const u = new URL(location.href); u.search = "?p=" + pl.id; u.hash = "";
    openShare({ kind: "playlist", title: `la playlist « ${pl.name} »`, text: `🎧 Écoute ma playlist « ${pl.name} » sur DOZE`, url: u.toString(), cover: "icon-192.png" });
  }

  // ---------- effets audio : égaliseur, halo, volume ----------
  const isIOS = /iP(hone|ad|od)/.test(navigator.platform) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
  const BANDS = [[60, "lowshelf", "Basses"], [250, "peaking", "Bas-médiums"], [1000, "peaking", "Médiums"], [4000, "peaking", "Présence"], [12000, "highshelf", "Aigus"]];
  const PRESETS = { plat: ["Plat", [0, 0, 0, 0, 0]], basses: ["Basses+", [6, 3, 0, 0, 1]], voix: ["Voix", [-2, 0, 3, 4, 1]], afro: ["Afro", [4, 2, 0, 2, 3]], rap: ["Rap", [6, 4, -1, 1, 2]], douceur: ["Douceur", [2, 1, 0, -2, -4]], aigus: ["Aigus+", [0, 0, 0, 3, 6]] };
  const GENRE_PRESET = { rap: "rap", afrobeat: "afro", "coupe-decale": "afro", zouglou: "afro", gospel: "voix", "r&b": "voix", pop: "voix", electro: "basses", reggae: "basses", rock: "aigus", jazz: "plat", classique: "plat" };
  const FX = { ctx: null, filters: [], analyser: null, gain: null, bins: null,
    enabled: store.get("fx", !isIOS), preset: store.get("eq", "auto"), custom: store.get("eqCustom", [0, 0, 0, 0, 0]), halo: store.get("halo", true) };
  function fxGraph() {
    if (FX.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      FX.ctx = new AC();
      const src = FX.ctx.createMediaElementSource(audio.el);
      FX.ctx.onstatechange = () => { if (FX.ctx && FX.ctx.state !== "running" && !audio.paused) FX.ctx.resume().catch(() => {}); };
      FX.filters = BANDS.map(([f, type]) => { const b = FX.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 1; b.gain.value = 0; return b; });
      FX.gain = FX.ctx.createGain();
      FX.analyser = FX.ctx.createAnalyser(); FX.analyser.fftSize = 256; FX.analyser.smoothingTimeConstant = .8;
      FX.bins = new Uint8Array(FX.analyser.frequencyBinCount);
      [src, ...FX.filters, FX.gain, FX.analyser, FX.ctx.destination].reduce((a, b) => (a.connect(b), b));
      return true;
    } catch (e) { console.warn(e); FX.ctx = null; return false; }
  }
  function fxResume() {
    if (FX.enabled) fxGraph();
    if (FX.ctx && FX.ctx.state !== "running") FX.ctx.resume().catch(() => {});
    applyEq();
  }
  // Désactiver les effets : on ferme le moteur et on repart sur un lecteur neuf, branché directement aux haut-parleurs.
  function fxTeardown() {
    if (!FX.ctx) return;
    try { FX.ctx.close(); } catch {}
    FX.ctx = null; FX.filters = []; FX.gain = null; FX.analyser = null; FX.bins = null;
    audio.swapElement();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && FX.ctx && FX.ctx.state !== "running") FX.ctx.resume().catch(() => {}); });
  function currentGains(t = current()) {
    let key = FX.preset;
    if (key === "auto") key = (t && GENRE_PRESET[norm(t.genre)]) || "plat";
    return key === "perso" ? FX.custom : PRESETS[key][1];
  }
  function applyEq() { if (!FX.ctx) return; const g = FX.enabled ? currentGains() : [0, 0, 0, 0, 0]; FX.filters.forEach((f, i) => f.gain.setTargetAtTime(g[i], FX.ctx.currentTime, .05)); }
  function applyAutoEq() { applyEq(); }
  function setOutVolume(v) { if (FX.gain) FX.gain.gain.setTargetAtTime(Math.max(0, v), FX.ctx.currentTime, .1); else audio.volume = Math.max(0, Math.min(1, v * (+$("vol").value))); }
  function qualityLabel(t) { return { upload: "Fichier d'origine de l'artiste", soundcloud: "Lecteur officiel SoundCloud", youtube: "Lecteur officiel YouTube" }[t.source] || "Qualité d'origine Suno · AAC"; }

  // Couleur dominante de la pochette pour teinter le lecteur plein écran
  function tintFrom(t) {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 24; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); const sat = mx ? (mx - mn) / mx : 0; const k = .15 + sat * sat; r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k; }
        r /= w; g /= w; b /= w;
        const m = Math.max(r, g, b) || 1, f = Math.min(1.4, 150 / m);              // éclaircit les pochettes sombres, borne les claires
        setTint(Math.round(r * f), Math.round(g * f), Math.round(b * f));
      } catch { setTint(46, 72, 140); }
    };
    img.onerror = () => setTint(46, 72, 140);
    img.src = coverOf(t);
  }
  function setTint(r, g, b) {
    const np = $("np"); np.style.setProperty("--tint", `rgb(${r},${g},${b})`); np.style.setProperty("--tint-rgb", `${r},${g},${b}`);
    // Ambiance : toute l'appli prend doucement la couleur de la pochette en cours.
    const root = document.documentElement.style; root.setProperty("--amb-rgb", `${r},${g},${b}`); document.body.classList.add("has-amb");
  }

  // Halo vivant : la lumière autour de la pochette suit les basses et le spectre de la musique
  let haloRaf = 0;
  function startHalo() { cancelAnimationFrame(haloRaf); haloRaf = requestAnimationFrame(drawHalo); }
  function drawHalo() {
    const cv = $("halo"), art = $("np-cover");
    if ($("np").hidden) return;
    const box = cv.parentElement.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(box.width * 1.3), H = Math.round(box.height * 1.3);
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const live = FX.halo && FX.analyser && !audio.paused && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let bass = 0;
    if (live) { FX.analyser.getByteFrequencyData(FX.bins); for (let i = 1; i < 8; i++) bass += FX.bins[i]; bass = bass / 7 / 255; }
    const rgb = getComputedStyle($("np")).getPropertyValue("--tint-rgb").trim() || "46,72,140";
    const cx = W / 2, cy = H / 2, base = box.width / 2;
    const glow = x.createRadialGradient(cx, cy, base * .6, cx, cy, base * (1.05 + bass * .25));
    glow.addColorStop(0, `rgba(${rgb},${.55 + bass * .4})`); glow.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = glow; x.fillRect(0, 0, W, H);
    if (live) {
      const n = 72, R = base * 1.02;
      x.lineCap = "round"; x.lineWidth = Math.max(2, base / 60);
      for (let i = 0; i < n; i++) {
        const v = FX.bins[Math.floor(4 + (i < n / 2 ? i : n - i) * 1.4)] / 255;
        const a = (i / n) * Math.PI * 2 - Math.PI / 2, len = base * .02 + v * base * .16;
        x.strokeStyle = `rgba(218,154,104,${.25 + v * .7})`;
        x.beginPath(); x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len)); x.stroke();
      }
      const tt = performance.now() / 1000;
      art.style.transform = `perspective(900px) rotateY(${Math.sin(tt * .7) * 5}deg) rotateX(${Math.cos(tt * .5) * 3}deg) scale(${1 + bass * .03})`;
    } else art.style.transform = "";
    haloRaf = requestAnimationFrame(drawHalo);
  }

  // ---------- panneaux « Sortie audio », « Égaliseur », « Réglages audio » ----------
  let sheetStack = [];
  function openSheet(view, push) {
    if (!push) sheetStack = []; sheetStack.push(view);
    $("sheet-wrap").hidden = false; $("sheet-back").hidden = sheetStack.length < 2;
    renderSheet();
  }
  function closeSheet() { $("sheet-wrap").hidden = true; sheetStack = []; }
  function renderSheet() {
    const view = sheetStack[sheetStack.length - 1], body = $("sheet-body"), t = current();
    if (view === "output") {
      $("sheet-title").textContent = "Sortie audio";
      const conn = navigator.connection && navigator.connection.type;
      const net = conn === "wifi" ? "Wi-Fi" : conn === "cellular" ? "Données mobiles" : "";
      const airplay = typeof audio.webkitShowPlaybackTargetPicker === "function";
      const remote = !airplay && audio.remote && typeof audio.remote.prompt === "function";
      body.innerHTML = `<div class="dev-card"><svg viewBox="0 0 24 24"><path d="M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m0 2v16h10V4zm5 13.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3"/></svg>
          <span><b><span class="eqmini" aria-hidden="true"><i></i><i></i><i></i></span> Cet appareil</b><i>${esc(t ? qualityLabel(t) : "Qualité d'origine")}${net ? " · " + net : ""}</i></span></div>
        ${airplay ? `<button class="sheet-row" type="button" data-out="airplay"><svg viewBox="0 0 24 24"><path d="M6 22h12l-6-6zM21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4v-2H3V5h18v12h-4v2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2"/></svg><span>AirPlay</span></button>` : ""}
        ${remote ? `<button class="sheet-row" type="button" data-out="cast"><svg viewBox="0 0 24 24"><path d="M1 18v3h3a3 3 0 0 0-3-3m0-4v2a5 5 0 0 1 5 5h2a7 7 0 0 0-7-7m0-4v2a9 9 0 0 1 9 9h2A11 11 0 0 0 1 10m20-7H3a2 2 0 0 0-2 2v3h2V5h18v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2"/></svg><span>Diffuser sur un appareil (Chromecast, TV…)</span></button>` : ""}
        <div class="sheet-row info"><svg viewBox="0 0 24 24"><path d="M17.7 7.7 12 2h-1v7.6L6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l4.6-4.6V22h1l5.7-5.7-4.3-4.3zM13 5.8l1.9 1.9L13 9.6zm1.9 10.5L13 18.2v-3.8z"/></svg><span>Bluetooth<small>Connecte ton casque ou ton enceinte dans les réglages Bluetooth du téléphone : DOZE passe dessus automatiquement.</small></span></div>
        <div class="sheet-btns"><button class="btn" type="button" data-sheet="settings">Réglages audio</button><button class="btn" type="button" data-sheet="eq">Égaliseur</button></div>`;
    }
    if (view === "eq") {
      $("sheet-title").textContent = "Égaliseur";
      const g = FX.enabled ? currentGains() : [0, 0, 0, 0, 0];
      const autoName = t ? PRESETS[GENRE_PRESET[norm(t.genre)] || "plat"][0] : "Plat";
      body.innerHTML = `${!FX.enabled ? `<div class="sheet-note">Les effets audio sont désactivés. <button class="link" type="button" data-sheet="settings">Les activer</button></div>` : ""}
        <div class="chips">${[["auto", "Auto · selon le genre"], ...Object.entries(PRESETS).map(([k, v]) => [k, v[0]]), ["perso", "Personnalisé"]].map(([k, n]) => `<button class="chip${FX.preset === k ? " is-on" : ""}" type="button" data-preset="${k}">${n}</button>`).join("")}</div>
        ${FX.preset === "auto" ? `<p class="sheet-note">Innovation DOZE : le réglage s'adapte à chaque chanson. Pour ${t ? `« ${esc(t.title)} »${t.genre ? ` (${esc(t.genre)})` : ""}` : "ce titre"}, il applique <b>${autoName}</b>.</p>` : ""}
        <div class="eq-bands">${BANDS.map(([f, , n], i) => `<label class="band"><span class="db">${g[i] > 0 ? "+" : ""}${g[i]} dB</span><input type="range" min="-12" max="12" step="1" value="${g[i]}" data-band="${i}" aria-label="${n}" ${FX.enabled ? "" : "disabled"}><span class="hz">${f >= 1000 ? f / 1000 + " k" : f} Hz</span><small>${n}</small></label>`).join("")}</div>`;
    }
    if (view === "share") {
      const it = S.shareItem || { title: "DOZE", text: "", url: appUrl() };
      $("sheet-title").textContent = it.kind === "appli" ? "Partager DOZE" : "Partager " + (it.kind === "dédicace" ? "la dédicace" : it.kind === "playlist" ? "la playlist" : "ce titre");
      body.innerHTML = `<div class="share-head">${it.cover ? `<img src="${esc(it.cover)}" alt="">` : ""}<span><b>${esc(it.title)}</b><i>${esc(it.url.replace(/^https?:\/\//, ""))}</i></span></div>
        ${navigator.share ? `<button class="btn btn-gold share-main" type="button" data-native-share><svg viewBox="0 0 24 24"><path d="M18 16a3 3 0 0 0-2 .8L8.9 12.7a3 3 0 0 0 0-1.4L16 7.2A3 3 0 1 0 15 5l.1.7L8 9.8a3 3 0 1 0 0 4.4l7.1 4.2-.1.6a3 3 0 1 0 3-3"/></svg> Partager avec mes applis…</button>` : ""}
        <div class="share-grid">${shareLinks(it).map(([n, href, cls, path]) => `<a class="share-app ${cls}" href="${href}" target="_blank" rel="noopener"><span><svg viewBox="0 0 24 24">${path}</svg></span>${n}</a>`).join("")}
          <button class="share-app copy" type="button" data-copy-link><span><svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H8V7h11z"/></svg></span>Copier</button></div>
        <p class="sheet-note">💡 <b>Plusieurs contacts d'un coup</b> : touche WhatsApp, puis coche plusieurs discussions ou groupes (jusqu'à 5 à la fois) avant d'envoyer. Tu peux aussi le publier dans ton <b>Statut</b> WhatsApp.</p>
        <div class="qr-box"><canvas id="qr" aria-label="QR code du lien"></canvas><span><b>QR code</b>Montre-le à un ami : il le scanne avec l'appareil photo de son téléphone.</span></div>`;
      drawQR($("qr"), it.url);
    }
    if (view === "install") {
      $("sheet-title").textContent = "Installer DOZE";
      const android = /Android/i.test(navigator.userAgent);
      let steps;
      if (isInstalled()) steps = `<p class="sheet-note">DOZE est déjà installé sur cet appareil. Retrouve-le sur ton écran d'accueil.</p>`;
      else if (isInApp()) steps = `<p class="sheet-note">Tu as ouvert DOZE depuis une autre appli (WhatsApp, Instagram, Claude…). Pour l'installer, ouvre ce lien dans <b>${isIOSDev ? "Safari" : "Chrome"}</b> :</p>
          <ol class="steps"><li>Touche <b>Copier le lien</b> ci-dessous.</li><li>Ouvre <b>${isIOSDev ? "Safari" : "Chrome"}</b> et colle le lien dans la barre d'adresse.</li><li>Rouvre ce panneau avec le bouton <b>Installer</b>.</li></ol>
          <button class="btn btn-gold" type="button" data-copy-app>Copier le lien de DOZE</button>`;
      else if (isIOSDev) steps = `<ol class="steps big">
            <li><span class="ico"><svg viewBox="0 0 24 24"><path d="M12 2 7.5 6.5l1.4 1.4L11 5.8V16h2V5.8l2.1 2.1 1.4-1.4zM5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h-2v10H7V10z"/></svg></span><span>Touche le bouton <b>Partager</b> de Safari (en bas de l'écran, ou en haut sur iPad).</span></li>
            <li><span class="ico"><svg viewBox="0 0 24 24"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4z"/></svg></span><span>Fais défiler et choisis <b>Sur l'écran d'accueil</b>.</span></li>
            <li><span class="ico"><svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span><span>Touche <b>Ajouter</b> : l'icône DOZE apparaît sur ton écran d'accueil.</span></li></ol>
          <p class="sheet-note">Apple n'autorise pas les sites à s'installer en un seul bouton : ces 3 gestes sont nécessaires. Une fois installé, DOZE s'ouvre en plein écran et garde tes titres téléchargés.</p>`;
      else if (android) steps = `<ol class="steps big"><li><span class="ico"><svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/></svg></span><span>Dans Chrome, touche le menu <b>⋮</b> en haut à droite.</span></li>
            <li><span class="ico"><svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5zM19 9h-4V3H9v6H5l7 7z"/></svg></span><span>Choisis <b>Installer l'application</b> (ou <b>Ajouter à l'écran d'accueil</b>).</span></li>
            <li><span class="ico"><svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg></span><span>Confirme : DOZE apparaît avec tes applis.</span></li></ol>`;
      else steps = `<p class="sheet-note">Sur ordinateur, avec Chrome ou Edge : clique sur l'icône d'installation (un écran avec une flèche) à droite de la barre d'adresse, puis sur <b>Installer</b>.</p>`;
      body.innerHTML = `<div class="share-head"><img src="icon-192.png" alt=""><span><b>DOZE</b><i>Gratuit · sans pub · fonctionne hors connexion</i></span></div>${steps}`;
    }
    if (view === "lyredit") {
      const d = S.editTrack || current();
      $("sheet-title").textContent = "Paroles et synchro";
      const raw = d && current() && d.id === current().id ? S.lyrRaw : "";
      body.innerHTML = `<div class="ded-track">${d ? imgTag(d) : ""}<span><b>${esc(d ? d.title : "")}</b><i>${esc(d ? d.artist : "")}</i></span></div>
        <p class="sheet-note">Colle les paroles. Pour une synchro parfaite, utilise le format LRC (<code>[01:23.45] ligne</code>) ou, après avoir enregistré, lance la chanson et touche <b>Synchroniser</b> sur la pochette.</p>
        <div class="field"><label for="le-text">Paroles</label><textarea id="le-text" rows="12" maxlength="8000">${esc(raw || "")}</textarea></div>
        <button class="btn btn-gold" type="button" data-save-lyr>Enregistrer pour tout le monde</button>`;
      if (d && (!current() || d.id !== current().id) && sb) sb.from("tracks").select("lyrics").eq("id", d.id).maybeSingle().then(r => { const ta = $("le-text"); if (ta && !ta.value && r.data && r.data.lyrics) ta.value = r.data.lyrics; });
    }
    if (view === "dedic") {
      const d = S.dedTrack || current();
      $("sheet-title").textContent = "Dédicacer ce son";
      body.innerHTML = `<div class="ded-track">${d ? imgTag(d) : ""}<span><b>${esc(d ? d.title : "")}</b><i>${esc(d ? d.artist : "")}</i></span></div>
        <p class="sheet-note">Comme à la radio : envoie cette chanson à quelqu'un avec un petit mot. Il le verra en l'ouvrant, juste avant d'écouter.</p>
        <div class="two"><div class="field"><label for="d-from">De la part de</label><input id="d-from" maxlength="40" value="${esc(store.get("myname", ""))}" placeholder="Ton prénom"></div>
        <div class="field"><label for="d-to">Pour</label><input id="d-to" maxlength="40" placeholder="Son prénom"></div></div>
        <div class="field"><label for="d-msg">Ton message</label><textarea id="d-msg" rows="3" maxlength="160" placeholder="Celle-là, c'est pour toi…"></textarea></div>
        <button class="btn btn-gold" type="button" data-send-dedic>Envoyer la dédicace</button>`;
    }
    if (view === "settings") {
      $("sheet-title").textContent = "Réglages audio";
      body.innerHTML = `<label class="set-row"><span><b>Effets audio</b><small>Égaliseur et halo vivant.${isIOS ? " Sur iPhone, la musique peut s'arrêter quand l'écran se verrouille si cette option est active." : ""}</small></span><input type="checkbox" class="switch" data-set="fx" ${FX.enabled ? "checked" : ""}></label>
        <label class="set-row"><span><b>Halo vivant</b><small>La lumière autour de la pochette suit les basses de la musique.</small></span><input type="checkbox" class="switch" data-set="halo" ${FX.halo ? "checked" : ""} ${FX.enabled ? "" : "disabled"}></label>
        <label class="set-row"><span><b>Radio DOZE automatique</b><small>À la fin de ta liste, DOZE enchaîne des titres proches (même artiste, même genre, pépites) au lieu de s'arrêter.</small></span><input type="checkbox" class="switch" data-set="radio" ${radioOn ? "checked" : ""}></label>
        <label class="set-row"><span><b>Formes d'onde</b><small>Affiche l'onde réelle du morceau dans le lecteur. Calculée une seule fois par titre, puis partagée avec tous.</small></span><input type="checkbox" class="switch" data-set="wave" ${waveOn ? "checked" : ""}></label>
        <div class="set-row col"><span><b>Vitesse de lecture</b><small>Pour apprendre les paroles ou chanter dessus.</small></span>
          <div class="chips">${[.75, .9, 1, 1.1, 1.25].map(r => `<button class="chip${audio.playbackRate === r ? " is-on" : ""}" type="button" data-rate="${r}">${String(r).replace(".", ",")}×</button>`).join("")}</div></div>
        <div class="set-row"><span><b>Minuteur de sommeil</b><small>${S.sleepAt ? "Arrêt prévu dans " + Math.max(1, Math.ceil((S.sleepAt - Date.now()) / 60000)) + " min, avec un fondu doux." : S.sleepEnd ? "Arrêt à la fin de ce titre." : "Le son baisse doucement avant de s'arrêter."}</small></span><button class="btn" type="button" data-sleepmenu>Régler</button></div>`;
    }
  }
  $("sheet-wrap").addEventListener("click", e => {
    if (e.target.closest("[data-close-sheet]")) { closeSheet(); return; }
    const sh = e.target.closest("[data-sheet]"); if (sh) { openSheet(sh.dataset.sheet, true); return; }
    const out = e.target.closest("[data-out]");
    if (out) { if (out.dataset.out === "airplay") audio.webkitShowPlaybackTargetPicker(); else audio.remote.prompt().catch(err => toast(err.name === "NotFoundError" ? "Aucun appareil trouvé sur ce réseau." : "Diffusion impossible depuis ce navigateur.")); return; }
    const pr = e.target.closest("[data-preset]"); if (pr) { FX.preset = pr.dataset.preset; store.set("eq", FX.preset); applyEq(); renderSheet(); return; }
    const rt = e.target.closest("[data-rate]"); if (rt) { audio.playbackRate = +rt.dataset.rate; S.rate = audio.playbackRate; renderSheet(); return; }
    if (e.target.closest("[data-sleepmenu]")) { $("b-sleep").click(); return; }
    if (e.target.closest("[data-send-dedic]")) { sendDedic(); return; }
    if (e.target.closest("[data-native-share]")) { const it = S.shareItem; navigator.share({ title: "DOZE", text: it.text, url: it.url }).catch(() => {}); return; }
    if (e.target.closest("[data-copy-link]")) { const it = S.shareItem; navigator.clipboard.writeText(it.text + "\n" + it.url).then(() => toast("Lien copié : colle-le où tu veux"), () => toast(it.url)); return; }
    if (e.target.closest("[data-copy-app]")) { navigator.clipboard.writeText(appUrl()).then(() => toast("Lien copié : colle-le dans " + (isIOSDev ? "Safari" : "Chrome")), () => toast(appUrl())); return; }
    if (e.target.closest("[data-save-lyr]")) {
      const d = S.editTrack || current(); if (!d) return;
      const txt = $("le-text").value.trim();
      sb.rpc("update_track_lyrics", { p_id: d.id, p_key: editKey(d), p_lyrics: txt }).then(r => {
        if (r.data !== true) { toast("Enregistrement impossible : seul l'appareil qui a publié ce titre peut le modifier."); return; }
        delete mySync[d.id]; store.set("lyrSync", mySync);
        if (offline[d.id]) { offline[d.id].lyrics = txt; store.set("offline", offline); }
        closeSheet(); toast("Paroles enregistrées"); if (current() && current().id === d.id) loadLyr(d);
      });
      return;
    }
  });
  $("sheet-wrap").addEventListener("input", e => {
    const b = e.target.closest("[data-band]");
    if (b) { if (FX.preset !== "perso") { FX.custom = currentGains().slice(); FX.preset = "perso"; store.set("eq", "perso"); document.querySelectorAll("[data-preset]").forEach(c => c.classList.toggle("is-on", c.dataset.preset === "perso")); }
      FX.custom[+b.dataset.band] = +b.value; store.set("eqCustom", FX.custom); applyEq(); b.parentElement.querySelector(".db").textContent = (b.value > 0 ? "+" : "") + b.value + " dB"; }
  });
  $("sheet-wrap").addEventListener("change", e => {
    const s2 = e.target.closest("[data-set]"); if (!s2) return;
    if (s2.dataset.set === "fx") { FX.enabled = s2.checked; store.set("fx", FX.enabled); if (FX.enabled) { fxGraph(); fxResume(); } else fxTeardown(); }
    if (s2.dataset.set === "halo") { FX.halo = s2.checked; store.set("halo", FX.halo); }
    if (s2.dataset.set === "radio") { radioOn = s2.checked; store.set("radio", radioOn); renderQueue(); }
    if (s2.dataset.set === "wave") { waveOn = s2.checked; store.set("wave", waveOn); const c = current(); if (c) loadWave(c); }
    renderSheet();
  });
  audio.addEventListener("loadedmetadata", () => { if (S.rate) audio.playbackRate = S.rate; });
  $("np-output").onclick = () => openSheet("output");
  $("np-eq").onclick = () => openSheet("eq");
  $("b-output").onclick = () => openSheet("output");
  $("np-more").onclick = e => { const t = current(); if (t) openMenu(e.currentTarget, t); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("sheet-wrap").hidden) { e.stopPropagation(); closeSheet(); } }, true);

  // ---------- écoute hors ligne ----------
  const OFF_CACHE = "ecrin-offline-v1";
  const canOffline = t => !!t && (t.source === "suno" || t.source === "upload");
  const fmtSize = b => b >= 1e9 ? (b / 1e9).toFixed(1).replace(".", ",") + " Go" : Math.max(1, Math.round(b / 1e6)) + " Mo";
  S.dl = {};
  async function downloadTrack(t, quiet) {
    if (!("caches" in window) || !("serviceWorker" in navigator)) { toast("Ce navigateur ne permet pas l'écoute hors ligne. Ouvre DOZE dans Safari ou Chrome."); return; }
    if (!canOffline(t)) { toast("Les titres SoundCloud et YouTube ne peuvent pas être téléchargés."); return; }
    if (offline[t.id] || S.dl[t.id] != null) return;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
    S.dl[t.id] = 0; syncDl();
    try {
      const url = playable(t.audio_url);
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const total = +res.headers.get("content-length") || 0, reader = res.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (total) { S.dl[t.id] = got / total; syncDl(); } }
      const blob = new Blob(parts, { type: res.headers.get("content-type") || "audio/mp4" });
      const cache = await caches.open(OFF_CACHE);
      await cache.put(url, new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(blob.size) } }));
      if (t.cover_url) { try { const c = await fetch(t.cover_url, { mode: "cors" }); if (c.ok) await cache.put(t.cover_url, c); } catch {} }
      let lyrics = null;
      if (sb && S.hasV2) { try { const r = await sb.from("tracks").select("lyrics").eq("id", t.id).maybeSingle(); lyrics = r.data && r.data.lyrics; } catch {} }
      const { lyrics: _drop, ...meta } = t;
      offline[t.id] = { t: meta, lyrics, size: blob.size, at: Date.now() }; store.set("offline", offline);
      delete S.dl[t.id]; syncDl();
      if (!quiet) toast("« " + t.title + " » est disponible hors ligne");
      if (S.view === "bibliotheque") render(); else refreshMarks();
    } catch (err) {
      console.warn(err); delete S.dl[t.id]; syncDl();
      toast("Téléchargement impossible pour « " + t.title + " ». Vérifie ta connexion.");
    }
  }
  async function removeOffline(id) {
    const o = offline[id]; if (!o) return;
    try { const c = await caches.open(OFF_CACHE); await c.delete(playable(o.t.audio_url)); if (o.t.cover_url) await c.delete(o.t.cover_url); } catch {}
    delete offline[id]; store.set("offline", offline); syncDl();
    toast("Retiré des téléchargements"); if (S.view === "bibliotheque") render(); else refreshMarks();
  }
  function refreshMarks() { if (S.view !== "publier") { const y = $("main").scrollTop; render(); $("main").scrollTop = y; } }
  function syncDl() {
    const t = current(), b = $("np-dl"); if (!b) return;
    b.hidden = !canOffline(t);
    if (!t) return;
    const p = S.dl[t.id];
    b.classList.toggle("is-on", !!offline[t.id]);
    b.querySelector("span").textContent = p != null ? Math.round(p * 100) + " %" : "";
    b.setAttribute("aria-label", offline[t.id] ? "Retirer des téléchargements" : "Télécharger pour écouter hors ligne");
  }
  $("np-dl").onclick = () => { const t = current(); if (!t) return; if (offline[t.id]) removeOffline(t.id); else downloadTrack(t); };
  addEventListener("online", () => { if (S.offlineMode) { toast("Connexion retrouvée"); load(); } });
  addEventListener("offline", () => toast("Hors connexion : tes titres téléchargés restent écoutables"));

  // ---------- partage : feuille du téléphone, applis, QR code ----------
  const isIOSDev = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && "ontouchend" in document);
  function openShare(item) { S.shareItem = item; openSheet("share"); }
  function shareLinks(it) {
    const t = encodeURIComponent(it.text), u = encodeURIComponent(it.url), tu = encodeURIComponent(it.text + "\n" + it.url);
    return [
      ["WhatsApp", `https://wa.me/?text=${tu}`, "wa", '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2m5.4 14.1c-.2.6-1.3 1.2-1.8 1.3-.5 0-1 .2-3.3-.7-2.8-1.1-4.5-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.2.5.1.6 0l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.1.1.7-.1 1.3"/>'],
      ["Telegram", `https://t.me/share/url?url=${u}&text=${t}`, "tg", '<path d="M21.9 4.4 18.8 19c-.2 1-.8 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8 8.8-7.9c.4-.3-.1-.5-.6-.2L6.8 13l-4.7-1.5c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.4"/>'],
      ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`, "fb", '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12"/>'],
      ["SMS", `sms:${isIOSDev ? "&" : "?"}body=${tu}`, "sms", '<path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2M8 11H6V9h2zm5 0h-2V9h2zm5 0h-2V9h2z"/>'],
      ["E-mail", `mailto:?subject=${encodeURIComponent("DOZE : " + it.title)}&body=${tu}`, "mail", '<path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 4-8 5-8-5V6l8 5 8-5z"/>'],
      ["X", `https://twitter.com/intent/tweet?text=${t}&url=${u}`, "x", '<path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/>'],
    ];
  }
  let qrLoaded = null;
  function drawQR(canvas, text) {
    const go = () => {
      try {
        const q = qrcode(0, "M"); q.addData(text); q.make();
        const n = q.getModuleCount(), cell = Math.floor(220 / (n + 8)), size = cell * (n + 8), x = canvas.getContext("2d");
        canvas.width = canvas.height = size; x.fillStyle = "#fff"; x.fillRect(0, 0, size, size); x.fillStyle = "#070B1C";
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) x.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
      } catch { canvas.hidden = true; }
    };
    if (window.qrcode) return go();
    qrLoaded = qrLoaded || loadScript("vendor/qrcode.js");
    qrLoaded.then(go, () => { canvas.hidden = true; });
  }

  // ---------- installation de l'appli ----------
  let installEvt = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; syncInstall(); });
  addEventListener("appinstalled", () => { installEvt = null; toast("DOZE est installé sur ton appareil 🎉"); syncInstall(); });
  const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isInApp = () => /FBAN|FBAV|Instagram|WhatsApp|Snapchat|Line\/|TikTok|; wv\)/i.test(navigator.userAgent) || (isIOSDev && !/Safari\//.test(navigator.userAgent) && !isInstalled());
  function syncInstall() { document.querySelectorAll("[data-install]").forEach(b => b.hidden = isInstalled()); }
  async function installApp() {
    if (isInstalled()) { toast("DOZE est déjà installé sur cet appareil"); return; }
    if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); if (r && r.outcome === "accepted") installEvt = null; return; }
    openSheet("install");
  }

  // ---------- dédicaces (tout tient dans le lien : rien n'est stocké) ----------
  const b64 = { enc: o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    dec: s => { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); } catch { return null; } } };
  function sendDedic() {
    const d = S.dedTrack || current(); if (!d) return;
    const f = $("d-from").value.trim().slice(0, 40), to = $("d-to").value.trim().slice(0, 40), m = $("d-msg").value.trim().slice(0, 160);
    if (!f || !to) { toast("Indique ton prénom et celui de la personne."); return; }
    store.set("myname", f);
    const u = new URL(location.href); u.search = "?t=" + d.id + "&d=" + b64.enc({ f, to, m }); u.hash = "";
    const url = u.toString(), text = `🎁 ${f} te dédicace « ${d.title} » de ${d.artist} sur DOZE`;
    openShare({ kind: "dédicace", title: `ta dédicace pour ${to}`, text, url, cover: coverOf(d) });
  }
  function showDedic(d) {
    const c = $("np-dedic"); if (!d || !d.f) { c.hidden = true; return; }
    c.innerHTML = `<span class="ded-ic">🎁</span><span><b>Dédicace de ${esc(d.f)} pour ${esc(d.to || "toi")}</b>${d.m ? `<q>${esc(d.m)}</q>` : ""}</span><button class="ic" type="button" aria-label="Masquer la dédicace" onclick="this.parentElement.hidden=true"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>`;
    c.hidden = false;
  }

  // ---------- effets 3D ----------
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Pochettes qui s'inclinent sous le doigt ou la souris, avec un reflet qui glisse.
  const TILT = ".card .art, .hero > img, .page-head .ph-art, .np-art img";
  function tiltMove(e) {
    if (e.pointerType !== "mouse") return;            // au doigt, pas d'inclinaison : seulement à la souris
    const el = e.target.closest && e.target.closest(TILT); if (!el || calm) return;
    const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--rx", ((.5 - y) * 16).toFixed(2) + "deg"); el.style.setProperty("--ry", ((x - .5) * 18).toFixed(2) + "deg");
    el.style.setProperty("--gx", (x * 100).toFixed(1) + "%"); el.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
    el.classList.add("tilting");
  }
  function tiltEnd(e) { const el = e.target.closest && e.target.closest(TILT); if (el) { el.classList.remove("tilting"); el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); } }
  document.addEventListener("pointermove", tiltMove, { passive: true });
  document.addEventListener("pointerout", tiltEnd, { passive: true });
  document.addEventListener("pointerup", tiltEnd, { passive: true });

  // Fond vivant : des ondes cuivrées en perspective, comme sur le logo.
  (function waves() {
    const cv = $("bg3d"); if (!cv) return;
    const x = cv.getContext("2d"); let W = 0, H = 0, raf = 0, last = 0;
    const size = () => { const d = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * d; cv.height = H * d; x.setTransform(d, 0, 0, d, 0, 0); };
    size(); addEventListener("resize", size);
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !$("np").hidden) return;
      if (ts - last < 33) return; last = ts;                       // ~30 images/s, léger pour la batterie
      const t = calm ? 0 : ts / 1000;
      x.clearRect(0, 0, W, H);
      const lines = 14, base = H * .30, amp = Math.min(70, H * .08);
      for (let k = 0; k < lines; k++) {
        const depth = k / (lines - 1), y0 = base + depth * H * .34, a = amp * (0.4 + depth * .9);
        const g = x.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, "rgba(218,154,104,0)"); g.addColorStop(.25, `rgba(218,154,104,${.05 + depth * .16})`);
        g.addColorStop(.75, `rgba(240,190,146,${.05 + depth * .16})`); g.addColorStop(1, "rgba(218,154,104,0)");
        x.strokeStyle = g; x.lineWidth = .6 + depth * 1.4; x.beginPath();
        for (let px = 0; px <= W; px += 8) {
          const u = px / W;
          const y = y0 + Math.sin(u * 9 + t * (.6 + depth * .5) + k * .45) * a * Math.sin(u * Math.PI) + Math.cos(u * 4 - t * .4 + k) * a * .25;
          px ? x.lineTo(px, y) : x.moveTo(px, y);
        }
        x.stroke();
      }
    }
    raf = requestAnimationFrame(frame);
  })();

  // Ouverture : le logo DOZE apparaît en relief (une fois par visite).
  (function intro() {
    const el = $("intro"); if (!el) return;
    let seen = false; try { seen = sessionStorage.getItem("doze.intro") === "1"; sessionStorage.setItem("doze.intro", "1"); } catch {}
    if (seen || calm) { el.remove(); return; }
    el.hidden = false;
    const close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 700); };
    el.addEventListener("click", close); setTimeout(close, 2300);
  })();

  // ---------- formes d'onde ----------
  let waveOn = store.get("wave", true);
  const waveCache = store.get("peaks", {});            // { idTitre: [0..100] } gardé sur l'appareil
  S.wave = null;
  async function computePeaks(url, n = 160) {
    const c = navigator.connection; if (c && (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || ""))) return null;   // économise les données mobiles lentes
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC) return null;
    let res = null; try { res = await (await caches.open(OFF_CACHE)).match(url); } catch {}
    if (!res) res = await fetch(url, { mode: "cors" });
    if (!res || !res.ok) return null;
    const buf = await res.arrayBuffer(); if (buf.byteLength > 18e6) return null;
    const ctx = new OAC(1, 8000, 8000);                 // décodage à 8 kHz : léger en mémoire
    const ab = await new Promise((ok, ko) => { const p = ctx.decodeAudioData(buf, ok, ko); if (p && p.catch) p.catch(ko); });
    const d = ab.getChannelData(0), step = Math.max(1, Math.floor(d.length / n)), out = [];
    for (let i = 0; i < n; i++) { let sum = 0; for (let j = i * step, e = Math.min(d.length, j + step); j < e; j++) sum += d[j] * d[j]; out.push(Math.sqrt(sum / step)); }
    const mx = Math.max(...out) || 1;
    return out.map(v => Math.round(Math.pow(v / mx, .8) * 100));
  }
  async function loadWave(t) {
    S.wave = null; drawWave();
    if (!waveOn || !t || audio.isExternal || !t.audio_url) return;
    let p = waveCache[t.id];
    if (!p && sb && S.hasV2) { try { const r = await sb.from("tracks").select("peaks").eq("id", t.id).maybeSingle(); p = r.data && r.data.peaks; } catch {} }
    if (!p) {
      try { p = await computePeaks(playable(t.audio_url)); } catch (e) { console.warn("onde", e); p = null; }
      if (p && sb) sb.rpc("set_track_peaks", { p_id: t.id, p_peaks: p }).then(() => {}, () => {});
    }
    if (!p || !current() || current().id !== t.id) return;
    waveCache[t.id] = p; const keys = Object.keys(waveCache); if (keys.length > 120) delete waveCache[keys[0]]; store.set("peaks", waveCache);
    S.wave = p; drawWave();
  }
  function drawWave() {
    const cv = $("np-wave"), wrap = cv && cv.parentElement; if (!cv) return;
    wrap.classList.toggle("has-wave", !!S.wave);
    if (!S.wave || $("np").hidden) return;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const n = S.wave.length, bw = w / n, prog = isFinite(audio.duration) && audio.duration ? audio.currentTime / audio.duration : 0;
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#F0BE92"); g.addColorStop(1, "#B06C3E");
    for (let i = 0; i < n; i++) {
      const v = Math.max(4, S.wave[i] / 100 * h), y = (h - v) / 2;
      x.fillStyle = i / n < prog ? g : "rgba(244,238,230,.22)";
      x.fillRect(i * bw + bw * .18, y, Math.max(1, bw * .64), v);
    }
  }
  audio.addEventListener("timeupdate", () => { if (S.wave && !$("np").hidden) drawWave(); });
  addEventListener("resize", drawWave);

  // ---------- 1. Gestes ----------
  (function gestures() {
    const np = $("np"), art = document.querySelector(".np-art");
    let sx = 0, sy = 0, mode = null, t0 = 0;
    np.addEventListener("touchstart", e => {
      if (e.touches.length !== 1 || e.target.closest(".lyr-lines, .lyr-tools, .lyr-tapbar, input, .np-queue, .sheet-wrap, .wave-wrap")) { mode = "none"; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; mode = null; t0 = Date.now();
    }, { passive: true });
    np.addEventListener("touchmove", e => {
      if (mode === "none") return;
      const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
      if (!mode) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) > Math.abs(dy) && e.target.closest(".np-art") && !audio.isExternal) mode = "h";
        else if (dy > 0 && np.scrollTop <= 0 && Math.abs(dy) > Math.abs(dx)) mode = "v";
        else { mode = "none"; return; }
      }
      e.preventDefault();
      if (mode === "h") { art.style.transition = "none"; art.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`; art.style.opacity = String(1 - Math.min(.5, Math.abs(dx) / 600)); }
      if (mode === "v") { np.style.transition = "none"; np.style.transform = `translateY(${Math.max(0, dy)}px)`; np.style.borderRadius = Math.min(28, dy / 6) + "px"; }
    }, { passive: false });
    np.addEventListener("touchend", e => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy, fast = Date.now() - t0 < 250;
      if (mode === "h") {
        art.style.transition = "transform .3s cubic-bezier(.2,.8,.2,1), opacity .3s";
        if (Math.abs(dx) > 90 || (fast && Math.abs(dx) > 40)) {
          art.style.transform = `translateX(${dx > 0 ? 120 : -120}%) rotate(${dx > 0 ? 8 : -8}deg)`; art.style.opacity = "0";
          setTimeout(() => { dx > 0 ? prev() : next(false); art.style.transition = "none"; art.style.transform = `translateX(${dx > 0 ? -60 : 60}%)`; art.style.opacity = "0";
            requestAnimationFrame(() => { art.style.transition = "transform .35s cubic-bezier(.2,.8,.2,1), opacity .35s"; art.style.transform = ""; art.style.opacity = ""; }); }, 220);
        } else { art.style.transform = ""; art.style.opacity = ""; }
      }
      if (mode === "v") {
        np.style.transition = "transform .3s cubic-bezier(.2,.8,.2,1), border-radius .3s";
        if (dy > 140 || (fast && dy > 60)) { np.style.transform = "translateY(100%)"; setTimeout(() => { closeNP(); np.style.transition = "none"; np.style.transform = ""; np.style.borderRadius = ""; }, 280); }
        else { np.style.transform = ""; np.style.borderRadius = ""; }
      }
      mode = null;
    });
    // Mini-lecteur : glisser vers le haut pour ouvrir, à gauche ou à droite pour changer de titre
    const mini = $("player"); let mx = 0, my = 0, mt = 0;
    mini.addEventListener("touchstart", e => { mx = e.touches[0].clientX; my = e.touches[0].clientY; mt = Date.now(); }, { passive: true });
    mini.addEventListener("touchend", e => {
      const dx = e.changedTouches[0].clientX - mx, dy = e.changedTouches[0].clientY - my;
      if (Date.now() - mt > 600) return;
      if (dy < -40 && Math.abs(dy) > Math.abs(dx)) { openNP(); return; }
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && current()) { dx < 0 ? next(false) : prev(); }
    }, { passive: true });
  })();

  // ---------- file de lecture ----------
  function buildOrder(startIdx) {
    const n = S.queue.length;
    let order = [...Array(n).keys()];
    if (S.shuffle) { order.splice(order.indexOf(startIdx), 1); order = shuffled(order); order.unshift(startIdx); S.pos = 0; }
    else S.pos = startIdx;
    S.order = order;
  }
  const CTX_LABEL = { off: ["Bibliothèque", "Téléchargés"], hero: ["Accueil", "À la une"], recent: ["Accueil", "Écoutés récemment"], new: ["Accueil", "Nouveautés"], gems: ["Accueil", "Pépites à découvrir"], top: ["Accueil", "Les plus écoutées"], week: ["Accueil", "Coups de cœur de la semaine"], search: ["Recherche", "Résultats"], favs: ["Playlist", "Coups de cœur"], hist: ["Bibliothèque", "Historique"] };
  function ctxLabel(key) {
    if (key === "artist") return ["Artiste", S.param || ""];
    if (key === "genre") return ["Genre", S.param || ""];
    if (key === "pl") return ["Playlist", (S.list && S.list.name) || ""];
    return CTX_LABEL[key] || ["Lecture en cours", "DOZE"];
  }
  function startQueue(list, idx, autoplay = true, label) {
    if (!list || !list.length) return;
    S.label = label || ["Lecture en cours", "DOZE"];
    $("np-ctx-type").textContent = S.label[0]; $("np-ctx-name").textContent = S.label[1];
    S.queue = list.slice(); buildOrder(idx); playCurrent(autoplay);
  }
  function playNext(t) {
    if (!S.queue.length) { startQueue([t], 0); return; }
    S.queue.push(t); S.order.splice(S.pos + 1, 0, S.queue.length - 1);
    toast("« " + t.title + " » passera juste après"); renderQueue();
  }
  function playCurrent(autoplay = true) {
    const t = current(); if (!t) return;
    S.counted = false;
    audio.src = playable(t.audio_url);
    if (autoplay) { fxResume(); audio.play().catch(() => {}); }
    $("p-title").textContent = t.title; $("p-artist").textContent = t.artist;
    const img = $("p-cover"); img.src = coverOf(t); img.dataset.fb = t.id; delete img.dataset.failed; img.hidden = false;
    $("np-cover").src = coverOf(t); $("np-cover").dataset.fb = t.id; delete $("np-cover").dataset.failed;
    tintFrom(t); $("np-quality").textContent = qualityLabel(t); applyAutoEq(t);
    document.querySelector(".np-art").classList.toggle("is-ext", audio.isExternal);
    if (audio.isExternal && autoplay) { openNP(); toast(t.source === "youtube" ? "Lecture avec le lecteur YouTube. Touche ▶ sur la vidéo si elle ne démarre pas." : "Lecture avec le lecteur SoundCloud. Touche ▶ s'il ne démarre pas."); }
    loadLyr(t); syncDl(); loadWave(t);
    $("np-title").textContent = t.title; $("np-artist").textContent = t.artist;
    renderTags(t); S.lyricsFor = null; if (!$("np").hidden && S.npTab === "lyrics") loadLyrics();
    document.title = t.title + " · " + t.artist + " | DOZE";
    if ("mediaSession" in navigator) {
      // Infos affichées sur l'écran verrouillé, la montre, CarPlay et l'écran de la voiture (Bluetooth).
      const art = coverOf(t), abs = art.startsWith("data:") ? art : new URL(art, location.href).href;
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.genre ? "DOZE · " + t.genre : "DOZE",
        artwork: [96, 192, 256, 512].map(n => ({ src: abs, sizes: n + "x" + n, type: abs.endsWith(".png") ? "image/png" : "image/jpeg" })) });
    }
    history = [t.id, ...history.filter(x => x !== t.id)].slice(0, 50); store.set("history", history);
    syncLike(); refreshCurrent(); renderQueue();
  }
  function next(auto = false) {
    if (!S.queue.length) return;
    if (auto && S.sleepEnd) { S.sleepEnd = false; updateSleepBadge(); audio.pause(); toast("Bonne nuit. Minuteur terminé."); return; }
    if (S.pos < S.order.length - 1) S.pos++;
    else if (S.repeat === "off" && radioOn && radioExtend(current())) S.pos++;     // fin de liste : la Radio DOZE prend le relais
    else if (S.repeat === "all" || !auto) {
      if (S.shuffle) { const last = S.order[S.pos]; buildOrder(Math.floor(Math.random() * S.queue.length)); if (S.queue.length > 1 && S.order[0] === last) S.pos = 1; }
      else S.pos = 0;
    } else { audio.pause(); audio.currentTime = 0; return; }
    playCurrent();
  }
  // ---------- Radio DOZE : quand la liste se termine, la musique continue ----------
  let radioOn = store.get("radio", true);
  function radioPick(seed, n = 10) {
    if (!seed) return [];
    const recent = new Set([...history.slice(0, 15), ...S.queue.map(t => t.id), seed.id]);
    const pool = S.all.filter(t => !recent.has(t.id) && t.audio_url);
    const score = t => (norm(t.artist) === norm(seed.artist) ? 3 : 0) + (seed.genre && norm(t.genre) === norm(seed.genre) ? 2.5 : 0) + (favs.has(t.id) ? 1 : 0) + (t.plays < 10 ? .8 : 0) + Math.random() * 2;
    let out = pool.map(t => [score(t), t]).sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1]);
    if (!out.length) out = shuffled(S.all.filter(t => t.id !== seed.id)).slice(0, n);   // tout a été écouté : on repart du catalogue
    return out;
  }
  function radioExtend(seed) {
    const add = radioPick(seed); if (!add.length) return false;
    for (const t of add) { S.queue.push(t); S.order.push(S.queue.length - 1); }
    S.label = ["Radio DOZE", "d'après « " + seed.title + " »"]; $("np-ctx-type").textContent = S.label[0]; $("np-ctx-name").textContent = S.label[1];
    toast("📻 Radio DOZE : la musique continue avec des titres proches");
    return true;
  }
  function startRadio(t) { startQueue([t, ...radioPick(t, 15)], 0, true, ["Radio DOZE", "d'après « " + t.title + " »"]); }

  function prev() {
    if (!S.queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    S.pos = S.pos > 0 ? S.pos - 1 : S.order.length - 1; playCurrent();
  }
  function togglePlay() {
    if (!audio.src) { const l = S.ctx.hero || S.all; if (l && l.length) startQueue(l, 0); return; }
    if (audio.paused) { fxResume(); audio.play().catch(() => {}); } else audio.pause();
  }
  function renderQueue() {
    const ol = $("np-queue");
    const upcoming = S.order.slice(S.pos + 1, S.pos + 31).map(i => ({ t: S.queue[i], k: i }));
    ol.innerHTML = upcoming.length ? upcoming.map(({ t }, j) => `<li data-q="${S.pos + 1 + j}">${imgTag(t)}<span><b>${esc(t.title)}</b><i>${esc(t.artist)}</i></span></li>`).join("")
      : `<li class="q-empty">${S.repeat === "all" ? "La liste reprendra au début." : radioOn ? "📻 La Radio DOZE prendra le relais avec des titres proches." : "Rien après ce titre."}</li>`;
  }
  $("np-queue").addEventListener("click", e => { const li = e.target.closest("[data-q]"); if (li) { S.pos = +li.dataset.q; playCurrent(); } });

  // ---------- modes ----------
  function setShuffle(on) { S.shuffle = on; store.set("shuffle", on); if (S.queue.length) buildOrder(S.order[S.pos]); syncModes(); renderQueue(); }
  function syncModes() {
    document.querySelectorAll("#b-shuffle, [data-act=shuffle]").forEach(b => b.setAttribute("aria-pressed", S.shuffle));
    document.querySelectorAll("#b-repeat, [data-act=repeat]").forEach(b => { b.setAttribute("aria-pressed", S.repeat !== "off"); b.querySelector(".badge").hidden = S.repeat !== "one"; b.title = { off: "Répéter : non", all: "Répéter : toute la liste", one: "Répéter : ce titre" }[S.repeat]; });
    audio.loop = S.repeat === "one";
  }
  const actions = {
    play: togglePlay, next: () => next(false), prev,
    shuffle: () => { setShuffle(!S.shuffle); toast(S.shuffle ? "Lecture aléatoire activée" : "Lecture dans l'ordre"); },
    repeat: () => { S.repeat = { off: "all", all: "one", one: "off" }[S.repeat]; store.set("repeat", S.repeat); syncModes(); renderQueue(); toast({ off: "Répétition désactivée", all: "Toute la liste en boucle", one: "Ce titre en boucle" }[S.repeat]); }
  };
  $("b-play").onclick = actions.play; $("b-next").onclick = actions.next; $("b-prev").onclick = actions.prev;
  $("b-shuffle").onclick = actions.shuffle; $("b-repeat").onclick = actions.repeat;
  document.querySelectorAll("[data-act]").forEach(b => b.onclick = () => actions[b.dataset.act]());
  $("b-like").onclick = $("np-like").onclick = () => { const t = current(); if (t) toggleFav(t.id); };
  $("vol").oninput = e => { audio.volume = +e.target.value; store.set("vol", audio.volume); };
  $("np-share").onclick = () => { const t = current(); if (t) share(t); };
  $("np-artist").onclick = () => { const t = current(); if (t) go("artiste", t.artist); };

  // ---------- plein écran ----------
  function openNP() { if (!current()) return; $("np").hidden = false; renderQueue(); startHalo(); requestAnimationFrame(placeExt); renderLyr(true); requestAnimationFrame(drawWave); }
  function closeNP() { $("np").hidden = true; closeSheet(); placeExt(); }
  $("np").addEventListener("scroll", placeExt, { passive: true });
  $("p-open").onclick = openNP; $("b-queue").onclick = openNP; $("np-close").onclick = closeNP;
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeNP(); closeMenu(); }
    if (e.target.matches("input, textarea")) return;
    if (e.code === "Space" && !e.target.closest("button, [data-ctx], a")) { e.preventDefault(); togglePlay(); }
  });

  // ---------- minuteur de sommeil ----------
  function setSleep(v) {
    S.sleepEnd = false; S.sleepAt = 0;
    if (v === "end") S.sleepEnd = true;
    else if (v !== "off") S.sleepAt = Date.now() + (+v) * 60000;
    updateSleepBadge();
    toast(v === "off" ? "Minuteur désactivé" : v === "end" ? "Arrêt à la fin de ce titre" : `Arrêt dans ${v} minutes`);
  }
  function updateSleepBadge() {
    const b = $("sleep-badge");
    if (S.sleepEnd) { b.hidden = false; b.textContent = "fin"; }
    else if (S.sleepAt) { b.hidden = false; b.textContent = Math.max(1, Math.ceil((S.sleepAt - Date.now()) / 60000)) + "'"; }
    else b.hidden = true;
    $("b-sleep").setAttribute("aria-pressed", !b.hidden);
  }
  $("b-sleep").onclick = e => openMenu(e.currentTarget, null, `<button type="button" data-a="sleep-15">Dans 15 minutes</button><button type="button" data-a="sleep-30">Dans 30 minutes</button><button type="button" data-a="sleep-60">Dans 1 heure</button><button type="button" data-a="sleep-end">À la fin du titre</button><div class="sep"></div><button type="button" data-a="sleep-off">Désactiver</button>`);
  setInterval(() => {
    if (!S.sleepAt) { if (S.fading) { S.fading = false; setOutVolume(1); } return; }
    const left = S.sleepAt - Date.now();
    if (left <= 30000 && left > 0) { S.fading = true; setOutVolume(left / 30000); }    // fondu doux sur les 30 dernières secondes
    if (left <= 0) { S.sleepAt = 0; audio.pause(); S.fading = false; setTimeout(() => setOutVolume(1), 500); toast("Bonne nuit. Minuteur terminé."); }
    updateSleepBadge();
  }, 1000);

  // ---------- progression ----------
  let seeking = false;
  for (const id of ["seek", "np-seek"]) {
    $(id).addEventListener("input", e => { seeking = true; const t = e.target.value / 1000 * audio.duration; $("t-cur").textContent = $("np-cur").textContent = fmt(t); });
    $(id).addEventListener("change", e => { if (isFinite(audio.duration)) audio.currentTime = e.target.value / 1000 * audio.duration; seeking = false; });
  }
  audio.addEventListener("timeupdate", () => {
    if (isFinite(audio.duration)) {
      const r = audio.currentTime / audio.duration;
      $("mini-bar").style.width = (r * 100) + "%";
      if (!seeking) { $("seek").value = $("np-seek").value = Math.round(r * 1000); $("t-cur").textContent = $("np-cur").textContent = fmt(audio.currentTime); }
    }
    if (!S.counted && audio.currentTime > 30) {
      S.counted = true;
      const t = current();
      if (t && sb) sb.rpc("count_play", S.hasV2 ? { track: t.id, p_country: myCountry() } : { track: t.id }).then(() => { t.plays++; });
    }
  });
  audio.addEventListener("loadedmetadata", () => { $("t-dur").textContent = $("np-dur").textContent = fmt(audio.duration); if (S.lyr && !S.lyr.timed) { S.lyr.estimated = false; estimateTimes(S.lyr, audio.duration); S.lyrIdx = -1; } });
  audio.addEventListener("timeupdate", syncLyr);
  function syncPlayIcons() { document.querySelectorAll(".i-play").forEach(i => i.toggleAttribute("hidden", !audio.paused)); document.querySelectorAll(".i-pause").forEach(i => i.toggleAttribute("hidden", audio.paused)); document.querySelectorAll("#b-play, [data-act=play]").forEach(b => b.title = audio.paused ? "Lecture" : "Pause"); refreshCurrent(); }
  audio.addEventListener("play", syncPlayIcons); audio.addEventListener("pause", syncPlayIcons);
  audio.addEventListener("ended", () => { if (audio.isExternal && S.repeat === "one") { audio.currentTime = 0; audio.play(); return; } next(true); });
  audio.addEventListener("error", () => { if (audio.src) { toast("Ce titre n'est pas encore écoutable (son non public chez Suno). Passage au suivant."); setTimeout(() => next(true), 900); } });
  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => audio.play()); ms.setActionHandler("pause", () => audio.pause());
    ms.setActionHandler("nexttrack", () => next(false)); ms.setActionHandler("previoustrack", prev);
    try { ms.setActionHandler("seekto", d => { audio.currentTime = d.seekTime; }); } catch {}
    try { ms.setActionHandler("seekbackward", d => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); }); } catch {}
    try { ms.setActionHandler("seekforward", d => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); }); } catch {}
    try { ms.setActionHandler("stop", () => audio.pause()); } catch {}
    // Barre de progression sur l'écran verrouillé et l'écran de la voiture
    const pos = () => { try { if (isFinite(audio.duration) && audio.duration > 0) ms.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate || 1 }); } catch {} };
    ["loadedmetadata", "play", "pause"].forEach(ev => audio.addEventListener(ev, pos));
    audio.addEventListener("play", () => { ms.playbackState = "playing"; }); audio.addEventListener("pause", () => { ms.playbackState = "paused"; });
    let lastPos = 0; audio.addEventListener("timeupdate", () => { const n = Date.now(); if (n - lastPos > 5000) { lastPos = n; pos(); } });
  }

  // ---------- publication ----------
  let pubMode = "link", pvUrl;
  // Relais Supabase « suno-import » : lit les pages publiques de Suno à la place du navigateur.
  async function relay(type, id, extra = "") {
    if (!cfg.supabaseUrl) return null;
    try {
      // Le nom du relais dépend de la façon dont il a été créé sur Supabase (minuscules ou majuscules).
      const names = [store.get("relay", "suno-import"), "suno-import", "SUNO-IMPORT"].filter((v, i, x) => x.indexOf(v) === i);
      // Un nom inexistant fait échouer la pré-vérification du navigateur : on essaie alors le suivant.
      let r = null;
      for (const n of names) {
        try { r = await fetch(`${cfg.supabaseUrl}/functions/v1/${n}?type=${type}&id=${id}${extra}`, { headers: { apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + cfg.supabaseAnonKey } }); }
        catch { r = null; continue; }
        if (r.status !== 404) { store.set("relay", n); break; }
      }
      if (!r) return { error: "network" };
      if (!r.ok) return { error: r.status };
      return await r.json();
    } catch { return { error: "network" }; }
  }
  // Vérifie qu'une adresse audio se lit vraiment dans ce navigateur.
  function probeUrl(url, ms = 12000) {
    return new Promise(res => {
      const a = new Audio(); a.crossOrigin = "anonymous"; a.preload = "metadata"; a.muted = true;
      let done = false; const end = ok => { if (done) return; done = true; a.removeAttribute("src"); res(ok); };
      a.onloadedmetadata = () => end(true); a.onerror = () => end(false); setTimeout(() => end(false), ms);
      a.src = url;
    });
  }
  // Paroles Suno : on retire le bloc de consignes de style placé en tête ([Style] …).
  function cleanSunoLyrics(text) {
    if (!text) return null;
    const out = []; let skip = false;
    for (const line of String(text).split(/\r?\n/)) {
      const t = line.trim();
      if (/^\[\s*(style|styles|genre|instruments?)\b[^\]]*\]$/i.test(t)) { skip = true; continue; }
      if (/^\[[^\]]+\]$/.test(t)) skip = false;
      if (!skip) out.push(line);
    }
    const r = out.join("\n").trim();
    return r ? r.slice(0, 8000) : null;
  }
  // Pour une chanson Suno : seule la version publique (MP4) est utilisée. Le relais sert à savoir
  // si la chanson est privée et à récupérer titre, pochette et paroles.
  async function sunoPlayable(id, info) {
    if (!info) { const r = await relay("song", id); info = r && r.songs && r.songs[0]; }
    if (await probeUrl(sunoAudio(id))) return { url: sunoAudio(id), info };
    if (info && !info.isPublic) return { error: "private", info };
    return { error: "nosound", info };
  }

  // Liens SoundCloud / YouTube : normalisation vers une forme unique
  function parseExt(input) {
    const raw = String(input || "").trim(); let u; try { u = new URL(raw); } catch { return null; }
    const h = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    if (h === "youtu.be") { const id = u.pathname.slice(1, 12); return /^[\w-]{11}$/.test(id) ? { kind: "youtube", id, url: "https://www.youtube.com/watch?v=" + id } : null; }
    if (h === "youtube.com") {
      const id = u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/) || [])[1];
      return id && /^[\w-]{11}$/.test(id) ? { kind: "youtube", id, url: "https://www.youtube.com/watch?v=" + id } : null;
    }
    if (h === "on.soundcloud.com") return { short: true };
    if (h === "soundcloud.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length < 2 || parts.length > 3 || ["sets", "likes", "reposts", "tracks", "albums"].includes(parts[1])) return null;
      if (!parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
      return { kind: "soundcloud", url: "https://soundcloud.com/" + parts.join("/") };
    }
    return null;
  }
  async function oembed(p) {
    const api = p.kind === "youtube" ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(p.url)}` : `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(p.url)}`;
    try { const r = await fetch(api); if (!r.ok) return null; return await r.json(); } catch { return null; }
  }

  function bindPublish() {
    document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { pubMode = b.dataset.mode; render(); });
    const msg = (text, kind = "") => { const el = $("form-msg"); el.textContent = text; el.className = "form-msg " + kind; };
    // Vérifie que Suno sert vraiment le son avant d'autoriser la publication.
    const probe = { id: null, state: null, wait: null, url: null, info: null };
    function probeSuno(id) {
      if (probe.id === id) return;
      Object.assign(probe, { id, state: "pending", url: null, info: null });
      probe.wait = sunoPlayable(id).then(r => {
        if (probe.id !== id) return;
        probe.info = r.info || null;
        if (r.url) { probe.url = r.url; probe.state = "ok"; } else probe.state = r.error === "private" ? "private" : "fail";
        if (r.info) {
          if (!$("f-title").value && r.info.title) { $("f-title").value = r.info.title.slice(0, 120); }
          if (!$("f-lyrics").value && r.info.lyrics) $("f-lyrics").value = cleanSunoLyrics(r.info.lyrics) || "";
          update();
        }
        showProbe();
      });
      showProbe();
    }
    function showProbe() {
      if (pubMode !== "link") return;
      if (probe.state === "pending") msg("Vérification du son chez Suno…");
      else if (probe.state === "ok") msg("Son vérifié : ta chanson est prête à être publiée.", "ok");
      else if (probe.state === "private") msg("Cette chanson est privée sur Suno. Rends-la publique (⋯ › Visibilité › Publique), puis recolle le lien.", "err");
      else if (probe.state === "fail") msg("Suno ne rend pas encore ce son public. Sur Suno, rends la chanson publique (⋯ › Visibilité › Publique), attends quelques minutes puis recolle le lien. Sinon, choisis « Fichier audio » et envoie le fichier (Suno : ⋯ › Télécharger › MP3).", "err");
    }
    let extInfo = { url: null, meta: null };
    async function extPreview(p) {
      if (extInfo.url === p.url) return;
      extInfo = { url: p.url, meta: null };
      msg("Lecture des informations…");
      const m = await oembed(p);
      if (extInfo.url !== p.url) return;
      extInfo.meta = m;
      const img = $("pv-cover");
      const thumb = p.kind === "youtube" ? `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg` : m && m.thumbnail_url;
      if (thumb) { img.src = thumb; img.hidden = false; }
      if (m) {
        if (!$("f-title").value && m.title) $("f-title").value = String(m.title).replace(/\s+by\s+.+$/i, "").slice(0, 120);
        if (!$("f-artist").value && m.author_name) $("f-artist").value = String(m.author_name).slice(0, 80);
        update();
      }
      msg(p.kind === "youtube" ? "Lien YouTube reconnu. La vidéo sera lue avec le lecteur YouTube." : "Lien SoundCloud reconnu. Le titre sera lu avec le lecteur SoundCloud.", "ok");
    }
    function update() {
      const a = $("pv-audio"), img = $("pv-cover");
      if (pvUrl) { URL.revokeObjectURL(pvUrl); pvUrl = null; }
      $("pv-title").textContent = $("f-title").value.trim() || "Aperçu";
      $("pv-artist").textContent = $("f-artist").value.trim() || "Ta pochette et ton son apparaîtront ici";
      if (pubMode === "link") {
        const p = parseSuno($("f-link").value);
        if (p && p.id) { probeSuno(p.id); if (a.dataset.id !== p.id) { a.src = sunoAudio(p.id); a.dataset.id = p.id; } img.src = sunoCover(p.id); img.hidden = false; a.hidden = false; img.onerror = () => { img.src = `https://cdn2.suno.ai/image_${p.id}.jpeg`; img.onerror = null; }; showProbe(); return; }
        if (p && p.short) msg("Ce lien court ne contient pas l'identifiant de la chanson. Ouvre-le dans ton navigateur, puis copie l'adresse complète (suno.com/song/…).", "err");
        img.hidden = true; a.hidden = true; a.removeAttribute("src"); delete a.dataset.id; return;
      }
      if (pubMode === "ext") {
        a.hidden = true;
        const p = parseExt($("f-ext").value);
        if (p && p.short) { msg("Ce lien court SoundCloud ne peut pas être lu. Ouvre-le, puis copie l'adresse complète (soundcloud.com/artiste/titre).", "err"); return; }
        if (p && p.url) { extPreview(p); return; }
        if ($("f-ext").value.trim()) msg("Ce lien n'est pas reconnu. Colle le lien d'un titre SoundCloud ou d'une vidéo YouTube.", "err");
        img.hidden = true; return;
      }
      const f = $("f-audio").files[0];
      if (f) { pvUrl = URL.createObjectURL(f); a.src = pvUrl; a.hidden = false; const c = $("f-cover").files[0]; if (c) { img.src = URL.createObjectURL(c); img.hidden = false; } else img.hidden = true; }
      else { a.hidden = true; img.hidden = true; }
    }
    ["f-link", "f-ext", "f-title", "f-artist"].forEach(id => $(id).addEventListener("input", update));
    let PL = null;
    async function loadPlaylist() {
      const v = $("f-pl").value.trim().replace(/[.,;:!?)\]]+$/, "");   // ponctuation collée par erreur en fin de lien
      const m = /suno\.(?:com|ai)\/playlist\/([0-9a-f-]{36})/i.exec(v), hm = /suno\.(?:com|ai)\/@([A-Za-z0-9_.-]{1,40})/i.exec(v) || /^@([A-Za-z0-9_.-]{1,40})$/.exec(v);
      const box = $("pl-box");
      if (!m && !hm) { box.innerHTML = v ? `<p class="form-msg err">Colle un lien de playlist (suno.com/playlist/…) ou de profil (suno.com/@ton-pseudo).</p>` : ""; PL = null; return; }
      const key = m ? m[1].toLowerCase() : "@" + hm[1].toLowerCase();
      if (PL && PL.id === key) return;
      PL = { id: key, songs: null };
      box.innerHTML = `<p class="form-msg">${m ? "Lecture de la playlist" : "Lecture du profil"} chez Suno…</p>`;
      const r = m ? await relay("playlist", key) : await relay("profile", "", "&handle=" + encodeURIComponent(hm[1]));
      if (!PL || PL.id !== key) return;
      if (!r || r.error || !r.songs) { box.innerHTML = `<p class="form-msg err">${r && r.error === 404 ? "Le relais DOZE n'est pas encore installé sur Supabase." : r && r.error === 400 && !m ? "Le relais doit être mis à jour pour lire les profils (voir le guide)." : "Impossible de lire ce lien. Vérifie qu'il est public sur Suno, puis réessaie."}</p>`; PL = null; return; }
      if (!r.songs.length) { box.innerHTML = `<p class="form-msg err">${m ? "Cette playlist ne contient aucune chanson lisible." : "Aucune chanson publique trouvée sur ce profil, ou le relais doit être mis à jour pour lire les profils."}</p>`; PL = null; return; }
      PL.title = r.title; PL.songs = r.songs;
      const have = new Set(S.all.map(t => t.suno_id).filter(Boolean));
      if (!$("f-artist").value && r.songs[0] && r.songs[0].artist) $("f-artist").value = r.songs[0].artist;
      box.innerHTML = `<div class="pl-head"><strong>${esc(r.title || "Playlist")}</strong><span>${plural(r.songs.length, "chanson")} · ${r.songs.filter(x => x.isPublic && !have.has(x.id)).length} à importer</span></div>
        <ul class="pl-list">${r.songs.map(x => { const ok = x.isPublic && !have.has(x.id);
          return `<li class="${ok ? "" : "off"}"><label><input type="checkbox" data-pl="${x.id}" ${ok ? "checked" : "disabled"}>${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy">` : ""}<span><b>${esc(x.title || "Sans titre")}</b><i>${have.has(x.id) ? "Déjà sur DOZE" : x.isPublic ? (x.duration ? fmt(x.duration) : "") + (x.lyrics ? " · paroles incluses" : "") : "Privée sur Suno : rends-la publique pour l'importer"}</i></span></label></li>`; }).join("")}</ul>`;
      const priv = r.songs.filter(x => !x.isPublic).length;
      if (priv) box.insertAdjacentHTML("beforeend", `<p class="sheet-note pl-note">${priv === r.songs.length ? "Toutes les chansons sont privées." : plural(priv, "chanson") + " privée" + (priv > 1 ? "s" : "") + "."} Attention : sur Suno, rendre la <b>playlist</b> publique ne rend pas ses <b>chansons</b> publiques. Pour chaque chanson, touche le <b>⋯</b> à sa droite puis <b>Make public</b>, attends quelques minutes et recolle le lien.</p>`);
      $("submit").textContent = "Importer la sélection";
    }
    $("f-pl").addEventListener("input", () => { clearTimeout(S.plT); S.plT = setTimeout(loadPlaylist, 400); });
    async function importPlaylist() {
      const artist = $("f-artist").value.trim(), genre = $("f-genre").value.trim() || null, made = $("f-made").value.trim().slice(0, 40) || "Suno";
      if (!PL || !PL.songs) { msg("Colle d'abord le lien d'une playlist Suno.", "err"); return; }
      const ids = [...document.querySelectorAll("[data-pl]:checked")].map(c => c.dataset.pl);
      if (!ids.length) { msg("Coche au moins une chanson publique à importer.", "err"); return; }
      if (!artist) { msg("Indique ton nom d'artiste.", "err"); return; }
      if (!$("f-rights").checked) { msg("Coche la case pour confirmer que tu as le droit de diffuser ces chansons.", "err"); return; }
      const btn = $("submit"); btn.disabled = true;
      let okN = 0; const fails = [];
      for (const [k, id] of ids.entries()) {
        const x = PL.songs.find(s2 => s2.id === id);
        msg(`Import ${k + 1} / ${ids.length} : « ${x.title} »…`);
        const pr = await sunoPlayable(id, x);
        if (!pr.url) { fails.push(x.title); continue; }
        const row = { title: (x.title || "Sans titre").slice(0, 120), artist, genre, source: "suno", suno_id: id, audio_url: pr.url, cover_url: x.cover || sunoCover(id) };
        const ly = cleanSunoLyrics(x.lyrics); if (ly && S.hasV2) row.lyrics = ly;
        if (S.hasV3) { row.ai = true; row.made_with = made; }
        const key = uuid(); if (S.hasV4) row.edit_key = key;
        const { data: ins, error } = await sb.from("tracks").insert(row).select("id");
        if (error) { fails.push(x.title + (error.code === "23505" ? " (déjà sur DOZE)" : "")); continue; }
        if (S.hasV4 && ins && ins[0]) { owned[ins[0].id] = key; store.set("owned", owned); }
        okN++;
      }
      store.set("artist", artist);
      btn.disabled = false;
      const summary = `${plural(okN, "chanson")} importée${okN > 1 ? "s" : ""}.${fails.length ? " Pas encore de son public chez Suno pour : " + fails.join(", ") + ". Réessaie dans quelques minutes." : ""}`;
      msg(summary, okN ? "ok" : "err"); toast(summary);
      if (okN) { await load(); setTimeout(() => go("artiste", artist), 1600); }
    }
    $("f-audio").addEventListener("change", () => { const f = $("f-audio").files[0]; if (f && !$("f-title").value) $("f-title").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120); update(); });
    $("f-cover").addEventListener("change", update);
    update();

    $("add-form").addEventListener("submit", async e => {
      e.preventDefault();
      if (!sb) { msg("L'appli n'est pas encore reliée à sa base de données.", "err"); return; }
      if (pubMode === "pl") { importPlaylist(); return; }
      const title = $("f-title").value.trim(), artist = $("f-artist").value.trim(), genre = $("f-genre").value.trim() || null;
      const lyrics = $("f-lyrics").value.trim() || null, made = $("f-made").value.trim().slice(0, 40) || null, ai = pubMode === "link" || $("f-ai").checked;
      if (!title || !artist) { msg("Indique le titre et ton nom d'artiste.", "err"); return; }
      if (!$("f-rights").checked) { msg("Coche la case pour confirmer que tu as le droit de diffuser cette chanson.", "err"); return; }
      if (pubMode === "ext" && !S.hasV3) { msg("La publication par lien SoundCloud ou YouTube arrive très bientôt (mise à jour de la base en cours).", "err"); return; }
      const btn = $("submit"); btn.disabled = true;
      try {
        let row;
        if (pubMode === "link") {
          const p = parseSuno($("f-link").value);
          if (!p || !p.id) { msg(p && p.short ? "Utilise l'adresse complète suno.com/song/…" : "Colle le lien de ta chanson Suno (suno.com/song/…).", "err"); return; }
          probeSuno(p.id); if (probe.state === "pending") await probe.wait;
          if (probe.state !== "ok") { showProbe(); return; }
          row = { title, artist, genre, source: "suno", suno_id: p.id, audio_url: probe.url || sunoAudio(p.id), cover_url: (probe.info && probe.info.cover) || sunoCover(p.id) };
        } else if (pubMode === "ext") {
          const p = parseExt($("f-ext").value);
          if (!p || !p.url) { msg("Colle le lien d'un titre SoundCloud ou d'une vidéo YouTube.", "err"); return; }
          const m = extInfo.url === p.url ? extInfo.meta : await oembed(p);
          const cover = p.kind === "youtube" ? `https://i.ytimg.com/vi/${p.id}/hqdefault.jpg` : (m && m.thumbnail_url) || null;
          row = { title, artist, genre, source: p.kind, audio_url: p.url, cover_url: cover };
        } else {
          const f = $("f-audio").files[0];
          if (!f) { msg("Choisis le fichier audio de ta chanson.", "err"); return; }
          if (f.size > 15 * 1024 * 1024) { msg("Le fichier dépasse 15 Mo. Exporte-le en MP3 depuis ton appli.", "err"); return; }
          msg("Envoi du fichier…");
          const id = uuid();
          const ext = (f.name.split(".").pop() || "mp3").toLowerCase().slice(0, 4);
          const up = await sb.storage.from("songs").upload(`audio/${id}.${ext}`, f, { contentType: f.type || "audio/mpeg" });
          if (up.error) throw up.error;
          const audioUrl = sb.storage.from("songs").getPublicUrl(`audio/${id}.${ext}`).data.publicUrl;
          let coverUrl = null;
          const c = $("f-cover").files[0];
          if (c) {
            const cext = (c.name.split(".").pop() || "jpg").toLowerCase().slice(0, 4);
            const cu = await sb.storage.from("songs").upload(`covers/${id}.${cext}`, c, { contentType: c.type });
            if (!cu.error) coverUrl = sb.storage.from("songs").getPublicUrl(`covers/${id}.${cext}`).data.publicUrl;
          }
          row = { title, artist, genre, source: "upload", audio_url: audioUrl, cover_url: coverUrl };
        }
        if (lyrics && S.hasV2) row.lyrics = lyrics;
        if (S.hasV3) { row.ai = ai; row.made_with = made || (pubMode === "link" ? "Suno" : null); }
        msg("Publication…");
        const key = uuid();
        if (S.hasV4) row.edit_key = key;
        const { data: ins, error } = await sb.from("tracks").insert(row).select("id");
        if (error) { if (error.code === "23505") { msg("Cette chanson est déjà sur DOZE.", "err"); return; } throw error; }
        store.set("artist", artist);
        if (S.hasV4 && ins && ins[0]) { owned[ins[0].id] = key; store.set("owned", owned); }
        msg("Publiée ! Ta chanson est maintenant écoutable par tout le monde.", "ok"); toast("Publiée ! Ta chanson est maintenant écoutable par tout le monde.");
        await load();
        setTimeout(() => go("artiste", artist), 1200);
      } catch (err) {
        console.error(err);
        msg("La publication a échoué (" + (err.message || "erreur réseau") + "). Réessaie dans un instant.", "err");
      } finally { const b = $("submit"); if (b) b.disabled = false; }
    });
  }

  // ---------- démarrage ----------
  const h0 = location.hash.slice(1);
  if (ROUTES.includes(h0)) S.view = h0;
  syncModes(); syncLike(); render();
  (async () => {
    await load();
    const adm = new URLSearchParams(location.search).get("admin");
    if (adm && sb) {
      const r = await sb.rpc("is_admin", { p_key: adm });
      history.replaceState(null, "", location.pathname + location.hash);
      if (r.data === true) { adminKey = adm; store.set("admin", adm); toast("Mode administrateur activé sur cet appareil"); } else toast("Clé administrateur invalide");
    }
    const plId = new URLSearchParams(location.search).get("p");
    if (plId) openList(plId);
    const id = new URLSearchParams(location.search).get("t");
    if (id && sb) {
      let t = byId(id);
      if (!t) { const r = await sb.from("tracks").select("id,title,artist,genre,source,suno_id,audio_url,cover_url,plays,likes,created_at").eq("id", id).maybeSingle(); t = r.data; }
      const ded = b64.dec(new URLSearchParams(location.search).get("d") || "");
      if (t) { startQueue([t, ...S.all.filter(x => x.id !== t.id)], 0, false, ded ? ["Dédicace", "pour " + (ded.to || "toi")] : ["Partagé avec toi", "DOZE"]); openNP(); showDedic(ded); toast("Appuie sur lecture pour écouter « " + t.title + " »"); }
    }
  })();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
