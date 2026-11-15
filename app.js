/* Écrin 3.1.0 */
  const VERSION = "3.1.0";
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
  const offline = store.get("offline", {});            // { id: { t: titre, lyrics, size, at } } : chansons téléchargées          // [{ id, key, name }] (key nulle = playlist d'un autre, enregistrée)
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
    constructor(el) { super(); this.el = el; this.ext = null; for (const ev of ["play", "pause", "timeupdate", "ended", "loadedmetadata", "error"]) el.addEventListener(ev, () => { if (!this.ext) this.emit(ev); }); }
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
  function toast(msg) { const el = $("toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 2800); }
  function shareUrl(t) { const u = new URL(location.href); u.search = "?t=" + t.id; u.hash = ""; return u.toString(); }
  async function share(t) {
    const url = shareUrl(t);
    if (navigator.share) { try { await navigator.share({ title: t.title + " · " + t.artist + " | Écrin", url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); toast("Lien copié, il ne reste qu'à le coller"); } catch { toast(url); }
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
    return `<div class="card${cur && cur.id === t.id ? " is-current" : ""}" data-ctx="${ctx}" data-i="${i}" role="button" tabindex="0" aria-label="Écouter ${esc(t.title)} de ${esc(t.artist)}">
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
    return `<section><div class="sec-head"><div><h2>Artistes</h2><p>Les talents d'Écrin, connus ou en herbe</p></div></div>
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
  const mobileBrand = `<div class="mobile-brand"><a class="brand" href="#accueil"><img src="logo-64.png" alt=""><span class="word">ÉCRIN</span></a><span class="ver">v${VERSION}</span></div>`;
  const playIcon = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const shuffleIcon = '<svg viewBox="0 0 24 24"><path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2z"/></svg>';
  function greeting() { const h = new Date().getHours(); return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; }

  // ---------- vues ----------
  const views = {
    accueil() {
      if (!S.loaded) return mobileBrand + `<h1 class="greet">${greeting()}</h1><div class="empty">Chargement des créations…</div>`;
      if (S.offlineMode && !S.all.length) return mobileBrand + `<div class="empty">Pas de connexion et aucun titre téléchargé.</div>`;
      if (S.error) return mobileBrand + `<div class="empty">Impossible de charger les chansons. Vérifie ta connexion, puis recharge la page.</div>`;
      if (!S.all.length) return mobileBrand + `<h1 class="greet">${greeting()}</h1><div class="empty"><strong>Écrin attend sa première chanson.</strong><span>Publie la tienne : elle sera la première que le monde entendra ici.</span><a class="btn btn-gold" href="#publier">Publier ma chanson</a></div>`;
      const top = popular()[0];
      S.ctx.hero = [top];
      const recent = history.map(byId).filter(Boolean).slice(0, 12);
      return mobileBrand + `${S.offlineMode ? '<div class="offline-banner">📴 Hors connexion : tu écoutes tes titres téléchargés.</div>' : ""}<h1 class="greet">${greeting()}</h1>
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
      return mobileBrand + `<div class="page-head"><div class="ph-bg" style="background:linear-gradient(135deg,#4B2BC9,#0B1129 75%)"></div>
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
      return mobileBrand + `<div class="page-head"><div class="ph-bg" style="background:linear-gradient(135deg, ${genreColors(pl.name)[0]}, #0B1129 80%)"></div>
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
      if (!list.length) return mobileBrand + `<div class="empty">Cet artiste n'a pas encore de chanson sur Écrin.</div>`;
      const plays = list.reduce((s, t) => s + t.plays, 0);
      const [a, b] = genreColors(name);
      return mobileBrand + `<div class="page-head"><div class="ph-bg" style="background:linear-gradient(135deg, ${a}, #0B1129 80%)"></div>
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
            <p>Talent en herbe, artiste confirmé ou créateur IA : ta musique rejoint Écrin et devient écoutable par tout le monde. Les nouveaux titres passent dans « Pépites à découvrir » pour trouver leurs premiers auditeurs.</p></div>
          <div class="seg seg3" role="group" aria-label="Méthode">
            <button class="${pubMode === "link" ? "is-on" : ""}" data-mode="link" type="button">Suno</button>
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
              <span>Une chanson privée n'a pas de son pour les autres : Écrin la refusera. Tu peux aussi choisir « Fichier audio ».</span>
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
            <div class="suno-steps" data-for="ext" ${pubMode === "ext" ? "" : "hidden"}>
              <strong>Ta chanson est déjà sur SoundCloud ou YouTube ?</strong>
              <span>Colle son lien : elle sera lue sur Écrin avec le lecteur officiel de SoundCloud ou YouTube, qui s'affiche sur la pochette. La chanson doit être publique et autoriser l'intégration.</span>
            </div>
            <div class="field" data-for="ext" ${pubMode === "ext" ? "" : "hidden"}>
              <label for="f-ext">Lien SoundCloud ou YouTube</label>
              <input id="f-ext" type="url" inputmode="url" placeholder="https://soundcloud.com/… ou https://youtu.be/…" autocomplete="off">
              <small>Exemples : soundcloud.com/artiste/titre · youtube.com/watch?v=… · youtu.be/…</small>
            </div>
            <div class="two">
              <div class="field"><label for="f-title">Titre</label><input id="f-title" maxlength="120" required autocomplete="off"></div>
              <div class="field"><label for="f-artist">Nom d'artiste</label><input id="f-artist" maxlength="80" required autocomplete="nickname" value="${esc(store.get("artist", ""))}"></div>
            </div>
            <div class="two">
              <div class="field"><label for="f-genre">Genre (facultatif)</label><input id="f-genre" maxlength="40" list="genres-list" autocomplete="off">
                <datalist id="genres-list">${["Afrobeat", "Coupé-décalé", "Zouglou", "Rap", "R&B", "Pop", "Gospel", "Reggae", "Électro", "Rock", "Jazz", "Classique", ...genres().map(g => g.name)].filter((v, i, a) => a.indexOf(v) === i).map(g => `<option>${esc(g)}</option>`).join("")}</datalist></div>
              <div class="field"><label for="f-made">Créé avec (facultatif)</label><input id="f-made" maxlength="40" list="tools-list" autocomplete="off" ${pubMode === "link" ? 'value="Suno"' : ""}>
                <datalist id="tools-list">${tools.map(x => `<option>${x}</option>`).join("")}</datalist></div>
            </div>
            <label class="check"><input id="f-ai" type="checkbox" ${pubMode === "link" ? "checked disabled" : ""}><span>Cette chanson a été créée avec l'aide de l'IA. <small>Les auditeurs voient une petite mention « IA » : la transparence rassure.</small></span></label>
            <div class="field"><label for="f-lyrics">Paroles (facultatif)</label><textarea id="f-lyrics" rows="6" maxlength="8000" placeholder="Colle ici les paroles. Elles défileront sur la pochette pendant l'écoute."></textarea>
              <small>Astuce : au format LRC (<code>[01:23.45] ma ligne</code>), elles seront parfaitement synchronisées. Sinon, Écrin estime le rythme.</small></div>
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
    if (e.target.closest("[data-shuffle-all]")) { setShuffle(true); startQueue(S.all, Math.floor(Math.random() * S.all.length), true, ["Aléatoire", "Tout Écrin"]); return; }
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
    menuEl.innerHTML = items || `<button type="button" data-a="next">Écouter juste après</button><button type="button" data-a="dedic">🎁 Dédicacer ce son</button>${t && canOffline(t) ? (offline[t.id] ? '<button type="button" data-a="undl">✓ Retirer des téléchargements</button>' : '<button type="button" data-a="dl">⬇ Télécharger (hors ligne)</button>') : ""}<button type="button" data-a="addlist">Ajouter à une playlist</button><button type="button" data-a="artist">Voir l'artiste</button><button type="button" data-a="share">Partager</button><div class="sep"></div><button type="button" data-a="report" class="danger">Signaler un abus</button>`;
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
      if (a === "undl") removeOffline(t.id);
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
      if (!line || /^\(.*\)$/.test(line)) continue;
      plain.push({ text: line });
    }
    if (timed.length >= 3) return { lines: timed.filter(l => l.text).sort((a, b) => a.t - b.t), timed: true };
    return { lines: plain, timed: false };
  }
  function estimateTimes(L, dur) {
    if (L.timed || !(dur > 0) || !L.lines.length) return;
    const start = Math.min(14, dur * .07), end = dur * .94, w = L.lines.map(l => l.text.length + 14), tot = w.reduce((a, b) => a + b, 0);
    let acc = start; L.lines.forEach((l, i) => { l.t = acc; acc += (end - start) * w[i] / tot; });
    L.estimated = true;
  }
  async function loadLyr(t) {
    S.lyr = { id: t.id, lines: [], timed: false, loading: true }; renderLyr(true);
    let text = null;
    if (offline[t.id] && offline[t.id].lyrics) text = offline[t.id].lyrics;
    else if (sb && S.hasV2 && !S.offlineMode) { try { const r = await sb.from("tracks").select("lyrics").eq("id", t.id).maybeSingle(); text = r.data && r.data.lyrics; } catch {} }
    if (!current() || current().id !== t.id) return;
    S.lyr = { id: t.id, ...parseLyrics(text) }; estimateTimes(S.lyr, audio.duration); S.lyrIdx = -1; renderLyr(true);
  }
  function renderLyr(full) {
    const L = S.lyr, box = $("lyr"), pill = $("lyr-pill");
    const has = !!(L && L.lines && L.lines.length);
    pill.hidden = !has; pill.setAttribute("aria-pressed", S.showLyr);
    box.hidden = !(has && S.showLyr);
    if (!has || !S.showLyr) return;
    if (full) {
      $("lyr-lines").innerHTML = L.lines.map((l, i) => `<p data-l="${i}">${esc(l.text)}</p>`).join("");
      $("lyr-note").textContent = L.timed ? "Paroles synchronisées" : "Synchronisation estimée";
      S.lyrIdx = -1;
    }
    syncLyr();
  }
  function syncLyr() {
    const L = S.lyr; if (!L || !L.lines.length || $("lyr").hidden || $("np").hidden) return;
    if (!L.timed && !L.estimated) estimateTimes(L, audio.duration);
    const tt = audio.currentTime; let i = -1;
    for (let k = 0; k < L.lines.length; k++) { if (L.lines[k].t <= tt + .15) i = k; else break; }
    if (i === S.lyrIdx) return;
    S.lyrIdx = i;
    const ps = $("lyr-lines").children;
    for (let k = 0; k < ps.length; k++) { ps[k].classList.toggle("on", k === i); ps[k].classList.toggle("past", k < i); }
    const cur = ps[Math.max(0, i)];
    if (cur) { const box = $("lyr-lines"); box.scrollTo({ top: cur.offsetTop - box.clientHeight * .38, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  }
  $("lyr-pill").onclick = () => { S.showLyr = !S.showLyr; store.set("showLyr", S.showLyr); renderLyr(true); };
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
    const url = u.toString();
    if (navigator.share) { navigator.share({ title: pl.name + " | Écrin", url }).catch(() => {}); return; }
    navigator.clipboard.writeText(url).then(() => toast("Lien de la playlist copié"), () => toast(url));
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
      const src = FX.ctx.createMediaElementSource(media);
      FX.filters = BANDS.map(([f, type]) => { const b = FX.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = 1; b.gain.value = 0; return b; });
      FX.gain = FX.ctx.createGain();
      FX.analyser = FX.ctx.createAnalyser(); FX.analyser.fftSize = 256; FX.analyser.smoothingTimeConstant = .8;
      FX.bins = new Uint8Array(FX.analyser.frequencyBinCount);
      [src, ...FX.filters, FX.gain, FX.analyser, FX.ctx.destination].reduce((a, b) => (a.connect(b), b));
      return true;
    } catch (e) { console.warn(e); FX.ctx = null; return false; }
  }
  function fxResume() { if (FX.enabled && fxGraph() && FX.ctx.state !== "running") FX.ctx.resume().catch(() => {}); applyEq(); }
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
      } catch { setTint(76, 63, 180); }
    };
    img.onerror = () => setTint(76, 63, 180);
    img.src = coverOf(t);
  }
  function setTint(r, g, b) { const np = $("np"); np.style.setProperty("--tint", `rgb(${r},${g},${b})`); np.style.setProperty("--tint-rgb", `${r},${g},${b}`); }

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
    const rgb = getComputedStyle($("np")).getPropertyValue("--tint-rgb").trim() || "76,63,180";
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
        x.strokeStyle = `rgba(242,199,102,${.25 + v * .7})`;
        x.beginPath(); x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len)); x.stroke();
      }
      art.style.transform = `scale(${1 + bass * .025})`;
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
        <div class="sheet-row info"><svg viewBox="0 0 24 24"><path d="M17.7 7.7 12 2h-1v7.6L6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l4.6-4.6V22h1l5.7-5.7-4.3-4.3zM13 5.8l1.9 1.9L13 9.6zm1.9 10.5L13 18.2v-3.8z"/></svg><span>Bluetooth<small>Connecte ton casque ou ton enceinte dans les réglages Bluetooth du téléphone : Écrin passe dessus automatiquement.</small></span></div>
        <div class="sheet-btns"><button class="btn" type="button" data-sheet="settings">Réglages audio</button><button class="btn" type="button" data-sheet="eq">Égaliseur</button></div>`;
    }
    if (view === "eq") {
      $("sheet-title").textContent = "Égaliseur";
      const g = FX.enabled ? currentGains() : [0, 0, 0, 0, 0];
      const autoName = t ? PRESETS[GENRE_PRESET[norm(t.genre)] || "plat"][0] : "Plat";
      body.innerHTML = `${!FX.enabled ? `<div class="sheet-note">Les effets audio sont désactivés. <button class="link" type="button" data-sheet="settings">Les activer</button></div>` : ""}
        <div class="chips">${[["auto", "Auto · selon le genre"], ...Object.entries(PRESETS).map(([k, v]) => [k, v[0]]), ["perso", "Personnalisé"]].map(([k, n]) => `<button class="chip${FX.preset === k ? " is-on" : ""}" type="button" data-preset="${k}">${n}</button>`).join("")}</div>
        ${FX.preset === "auto" ? `<p class="sheet-note">Innovation Écrin : le réglage s'adapte à chaque chanson. Pour ${t ? `« ${esc(t.title)} »${t.genre ? ` (${esc(t.genre)})` : ""}` : "ce titre"}, il applique <b>${autoName}</b>.</p>` : ""}
        <div class="eq-bands">${BANDS.map(([f, , n], i) => `<label class="band"><span class="db">${g[i] > 0 ? "+" : ""}${g[i]} dB</span><input type="range" min="-12" max="12" step="1" value="${g[i]}" data-band="${i}" aria-label="${n}" ${FX.enabled ? "" : "disabled"}><span class="hz">${f >= 1000 ? f / 1000 + " k" : f} Hz</span><small>${n}</small></label>`).join("")}</div>`;
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
  });
  $("sheet-wrap").addEventListener("input", e => {
    const b = e.target.closest("[data-band]");
    if (b) { if (FX.preset !== "perso") { FX.custom = currentGains().slice(); FX.preset = "perso"; store.set("eq", "perso"); document.querySelectorAll("[data-preset]").forEach(c => c.classList.toggle("is-on", c.dataset.preset === "perso")); }
      FX.custom[+b.dataset.band] = +b.value; store.set("eqCustom", FX.custom); applyEq(); b.parentElement.querySelector(".db").textContent = (b.value > 0 ? "+" : "") + b.value + " dB"; }
  });
  $("sheet-wrap").addEventListener("change", e => {
    const s2 = e.target.closest("[data-set]"); if (!s2) return;
    if (s2.dataset.set === "fx") { FX.enabled = s2.checked; store.set("fx", FX.enabled); if (FX.enabled) { fxGraph(); fxResume(); } else applyEq(); }
    if (s2.dataset.set === "halo") { FX.halo = s2.checked; store.set("halo", FX.halo); }
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
    if (!("caches" in window) || !("serviceWorker" in navigator)) { toast("Ce navigateur ne permet pas l'écoute hors ligne. Ouvre Écrin dans Safari ou Chrome."); return; }
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

  // ---------- dédicaces (tout tient dans le lien : rien n'est stocké) ----------
  const b64 = { enc: o => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    dec: s => { try { return JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))))); } catch { return null; } } };
  function sendDedic() {
    const d = S.dedTrack || current(); if (!d) return;
    const f = $("d-from").value.trim().slice(0, 40), to = $("d-to").value.trim().slice(0, 40), m = $("d-msg").value.trim().slice(0, 160);
    if (!f || !to) { toast("Indique ton prénom et celui de la personne."); return; }
    store.set("myname", f);
    const u = new URL(location.href); u.search = "?t=" + d.id + "&d=" + b64.enc({ f, to, m }); u.hash = "";
    const url = u.toString(), text = `🎁 ${f} te dédicace « ${d.title} » de ${d.artist} sur Écrin`;
    closeSheet();
    if (navigator.share) { navigator.share({ title: text, text, url }).catch(() => {}); return; }
    navigator.clipboard.writeText(text + " : " + url).then(() => toast("Dédicace copiée : colle-la dans WhatsApp ou ailleurs"), () => toast(url));
  }
  function showDedic(d) {
    const c = $("np-dedic"); if (!d || !d.f) { c.hidden = true; return; }
    c.innerHTML = `<span class="ded-ic">🎁</span><span><b>Dédicace de ${esc(d.f)} pour ${esc(d.to || "toi")}</b>${d.m ? `<q>${esc(d.m)}</q>` : ""}</span><button class="ic" type="button" aria-label="Masquer la dédicace" onclick="this.parentElement.hidden=true"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>`;
    c.hidden = false;
  }

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
    return CTX_LABEL[key] || ["Lecture en cours", "Écrin"];
  }
  function startQueue(list, idx, autoplay = true, label) {
    if (!list || !list.length) return;
    S.label = label || ["Lecture en cours", "Écrin"];
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
    loadLyr(t); syncDl();
    $("np-title").textContent = t.title; $("np-artist").textContent = t.artist;
    renderTags(t); S.lyricsFor = null; if (!$("np").hidden && S.npTab === "lyrics") loadLyrics();
    document.title = t.title + " · " + t.artist + " | Écrin";
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: "Écrin", artwork: [{ src: coverOf(t), sizes: "512x512" }] });
    history = [t.id, ...history.filter(x => x !== t.id)].slice(0, 50); store.set("history", history);
    syncLike(); refreshCurrent(); renderQueue();
  }
  function next(auto = false) {
    if (!S.queue.length) return;
    if (auto && S.sleepEnd) { S.sleepEnd = false; updateSleepBadge(); audio.pause(); toast("Bonne nuit. Minuteur terminé."); return; }
    if (S.pos < S.order.length - 1) S.pos++;
    else if (S.repeat === "all" || !auto) {
      if (S.shuffle) { const last = S.order[S.pos]; buildOrder(Math.floor(Math.random() * S.queue.length)); if (S.queue.length > 1 && S.order[0] === last) S.pos = 1; }
      else S.pos = 0;
    } else { audio.pause(); audio.currentTime = 0; return; }
    playCurrent();
  }
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
      : `<li class="q-empty">${S.repeat === "all" ? "La liste reprendra au début." : "Rien après ce titre."}</li>`;
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
  function openNP() { if (!current()) return; $("np").hidden = false; renderQueue(); startHalo(); requestAnimationFrame(placeExt); renderLyr(true); }
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
  }

  // ---------- publication ----------
  let pubMode = "link", pvUrl;
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
    const probe = { id: null, state: null, wait: null };
    function probeSuno(id) {
      if (probe.id === id) return;
      probe.id = id; probe.state = "pending";
      const a = new Audio(); a.crossOrigin = "anonymous"; a.preload = "metadata"; a.muted = true;
      probe.wait = new Promise(res => {
        const done = st => { if (probe.id === id && probe.state === "pending") { probe.state = st; showProbe(); } a.removeAttribute("src"); res(); };
        a.onloadedmetadata = () => done("ok"); a.onerror = () => done("fail");
        setTimeout(() => done("fail"), 12000);
      });
      a.src = sunoAudio(id); showProbe();
    }
    function showProbe() {
      if (pubMode !== "link") return;
      if (probe.state === "pending") msg("Vérification du son chez Suno…");
      else if (probe.state === "ok") msg("Son vérifié : ta chanson est prête à être publiée.", "ok");
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
    $("f-audio").addEventListener("change", () => { const f = $("f-audio").files[0]; if (f && !$("f-title").value) $("f-title").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120); update(); });
    $("f-cover").addEventListener("change", update);
    update();

    $("add-form").addEventListener("submit", async e => {
      e.preventDefault();
      if (!sb) { msg("L'appli n'est pas encore reliée à sa base de données.", "err"); return; }
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
          row = { title, artist, genre, source: "suno", suno_id: p.id, audio_url: sunoAudio(p.id), cover_url: sunoCover(p.id) };
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
        const { error } = await sb.from("tracks").insert(row);
        if (error) { if (error.code === "23505") { msg("Cette chanson est déjà sur Écrin.", "err"); return; } throw error; }
        store.set("artist", artist);
        msg("Publiée ! Ta chanson est maintenant écoutable par tout le monde.", "ok");
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
    const plId = new URLSearchParams(location.search).get("p");
    if (plId) openList(plId);
    const id = new URLSearchParams(location.search).get("t");
    if (id && sb) {
      let t = byId(id);
      if (!t) { const r = await sb.from("tracks").select("*").eq("id", id).maybeSingle(); t = r.data; }
      const ded = b64.dec(new URLSearchParams(location.search).get("d") || "");
      if (t) { startQueue([t, ...S.all.filter(x => x.id !== t.id)], 0, false, ded ? ["Dédicace", "pour " + (ded.to || "toi")] : ["Partagé avec toi", "Écrin"]); openNP(); showDedic(ded); toast("Appuie sur lecture pour écouter « " + t.title + " »"); }
    }
  })();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
