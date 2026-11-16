/* DOZE Studio 1.1.0 : tableau de bord réservé à l'administrateur */
(() => {
  "use strict";
  const CFG = window.ECRIN_CONFIG || {}, K = CFG.supabaseAnonKey;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("fr-FR"), nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const fmt = n => nf.format(n || 0);
  const short = n => n >= 1e6 ? nf1.format(n / 1e6) + " M" : n >= 1e4 ? nf1.format(n / 1e3) + " k" : nf.format(n || 0);
  const day = d => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const ago = d => { const s = (Date.now() - new Date(d)) / 1000; return s < 3600 ? `il y a ${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `il y a ${Math.round(s / 3600)} h` : s < 86400 * 30 ? `il y a ${Math.round(s / 86400)} j` : new Date(d).toLocaleDateString("fr-FR"); };
  const regions = (() => { try { return new Intl.DisplayNames(["fr"], { type: "region" }); } catch { return null; } })();
  const flag = c => /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map(x => 0x1F1E6 + x.charCodeAt(0) - 65)) : "🌍";
  const country = c => /^[A-Z]{2}$/.test(c) ? (regions ? regions.of(c) : c) : "Inconnu";
  const SRC = { suno: "Suno", upload: "Fichier audio", soundcloud: "SoundCloud", youtube: "YouTube" };
  const st = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };

  // Icônes (traits simples, couleur du texte)
  const P = {
    plays: "M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9",
    listeners: "M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6m0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13m8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5",
    likes: "M12 21 10.6 19.7C5.4 15 2 11.9 2 8.1 2 5 4.4 2.6 7.5 2.6c1.7 0 3.4.8 4.5 2.1a6 6 0 0 1 4.5-2.1C19.6 2.6 22 5 22 8.1c0 3.8-3.4 6.9-8.6 11.6z",
    users: "M15 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8m-9-2V7H4v3H1v2h3v3h2v-3h3v-2zm9 4c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4",
    tracks: "M12 3v10.6A4 4 0 1 0 14 17V7h4V3z",
    artists: "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3m5.3-3A5.3 5.3 0 0 1 12 16.1 5.3 5.3 0 0 1 6.7 11H5c0 3.4 2.7 6.2 6 6.7V21h2v-3.3c3.3-.5 6-3.3 6-6.7z",
    chart: "M3 13h2v8H3zm4-6h2v14H7zm4 3h2v11h-2zm4-7h2v18h-2zm4 9h2v9h-2z",
    trophy: "M19 4h-2V2H7v2H5a2 2 0 0 0-2 2v1a5 5 0 0 0 4.4 5A5 5 0 0 0 11 15.9V19H7v2h10v-2h-4v-3.1a5 5 0 0 0 3.6-3.9A5 5 0 0 0 21 7V6a2 2 0 0 0-2-2M5 7V6h2v4a3 3 0 0 1-2-3m14 0a3 3 0 0 1-2 3V6h2z",
    globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8M12 4a14 14 0 0 1 1.9 4h-3.8A14 14 0 0 1 12 4M4.3 14a8 8 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16m3-8h-3a8 8 0 0 1 4.3-3.6A15.7 15.7 0 0 0 8.1 8M12 20a14 14 0 0 1-1.9-4h3.8A14 14 0 0 1 12 20m2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4m.3 5.6a15.7 15.7 0 0 0 1.4-3.6h3a8 8 0 0 1-4.4 3.6m1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8 8 0 0 1 0 4z",
    source: "M4 6H2v14a2 2 0 0 0 2 2h14v-2H4zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2m-2 5h-3v5.5a2.5 2.5 0 1 1-2.5-2.5c.6 0 1.1.2 1.5.5V5h4z",
    shield: "M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5zm-1 6h2v6h-2zm0 8h2v2h-2z",
    new: "M12 2 9.2 8.6 2 9.2l5.5 4.7L5.8 21 12 17.3l6.2 3.7-1.7-7.1L22 9.2l-7.2-.6z",
    clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16m.5-13H11v6l5.2 3.2.8-1.2-4.5-2.7z",
    star: "M12 17.3 18.2 21l-1.7-7.1L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2l5.5 4.7L5.8 21z",
    rocket: "M12 2.5S6.5 6 6.5 13l-2.5 3 1 4 3-1.5h8L19 20l1-4-2.5-3c0-7-5.5-10.5-5.5-10.5M12 13a2 2 0 1 1 0-4 2 2 0 0 1 0 4"
  };
  const ic = k => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${P[k]}"/></svg>`;
  const head = (icon, title, sub, right = "") => `<div class="sec-h"><div class="ttl"><span class="badge-ic">${ic(icon)}</span><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div></div>${right}</div>`;

  const S = { key: st.get("doze.studio.key", null) || st.get("ecrin.admin", null), days: st.get("doze.studio.days", 30), data: null, rev: null, metric: st.get("doze.studio.metric", "plays"), top: "top_plays", tables: {}, shown: {}, first: true };

  function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2600); }
  async function rpc(fn, body) {
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((j && j.message) || "HTTP " + r.status); e.status = r.status; e.code = j && j.code; throw e; }
    return j;
  }

  // ---------- Connexion ----------
  function loginView(msg = "") {
    $("top-actions").hidden = true; $("live").hidden = true;
    $("app").innerHTML = `<form class="login" id="login" autocomplete="off">
      <img class="logo-big" src="icon-180.png" alt="">
      <h1>DOZE Studio</h1>
      <p>Ton outil de pilotage. Saisis ta <b>clé administrateur</b> pour voir les statistiques de DOZE.</p>
      <input type="password" id="k" placeholder="Clé administrateur" autocomplete="off" spellcheck="false" aria-label="Clé administrateur">
      <label class="ck"><input type="checkbox" id="rem" checked> Rester connecté sur cet appareil</label>
      <p class="msg" id="msg" role="status">${esc(msg)}</p>
      <button class="btn gold" type="submit">Ouvrir le Studio</button>
      <p style="font-size:12px">Ne partage jamais cette clé : elle permet de supprimer des titres.</p>
    </form>`;
    $("login").onsubmit = async e => {
      e.preventDefault();
      const k = $("k").value.trim();
      if (!/^[0-9a-f-]{36}$/i.test(k)) { $("msg").textContent = "Format de clé invalide."; return; }
      $("msg").textContent = "Vérification…";
      try {
        const ok = await rpc("is_admin", { p_key: k });
        if (ok !== true) { $("msg").textContent = "Clé refusée."; return; }
        S.key = k; if ($("rem").checked) st.set("doze.studio.key", k);
        load();
      } catch { $("msg").textContent = "Connexion impossible. Vérifie ta connexion internet."; }
    };
  }

  // ---------- Chargement ----------
  let busy = false;
  async function load(quiet) {
    if (!S.key) { loginView(); return; }
    if (busy) return; busy = true; $("refresh").classList.add("spin");
    if (!S.data && !quiet) $("app").innerHTML = `<div class="empty">Chargement des statistiques…</div>`;
    try {
      const [d, rv] = await Promise.all([rpc("admin_stats", { p_key: S.key, p_days: S.days }), rpc("reviews_summary", {}).catch(() => null)]);
      if (d === null) { st.del("doze.studio.key"); S.key = null; loginView("Cette clé n'est plus valide."); return; }
      S.data = d; S.rev = rv; render();
    } catch (e) {
      if (e.status === 404 || e.code === "PGRST202") $("app").innerHTML = `<div class="login"><h1>Une étape avant d'ouvrir le Studio</h1><div class="note">Lance la mise à jour <code>supabase/migration-8.sql</code> dans Supabase › SQL Editor › New query › Run, puis actualise cette page.</div><button class="btn gold" type="button" onclick="location.reload()">Actualiser</button></div>`;
      else if (!S.data) $("app").innerHTML = `<div class="empty">Impossible de charger les statistiques.<br><br><button class="btn" type="button" onclick="location.reload()">Réessayer</button></div>`;
      else toast("Actualisation impossible pour le moment");
    } finally { busy = false; $("refresh").classList.remove("spin"); }
  }

  // ---------- Composants ----------
  function delta(cur, prev) {
    if (!prev && !cur) return `<span class="pill flat">= stable</span>`;
    if (!prev) return `<span class="pill up">▲ nouveau</span>`;
    const p = Math.round((cur - prev) / prev * 100);
    return p > 0 ? `<span class="pill up">▲ ${p} %</span>` : p < 0 ? `<span class="pill down">▼ ${-p} %</span>` : `<span class="pill flat">= stable</span>`;
  }
  function spark(key) {
    const v = (S.data.daily || []).map(r => +r[key] || 0); if (v.length < 2) return "";
    const mx = Math.max(...v, 1), W = 100, H = 30, n = v.length;
    const pts = v.map((x, i) => `${(i / (n - 1) * W).toFixed(2)},${(H - 3 - x / mx * (H - 8)).toFixed(2)}`);
    const id = "sp" + key;
    return `<div class="spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DA9A68" stop-opacity=".35"/><stop offset="1" stop-color="#DA9A68" stop-opacity="0"/></linearGradient></defs>
      <path d="M0,${H} L${pts.join(" L")} L${W},${H} Z" fill="url(#${id})"/><polyline points="${pts.join(" ")}" fill="none" stroke="#F0BE92" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg></div>`;
  }
  // Chiffres qui défilent jusqu'à leur valeur (seulement s'ils changent)
  const count = (key, n) => `<span class="val" data-count="${key}" data-n="${n}">${fmt(n)}</span>`;
  function animateCounts() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll("[data-count]").forEach(el => {
      const k = el.dataset.count, to = +el.dataset.n, from = S.shown[k] ?? 0; S.shown[k] = to;
      if (from === to) return;
      const t0 = performance.now(), dur = 900;
      const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  const kpi = (icon, lab, key, n, sub, hero, sp) => `<div class="kpi${hero ? " hero-k" : ""}"><span class="kh"><i>${ic(icon)}</i>${lab}</span>${count(key, n)}${sub ? `<span class="sub">${sub}</span>` : ""}${sp ? spark(sp) : ""}</div>`;
  const per = () => S.days === 365 ? "sur 1 an" : `sur ${S.days} jours`;
  const cover = t => t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" loading="lazy">` : `<span class="ph">♪</span>`;
  const trackLink = t => `<a href="../?t=${esc(t.id)}" target="_blank" rel="noopener">${esc(t.title)}</a>`;
  const stars = (r, size) => `<span class="stars" ${size ? `style="font-size:${size}px"` : ""} aria-label="${nf1.format(r)} sur 5">★★★★★<b style="width:${Math.max(0, Math.min(5, r)) / 5 * 100}%">★★★★★</b></span>`;
  const rankBadge = i => `<span class="rk${i < 3 ? " r" + (i + 1) : ""}">${i + 1}</span>`;

  function barList(items, opts) {
    if (!items.length) return `<p class="none">${opts.empty}</p>`;
    const mx = Math.max(...items.map(x => +x.n)) || 1;
    return `<ol class="bars">${items.map((x, i) => `<li class="bar${opts.simple ? " simple" : ""}" title="${esc(opts.title(x))} : ${fmt(x.n)} ${opts.unit}">
      ${opts.simple ? `<span class="rk emo">${opts.icon(x)}</span>` : rankBadge(i) + cover(x)}
      <span class="tx"><span class="t1">${opts.label(x)}</span>${opts.sub ? `<span class="t2">${opts.sub(x)}</span>` : ""}<span class="track"><span class="fill" style="width:${Math.max(3, x.n / mx * 100)}%"></span></span></span>
      <span class="n">${short(+x.n)}${opts.nsub ? `<small>${opts.nsub}</small>` : ""}</span></li>`).join("")}</ol>`;
  }

  const METRICS = { plays: ["Écoutes", "écoutes"], listeners: ["Auditeurs", "auditeurs uniques"], likes: ["Coups de cœur", "coups de cœur"], users: ["Nouveaux comptes", "inscriptions"], tracks: ["Nouveaux titres", "titres publiés"] };
  const hello = () => { const h = new Date().getHours(); return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; };

  // ---------- Rendu ----------
  function render() {
    const d = S.data, T = d.totals, P2 = d.period;
    $("top-actions").hidden = false; $("live").hidden = false;
    document.querySelectorAll("#period button").forEach(b => b.classList.toggle("is-on", +b.dataset.days === S.days));
    const topSets = { top_plays: ["Plus écoutés", d.top_plays, "écoutes", "Aucune écoute sur la période."], top_likes: ["Plus aimés", d.top_likes, "cœurs", "Aucun coup de cœur sur la période."], top_all: ["Depuis le début", d.top_all, "écoutes", "Aucun titre."] };
    const [, topList, topUnit, topEmpty] = topSets[S.top];
    const reportedOpen = d.reported.filter(x => !x.hidden).length;
    const dist = S.rev && S.rev.dist ? S.rev.dist : null, nRev = T.reviews || 0;
    const y = window.scrollY;
    $("app").className = S.first ? "intro" : "";
    $("app").innerHTML = `
      <section class="hero">
        <span class="hello">${hello()} 👋</span>
        <h1>${P2.plays ? `<em>${fmt(P2.plays)}</em> écoutes ${per()}` : `Prêt pour les premières écoutes`}</h1>
        <p>${fmt(P2.listeners)} auditeurs uniques · ${fmt(P2.likes)} coups de cœur · ${fmt(P2.users)} nouveaux comptes${P2.artists ? ` · ${fmt(P2.artists)} nouvel${P2.artists > 1 ? "s" : ""} artiste${P2.artists > 1 ? "s" : ""}` : ""}</p>
        <div class="stamp">${ic("clock").replace("<svg", '<svg width="14" height="14"')} Mis à jour à ${new Date(d.generated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · actualisation automatique chaque minute</div>
      </section>

      <section class="kpis" aria-label="Indicateurs de la période">
        ${kpi("plays", "Écoutes", "p_plays", P2.plays, delta(P2.plays, P2.plays_prev), true, "plays")}
        ${kpi("listeners", "Auditeurs uniques", "p_list", P2.listeners, delta(P2.listeners, P2.listeners_prev), true, "listeners")}
        ${kpi("likes", "Coups de cœur", "p_likes", P2.likes, delta(P2.likes, P2.likes_prev), false, "likes")}
        ${kpi("users", "Nouveaux comptes", "p_users", P2.users, delta(P2.users, P2.users_prev), false, "users")}
        ${kpi("tracks", "Nouveaux titres", "p_tracks", P2.tracks, delta(P2.tracks, P2.tracks_prev), false, "tracks")}
        ${kpi("artists", "Nouveaux artistes", "p_art", P2.artists, delta(P2.artists, P2.artists_prev), false)}
      </section>

      <section class="sec card">
        ${head("chart", "Évolution jour par jour", `${METRICS[S.metric][0]} ${per()}`)}
        <div class="chips" role="group" aria-label="Indicateur affiché">${Object.entries(METRICS).map(([k, [n]]) => `<button class="chip${S.metric === k ? " is-on" : ""}" type="button" data-metric="${k}">${n}</button>`).join("")}</div>
        <div class="chart" id="chart" role="img" aria-label="${METRICS[S.metric][0]} par jour"></div>
        <div class="chart-sum" id="chart-sum"></div>
        <button class="table-toggle" type="button" data-table="daily">${S.tables.daily ? "Masquer le tableau" : "Voir en tableau"}</button>
        ${S.tables.daily ? `<div class="tscroll"><table class="data"><thead><tr><th>Jour</th><th>Écoutes</th><th>Auditeurs</th><th>Cœurs</th><th>Comptes</th><th>Titres</th></tr></thead><tbody>${d.daily.slice().reverse().map(r => `<tr><td>${day(r.day)}</td><td>${fmt(r.plays)}</td><td>${fmt(r.listeners)}</td><td>${fmt(r.likes)}</td><td>${fmt(r.users)}</td><td>${fmt(r.tracks)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      </section>

      <section class="sec">
        ${head("rocket", "Depuis le lancement", "Les chiffres cumulés de DOZE")}
        <div class="mini">
          ${kpi("users", "Utilisateurs inscrits", "t_users", T.users, `${fmt(T.newsletter)} abonnés newsletter`)}
          ${kpi("listeners", "Auditeurs (appareils)", "t_list", Math.max(T.listeners, T.like_devices), "écoute ou coup de cœur")}
          ${kpi("tracks", "Titres en ligne", "t_tracks", T.tracks, T.hidden ? `${fmt(T.hidden)} masqué${T.hidden > 1 ? "s" : ""}` : "aucun masqué")}
          ${kpi("artists", "Artistes", "t_art", T.artists, "")}
          ${kpi("plays", "Écoutes totales", "t_plays", T.plays, "")}
          ${kpi("likes", "Coups de cœur", "t_likes", T.likes, "")}
          ${kpi("source", "Playlists", "t_pl", T.playlists, "")}
          ${kpi("shield", "Signalements", "t_rep", T.reports, `${fmt(T.reported_tracks)} titre${T.reported_tracks > 1 ? "s" : ""} concerné${T.reported_tracks > 1 ? "s" : ""}`)}
        </div></section>

      <div class="grid2 sec">
        <section class="card">${head("trophy", "Top titres", S.top === "top_all" ? "Écoutes cumulées" : per(), `<div class="chips">${Object.entries(topSets).map(([k, [n]]) => `<button class="chip${S.top === k ? " is-on" : ""}" type="button" data-top="${k}">${n}</button>`).join("")}</div>`)}
          ${barList(topList, { empty: topEmpty, unit: topUnit, nsub: topUnit, title: x => x.title, label: trackLink, sub: x => esc(x.artist) + (x.likes ? ` · ${fmt(x.likes)} ♥` : "") })}</section>
        <section class="card">${head("new", "Nouveaux artistes", `Premier titre publié ${per()}`)}
          ${d.new_artists.length ? `<ol class="bars">${d.new_artists.map(a => `<li class="bar simple"><span class="rk emo">🎤</span><span class="tx"><span class="t1">${esc(a.name)}</span><span class="t2">${ago(a.first_at)} · ${fmt(a.n)} titre${a.n > 1 ? "s" : ""}</span></span><span class="n">${short(+a.plays)}<small>écoutes</small></span></li>`).join("")}</ol>` : `<p class="none">Aucun nouvel artiste sur la période.</p>`}</section>
      </div>

      <div class="grid2 sec">
        <section class="card">${head("globe", "Pays des auditeurs", `Écoutes ${per()}`)}
          ${barList(d.countries, { simple: true, empty: "Pas encore de données.", unit: "écoutes", icon: x => flag(x.country), title: x => country(x.country), label: x => esc(country(x.country)) })}</section>
        <section class="card">${head("source", "Origine des titres", "Titres en ligne par source")}
          ${barList(d.sources.map(x => ({ ...x, n: +x.n })), { simple: true, empty: "Aucun titre.", unit: "titres", icon: x => ({ suno: "✨", upload: "🎵", soundcloud: "☁️", youtube: "▶️" }[x.source] || "♪"), title: x => SRC[x.source] || x.source, label: x => esc(SRC[x.source] || x.source) })}</section>
      </div>

      <section class="sec card">${head("shield", "Signalements et modération", `${reportedOpen ? `${reportedOpen} titre${reportedOpen > 1 ? "s" : ""} signalé${reportedOpen > 1 ? "s" : ""} encore visible${reportedOpen > 1 ? "s" : ""}` : "Rien à traiter"} · masquage automatique à 5 signalements`)}
        ${d.reported.length ? d.reported.map(t => `<div class="mod">${cover(t)}<div class="tx"><div class="t1"><b>${trackLink(t)}</b>${t.hidden ? `<span class="badge">Masqué</span>` : `<span class="badge">${t.reports} signalement${t.reports > 1 ? "s" : ""}</span>`}</div><small style="color:var(--muted)">${esc(t.artist)} · ${esc(SRC[t.source] || t.source)} · publié ${ago(t.created_at)}</small></div>
          <div class="acts">${t.hidden ? `<button class="btn" type="button" data-hide="${t.id}" data-v="0">Rétablir</button>` : `<button class="btn" type="button" data-hide="${t.id}" data-v="1">Masquer</button><button class="btn" type="button" data-hide="${t.id}" data-v="0">Ignorer</button>`}<button class="btn danger" type="button" data-del="${t.id}" data-title="${esc(t.title)}">Supprimer</button></div></div>`).join("") : `<div class="ok-state">✓ Aucun signalement, tout est propre.</div>`}
      </section>

      <div class="grid2 sec">
        <section class="card">${head("tracks", "Derniers titres publiés", "")}
          <ol class="bars">${d.latest_tracks.map(t => `<li class="bar simple" style="grid-template-columns:42px minmax(0,1fr) auto">${cover(t)}<span class="tx"><span class="t1">${trackLink(t)}</span><span class="t2">${esc(t.artist)}${t.username ? ` · compte « ${esc(t.username)} »` : ""} · ${esc(SRC[t.source] || t.source)}</span></span><span class="t2" style="color:var(--muted);font-size:11.5px">${ago(t.created_at)}</span></li>`).join("")}</ol></section>
        <section class="card">${head("users", "Derniers inscrits", `${fmt(T.users)} comptes au total`)}
          ${d.latest_users.length ? `<ol class="bars">${d.latest_users.map(u => `<li class="bar simple"><span class="rk emo">👤</span><span class="tx"><span class="t1">${esc(u.username || "(sans pseudo)")}</span><span class="t2">${ago(u.created_at)} · ${fmt(u.tracks)} titre${u.tracks > 1 ? "s" : ""}${u.newsletter ? " · newsletter ✓" : ""}</span></span><span></span></li>`).join("")}</ol>` : `<p class="none">Aucun compte pour l'instant.</p>`}</section>
      </div>

      <section class="sec card">${head("star", "Avis sur l'appli", nRev ? `${fmt(nRev)} avis` : "Aucun avis pour l'instant")}
        ${nRev ? `<div class="rating"><div class="big"><strong>${nf1.format(T.rating)}</strong>${stars(T.rating, 18)}<small>${fmt(nRev)} avis</small></div>
          <div class="dist">${dist ? [5, 4, 3, 2, 1].map(s => { const c = dist[s - 1] || 0; return `<div><span>${s} ★</span><span class="tr"><i style="width:${nRev ? c / nRev * 100 : 0}%"></i></span><span>${fmt(c)}</span></div>`; }).join("") : ""}</div></div>` : ""}
        ${d.reviews.length ? d.reviews.map(r => `<div class="rev"><div class="who"><span class="av">${esc((r.author || "?")[0].toUpperCase())}</span><div><b>${esc(r.author)}</b> ${stars(r.rating, 13)}<br><small>${ago(r.created_at)}</small></div>${r.hidden ? `<span class="badge">Masqué</span>` : ""}</div>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}${r.hidden ? "" : `<button class="btn" type="button" data-hide-review="${r.id}">Masquer cet avis</button>`}</div>`).join("") : `<p class="none">Les avis laissés dans DOZE apparaîtront ici.</p>`}
      </section>`;
    if (!S.first) window.scrollTo(0, y);
    S.first = false;
    drawChart(); animateCounts();
  }

  // ---------- Graphique (une série, survol avec réticule) ----------
  function niceMax(v) { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function drawChart() {
    const el = $("chart"); if (!el || !S.data) return;
    const rows = S.data.daily, key = S.metric, vals = rows.map(r => +r[key] || 0);
    const W = el.clientWidth, H = el.clientHeight, L = 34, R = 12, Tp = 12, B = 24, w = W - L - R, h = H - Tp - B;
    const mx = niceMax(Math.max(...vals, 1)), n = vals.length;
    const X = i => L + (n === 1 ? w / 2 : i / (n - 1) * w), Y = v => Tp + h - v / mx * h;
    const ticks = [0, .25, .5, .75, 1].map(f => Math.round(mx * f));
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 72))));
    // courbe lissée (Catmull-Rom → Bézier), sans dépasser les vraies valeurs de trop
    const pts = vals.map((v, i) => [X(i), Y(v)]);
    let line = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = .18;
      const c1 = [p1[0] + (p2[0] - p0[0]) * t, Math.min(Tp + h, p1[1] + (p2[1] - p0[1]) * t)], c2 = [p2[0] - (p3[0] - p1[0]) * t, Math.min(Tp + h, p2[1] - (p3[1] - p1[1]) * t)];
      line += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DA9A68" stop-opacity=".38"/><stop offset=".7" stop-color="#3F5FB2" stop-opacity=".08"/><stop offset="1" stop-color="#3F5FB2" stop-opacity="0"/></linearGradient>
        <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B06C3E"/><stop offset=".5" stop-color="#F0BE92"/><stop offset="1" stop-color="#FFD9B0"/></linearGradient></defs>
      ${ticks.map(t => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${short(t)}</text>`).join("")}
      ${rows.map((r, i) => (i % step === 0 && n - 1 - i >= step * .85) || i === n - 1 ? `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${day(r.day)}</text>` : "").join("")}
      <path d="${line} L${X(n - 1)},${Y(0)} L${X(0)},${Y(0)} Z" fill="url(#ga)"/>
      <path class="ln" d="${line}"/>
      <circle cx="${X(n - 1)}" cy="${Y(vals[n - 1])}" r="4" fill="#FFD9B0"/>
      <line class="cross" id="cross" y1="${Tp}" y2="${Tp + h}" visibility="hidden"/>
      <circle class="dot" id="cdot" r="6" visibility="hidden"/>
    </svg>`;
    const total = vals.reduce((a, b) => a + b, 0), best = vals.indexOf(Math.max(...vals));
    $("chart-sum").innerHTML = `<span>Total <b>${fmt(total)}</b></span><span>Moyenne <b>${nf1.format(total / n)}</b> / jour</span>${total ? `<span>Record <b>${fmt(vals[best])}</b> · ${day(rows[best].day)}</span>` : ""}`;
    const tip = $("tip"), cross = el.querySelector("#cross"), dot = el.querySelector("#cdot");
    const move = e => {
      const r = el.getBoundingClientRect(), x = e.clientX - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round((x - L) / (w || 1) * (n - 1))));
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(vals[i])); dot.setAttribute("visibility", "visible");
      tip.innerHTML = `<span>${new Date(rows[i].day + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span><b>${fmt(vals[i])}</b><span>${METRICS[key][1]}</span>`;
      tip.hidden = false;
      const tx = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + X(i) - tip.offsetWidth / 2));
      tip.style.left = tx + "px"; tip.style.top = Math.max(8, r.top + Y(vals[i]) - tip.offsetHeight - 16) + "px";
    };
    const leave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
    el.onpointermove = move; el.onpointerdown = move; el.onpointerleave = leave; el.onpointerup = e => { if (e.pointerType !== "mouse") setTimeout(leave, 1600); };
  }
  addEventListener("resize", () => { clearTimeout(drawChart.t); drawChart.t = setTimeout(drawChart, 120); });
  addEventListener("scroll", () => { $("tip").hidden = true; }, { passive: true });

  // ---------- Actions ----------
  document.addEventListener("click", async e => {
    const m = e.target.closest("[data-metric]"); if (m) { S.metric = m.dataset.metric; st.set("doze.studio.metric", S.metric); render(); return; }
    const tp = e.target.closest("[data-top]"); if (tp) { S.top = tp.dataset.top; render(); return; }
    const tb = e.target.closest("[data-table]"); if (tb) { S.tables[tb.dataset.table] = !S.tables[tb.dataset.table]; render(); return; }
    const pd = e.target.closest("#period button"); if (pd) { S.days = +pd.dataset.days; st.set("doze.studio.days", S.days); load(true); return; }
    if (e.target.closest("#refresh")) { load(true); return; }
    if (e.target.closest("#logout")) { if (confirm("Te déconnecter du Studio sur cet appareil ?")) { st.del("doze.studio.key"); S.key = null; S.data = null; S.first = true; loginView(); } return; }
    const hd = e.target.closest("[data-hide]");
    if (hd) {
      const on = hd.dataset.v === "1";
      try { const ok = await rpc("admin_set_hidden", { p_id: hd.dataset.hide, p_key: S.key, p_hidden: on }); toast(ok ? (on ? "Titre masqué" : "Titre rétabli, signalements remis à zéro") : "Action refusée"); load(true); }
      catch { toast("Action impossible pour le moment"); }
      return;
    }
    const dl = e.target.closest("[data-del]");
    if (dl) {
      if (!confirm(`Supprimer définitivement « ${dl.dataset.title} » ? Cette action est irréversible.`)) return;
      try { const ok = await rpc("admin_delete_track", { p_id: dl.dataset.del, p_key: S.key }); toast(ok ? "Titre supprimé" : "Suppression refusée"); load(true); } catch { toast("Suppression impossible"); }
      return;
    }
    const hr = e.target.closest("[data-hide-review]");
    if (hr) { try { const ok = await rpc("admin_hide_review", { p_id: hr.dataset.hideReview, p_key: S.key }); toast(ok ? "Avis masqué" : "Action refusée"); load(true); } catch { toast("Action impossible"); } }
  });

  setInterval(() => { if (!document.hidden && S.key && S.data) load(true); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.key && S.data) load(true); });
  load();
})();
