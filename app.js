/* Écrin 2.1.0 */
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
  let myLists = store.get("playlists", []);          // [{ id, key, name }] (key nulle = playlist d'un autre, enregistrée)
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
  const audio = $("audio");
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
    if (navigator.share) { try { await navigator.share({ title: t.title + " · " + t.artist + " | ÉCRIN.AI", url }); return; } catch (e) { if (e.name === "AbortError") return; } }
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
    if (!sb) { S.loaded = true; render(); return; }
    const cols = "id,title,artist,genre,source,suno_id,audio_url,cover_url,plays,likes,created_at";
    let { data, error } = await sb.from("tracks").select(cols).order("created_at", { ascending: false }).limit(1000);
    S.hasV2 = !error;
    if (error) ({ data, error } = await sb.from("tracks").select("*").order("created_at", { ascending: false }).limit(1000));
    S.loaded = true;
    if (error) { S.error = true; render(); return; }
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
      <div class="art">${imgTag(t)}<span class="ai-tag">IA</span>
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
    return `<section><div class="sec-head"><div><h2>Artistes</h2><p>Les créateurs IA d'Écrin</p></div></div>
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
        <span class="t-text"><span class="t-title">${esc(t.title)}</span><span class="t-sub">${opts.noArtist ? (t.genre ? esc(t.genre) : "Création IA") : `<button type="button" data-artist="${esc(t.artist)}">${esc(t.artist)}</button>`}</span></span>
        <span class="t-genre">${t.genre ? esc(t.genre) : ""}</span>
        <span class="t-plays">${plural(t.plays, "écoute")}${t.likes ? ` · ${nf.format(t.likes)} ♥` : ""}</span>
        <span class="t-acts">
          <button class="ic like" type="button" data-like="${t.id}" aria-pressed="${favs.has(t.id)}" aria-label="Coup de cœur"><svg viewBox="0 0 24 24"><path d="M12 21 10.6 19.7C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1a6 6 0 0 1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z"/></svg></button>
          ${opts.removable ? `<button class="ic" type="button" data-remove="${i}" aria-label="Retirer de la playlist"><svg viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>` : ""}
          <button class="ic" type="button" data-menu="${t.id}" aria-label="Plus d'options"><svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/></svg></button>
        </span></li>`;
    }).join("")}</ol>`;
  }
  const mobileBrand = `<div class="mobile-brand"><a class="brand" href="#accueil"><img src="logo-64.png" alt=""><span class="word">ÉCRIN<em>.AI</em></span></a></div>`;
  const playIcon = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const shuffleIcon = '<svg viewBox="0 0 24 24"><path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2z"/></svg>';
  function greeting() { const h = new Date().getHours(); return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; }

  // ---------- vues ----------
  const views = {
    accueil() {
      if (!S.loaded) return mobileBrand + `<h1 class="greet">${greeting()}</h1><div class="empty">Chargement des créations…</div>`;
      if (S.error) return mobileBrand + `<div class="empty">Impossible de charger les chansons. Vérifie ta connexion, puis recharge la page.</div>`;
      if (!S.all.length) return mobileBrand + `<h1 class="greet">${greeting()}</h1><div class="empty"><strong>Écrin attend sa première chanson.</strong><span>Publie la tienne : elle sera la première que le monde entendra ici.</span><a class="btn btn-gold" href="#publier">Publier ma chanson</a></div>`;
      const top = popular()[0];
      S.ctx.hero = [top];
      const recent = history.map(byId).filter(Boolean).slice(0, 12);
      return mobileBrand + `<h1 class="greet">${greeting()}</h1>
        <section class="hero">
          <div class="hero-bg" style="background-image:url('${esc(coverOf(top))}')"></div>
          ${imgTag(top)}
          <div class="hero-text">
            <span class="eyebrow">À la une · le plus écouté</span>
            <h1>${esc(top.title)}</h1>
            <span class="by">${esc(top.artist)}${top.genre ? " · " + esc(top.genre) : ""}</span>
            <div class="stats"><span>${plural(top.plays, "écoute")}</span><span>Création IA</span></div>
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
          <div class="ph-text"><span class="eyebrow">Artiste IA</span><h1>${esc(name)}</h1><span class="stats">${plural(list.length, "titre")} · ${plural(plays, "écoute")}</span></div></div>
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
      return mobileBrand + `<div class="publish">
        <div>
          <div class="publish-head"><span class="eyebrow">Gratuit · sans compte</span><h1>Publie ta chanson</h1>
            <p>Ta création rejoint Écrin et devient écoutable par tout le monde, en boucle ou en aléatoire. Elle apparaît aussi dans « Pépites à découvrir » pour trouver ses premiers auditeurs.</p></div>
          <div class="seg" role="group" aria-label="Méthode">
            <button id="mode-link" class="${pubMode === "link" ? "is-on" : ""}" data-mode="link" type="button">Lien Suno</button>
            <button id="mode-file" class="${pubMode === "file" ? "is-on" : ""}" data-mode="file" type="button">Fichier MP3</button>
          </div>
          <form id="add-form" novalidate>
            <div class="field" data-for="link" ${pubMode === "link" ? "" : "hidden"}>
              <label for="f-link">Lien de la chanson sur Suno</label>
              <input id="f-link" type="url" inputmode="url" placeholder="https://suno.com/song/…" autocomplete="off">
              <small>Sur Suno : ⋯ › Partager › Copier le lien. La chanson doit être publique sur Suno.</small>
            </div>
            <div class="field" data-for="file" ${pubMode === "file" ? "" : "hidden"}>
              <label for="f-audio">Fichier audio (MP3, WAV ou M4A, 15 Mo max)</label>
              <input id="f-audio" type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a">
            </div>
            <div class="field" data-for="file" ${pubMode === "file" ? "" : "hidden"}>
              <label for="f-cover">Pochette (facultatif, JPG ou PNG)</label>
              <input id="f-cover" type="file" accept="image/jpeg,image/png,image/webp">
            </div>
            <div class="two">
              <div class="field"><label for="f-title">Titre</label><input id="f-title" maxlength="120" required autocomplete="off"></div>
              <div class="field"><label for="f-artist">Nom d'artiste</label><input id="f-artist" maxlength="80" required autocomplete="nickname" value="${esc(store.get("artist", ""))}"></div>
            </div>
            <div class="field"><label for="f-genre">Genre (facultatif)</label><input id="f-genre" maxlength="40" list="genres-list" autocomplete="off">
              <datalist id="genres-list">${["Afrobeat", "Coupé-décalé", "Zouglou", "Rap", "R&B", "Pop", "Gospel", "Reggae", "Électro", "Rock", "Jazz", "Classique", ...genres().map(g => g.name)].filter((v, i, a) => a.indexOf(v) === i).map(g => `<option>${esc(g)}</option>`).join("")}</datalist></div>
            <div class="field"><label for="f-lyrics">Paroles (facultatif)</label><textarea id="f-lyrics" rows="6" maxlength="8000" placeholder="Colle ici les paroles de ta chanson (sur Suno : onglet Lyrics)"></textarea><small>Elles s'afficheront pendant l'écoute.</small></div>
            <label class="check"><input id="f-rights" type="checkbox" required><span>J'ai créé cette chanson avec mon propre compte (Suno ou autre outil IA) et j'accepte qu'elle soit écoutée gratuitement par tous.</span></label>
            <p id="form-msg" class="form-msg" role="status"></p>
            <div><button id="submit" class="btn btn-gold" type="submit">Publier</button></div>
          </form>
          <ul class="perks"><li>Aucun compte à créer, aucune pub, aucun frais.</li><li>Chaque titre est signalé comme création IA : les auditeurs savent ce qu'ils écoutent.</li><li>Les nouveaux titres sont mis en avant, pas seulement les plus écoutés.</li></ul>
        </div>
        <aside class="preview-card" id="preview" aria-live="polite">
          <div class="art"><img id="pv-cover" alt="" hidden></div>
          <strong id="pv-title">Aperçu</strong><span class="t-sub" id="pv-artist">Colle ton lien pour voir ta pochette</span>
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
    const pc = e.target.closest("[data-play-ctx]"); if (pc) { const l = S.ctx[pc.dataset.playCtx]; if (l) { setShuffle(false); startQueue(l, 0); } return; }
    const sc = e.target.closest("[data-shuffle-ctx]"); if (sc) { const l = S.ctx[sc.dataset.shuffleCtx]; if (l) { setShuffle(true); startQueue(l, Math.floor(Math.random() * l.length)); } return; }
    if (e.target.closest("[data-shuffle-all]")) { setShuffle(true); startQueue(S.all, Math.floor(Math.random() * S.all.length)); return; }
    const item = e.target.closest("[data-ctx]");
    if (item) {
      const list = S.ctx[item.dataset.ctx]; const i = +item.dataset.i; const t = list && list[i]; if (!t) return;
      const cur = current();
      if (cur && cur.id === t.id) { togglePlay(); return; }
      startQueue(list, i);
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
    menuEl.innerHTML = items || `<button type="button" data-a="next">Écouter juste après</button><button type="button" data-a="addlist">Ajouter à une playlist</button><button type="button" data-a="artist">Voir l'artiste</button><button type="button" data-a="share">Partager</button><div class="sep"></div><button type="button" data-a="report" class="danger">Signaler un abus</button>`;
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
  document.addEventListener("click", e => { if (menuEl && e.target.isConnected && !menuEl.contains(e.target) && !e.target.closest("[data-menu], #b-sleep")) closeMenu(); });

  // ---------- étiquettes, paroles ----------
  function renderTags(t) {
    $("np-tags").innerHTML = `<span class="ai">Création IA</span>${t.genre ? `<span>${esc(t.genre)}</span>` : ""}<span>${plural(t.plays, "écoute")}</span>${t.likes ? `<span>${nf.format(t.likes)} ♥</span>` : ""}`;
  }
  S.npTab = "queue";
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
    if (navigator.share) { navigator.share({ title: pl.name + " | ÉCRIN.AI", url }).catch(() => {}); return; }
    navigator.clipboard.writeText(url).then(() => toast("Lien de la playlist copié"), () => toast(url));
  }

  // ---------- file de lecture ----------
  function buildOrder(startIdx) {
    const n = S.queue.length;
    let order = [...Array(n).keys()];
    if (S.shuffle) { order.splice(order.indexOf(startIdx), 1); order = shuffled(order); order.unshift(startIdx); S.pos = 0; }
    else S.pos = startIdx;
    S.order = order;
  }
  function startQueue(list, idx, autoplay = true) {
    if (!list || !list.length) return;
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
    if (autoplay) audio.play().catch(() => {});
    $("p-title").textContent = t.title; $("p-artist").textContent = t.artist;
    const img = $("p-cover"); img.src = coverOf(t); img.dataset.fb = t.id; delete img.dataset.failed; img.hidden = false;
    $("np-cover").src = coverOf(t); $("np-cover").dataset.fb = t.id; delete $("np-cover").dataset.failed;
    $("np-bg").style.backgroundImage = `url('${coverOf(t).replace(/'/g, "%27")}')`;
    $("np-title").textContent = t.title; $("np-artist").textContent = t.artist;
    renderTags(t); S.lyricsFor = null; if (!$("np").hidden && S.npTab === "lyrics") loadLyrics();
    document.title = t.title + " · " + t.artist + " | Écrin";
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: "ÉCRIN.AI", artwork: [{ src: coverOf(t), sizes: "512x512" }] });
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
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
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
  function openNP() { if (!current()) return; $("np").hidden = false; renderQueue(); }
  function closeNP() { $("np").hidden = true; }
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
  setInterval(() => { if (S.sleepAt) { if (Date.now() >= S.sleepAt) { S.sleepAt = 0; audio.pause(); toast("Bonne nuit. Minuteur terminé."); } updateSleepBadge(); } }, 15000);

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
  audio.addEventListener("loadedmetadata", () => { $("t-dur").textContent = $("np-dur").textContent = fmt(audio.duration); });
  function syncPlayIcons() { document.querySelectorAll(".i-play").forEach(i => i.hidden = !audio.paused); document.querySelectorAll(".i-pause").forEach(i => i.hidden = audio.paused); refreshCurrent(); }
  audio.addEventListener("play", syncPlayIcons); audio.addEventListener("pause", syncPlayIcons);
  audio.addEventListener("ended", () => next(true));
  audio.addEventListener("error", () => { if (audio.src) { toast("Ce titre n'est pas disponible pour le moment, passage au suivant."); setTimeout(() => next(true), 900); } });
  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => audio.play()); ms.setActionHandler("pause", () => audio.pause());
    ms.setActionHandler("nexttrack", () => next(false)); ms.setActionHandler("previoustrack", prev);
    try { ms.setActionHandler("seekto", d => { audio.currentTime = d.seekTime; }); } catch {}
  }

  // ---------- publication ----------
  let pubMode = "link", pvUrl;
  function bindPublish() {
    document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { pubMode = b.dataset.mode; render(); });
    const msg = (text, kind = "") => { const el = $("form-msg"); el.textContent = text; el.className = "form-msg " + kind; };
    const update = () => {
      const a = $("pv-audio"), img = $("pv-cover");
      if (pvUrl) { URL.revokeObjectURL(pvUrl); pvUrl = null; }
      $("pv-title").textContent = $("f-title").value.trim() || "Aperçu";
      $("pv-artist").textContent = $("f-artist").value.trim() || (pubMode === "link" ? "Colle ton lien pour voir ta pochette" : "Choisis ton fichier audio");
      if (pubMode === "link") {
        const p = parseSuno($("f-link").value);
        if (p && p.id) { if (a.dataset.id !== p.id) { a.src = sunoAudio(p.id); a.dataset.id = p.id; } img.src = sunoCover(p.id); img.hidden = false; a.hidden = false; img.onerror = () => { img.src = `https://cdn2.suno.ai/image_${p.id}.jpeg`; img.onerror = null; }; msg(""); return; }
        if (p && p.short) msg("Ce lien court ne contient pas l'identifiant de la chanson. Ouvre-le dans ton navigateur, puis copie l'adresse complète (suno.com/song/…).", "err");
        img.hidden = true; a.hidden = true; a.removeAttribute("src"); delete a.dataset.id; return;
      }
      const f = $("f-audio").files[0];
      if (f) { pvUrl = URL.createObjectURL(f); a.src = pvUrl; a.hidden = false; const c = $("f-cover").files[0]; if (c) { img.src = URL.createObjectURL(c); img.hidden = false; } else img.hidden = true; }
      else { a.hidden = true; img.hidden = true; }
    };
    ["f-link", "f-title", "f-artist"].forEach(id => $(id).addEventListener("input", update));
    $("f-audio").addEventListener("change", () => { const f = $("f-audio").files[0]; if (f && !$("f-title").value) $("f-title").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120); update(); });
    $("f-cover").addEventListener("change", update);
    update();

    $("add-form").addEventListener("submit", async e => {
      e.preventDefault();
      if (!sb) { msg("L'appli n'est pas encore reliée à sa base de données.", "err"); return; }
      const title = $("f-title").value.trim(), artist = $("f-artist").value.trim(), genre = $("f-genre").value.trim() || null;
      const lyrics = $("f-lyrics").value.trim() || null;
      if (!title || !artist) { msg("Indique le titre et ton nom d'artiste.", "err"); return; }
      if (!$("f-rights").checked) { msg("Coche la case pour confirmer que la chanson est la tienne.", "err"); return; }
      const btn = $("submit"); btn.disabled = true;
      try {
        let row;
        if (pubMode === "link") {
          const p = parseSuno($("f-link").value);
          if (!p || !p.id) { msg(p && p.short ? "Utilise l'adresse complète suno.com/song/…" : "Colle le lien de ta chanson Suno (suno.com/song/…).", "err"); return; }
          row = { title, artist, genre, source: "suno", suno_id: p.id, audio_url: sunoAudio(p.id), cover_url: sunoCover(p.id) };
          if (lyrics && S.hasV2) row.lyrics = lyrics;
        } else {
          const f = $("f-audio").files[0];
          if (!f) { msg("Choisis le fichier audio de ta chanson.", "err"); return; }
          if (f.size > 15 * 1024 * 1024) { msg("Le fichier dépasse 15 Mo. Exporte-le en MP3 depuis ton outil.", "err"); return; }
          msg("Envoi du fichier…");
          const id = crypto.randomUUID();
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
          if (lyrics && S.hasV2) row.lyrics = lyrics;
        }
        msg("Publication…");
        const { error } = await sb.from("tracks").insert(row);
        if (error) { if (error.code === "23505") { msg("Cette chanson Suno est déjà sur Écrin.", "err"); return; } throw error; }
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
      if (t) { startQueue([t, ...S.all.filter(x => x.id !== t.id)], 0, false); openNP(); toast("Appuie sur lecture pour écouter « " + t.title + " »"); }
    }
  })();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
