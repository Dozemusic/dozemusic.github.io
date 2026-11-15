/* DOZE Studio 1.0.0 : tableau de bord réservé à l'administrateur */
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

  const S = { key: st.get("doze.studio.key", null) || st.get("ecrin.admin", null), days: st.get("doze.studio.days", 30), data: null, metric: st.get("doze.studio.metric", "plays"), top: "top_plays", tables: {} };

  function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 2600); }
  async function rpc(fn, body) {
    const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: K, Authorization: "Bearer " + K, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error((j && j.message) || "HTTP " + r.status); e.status = r.status; e.code = j && j.code; throw e; }
    return j;
  }

  // ---------- Connexion ----------
  function loginView(msg = "") {
    $("top-actions").hidden = true;
    $("app").innerHTML = `<form class="login" id="login" autocomplete="off">
      <h1>Accès au Studio</h1>
      <p>Les statistiques de DOZE sont réservées à l'administrateur. Saisis ta <b>clé administrateur</b> (celle obtenue dans Supabase lors de la mise à jour 4).</p>
      <input type="password" id="k" placeholder="Clé administrateur" autocomplete="off" spellcheck="false" aria-label="Clé administrateur">
      <label class="ck"><input type="checkbox" id="rem" checked> Rester connecté sur cet appareil</label>
      <p class="msg" id="msg" role="status">${esc(msg)}</p>
      <button class="btn gold" type="submit">Ouvrir le Studio</button>
      <p>Ne partage jamais cette clé : elle permet de supprimer des titres.</p>
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
      const d = await rpc("admin_stats", { p_key: S.key, p_days: S.days });
      if (d === null) { st.del("doze.studio.key"); S.key = null; loginView("Cette clé n'est plus valide."); return; }
      S.data = d; render();
    } catch (e) {
      if (e.status === 404 || e.code === "PGRST202") $("app").innerHTML = `<div class="login"><h1>Une étape avant d'ouvrir le Studio</h1><div class="note">Lance la mise à jour <code>supabase/migration-8.sql</code> dans Supabase › SQL Editor › New query › Run, puis actualise cette page.</div><button class="btn gold" type="button" onclick="location.reload()">Actualiser</button></div>`;
      else if (!S.data) $("app").innerHTML = `<div class="empty">Impossible de charger les statistiques.<br><button class="btn" type="button" onclick="location.reload()">Réessayer</button></div>`;
      else toast("Actualisation impossible pour le moment");
    } finally { busy = false; $("refresh").classList.remove("spin"); }
  }

  // ---------- Rendu ----------
  function delta(cur, prev) {
    if (!prev && !cur) return `<span class="delta flat">— stable</span>`;
    if (!prev) return `<span class="delta up">▲ nouveau</span>`;
    const p = Math.round((cur - prev) / prev * 100);
    return p > 0 ? `<span class="delta up">▲ +${p} %</span>` : p < 0 ? `<span class="delta down">▼ ${p} %</span>` : `<span class="delta flat">= stable</span>`;
  }
  const kpi = (lab, val, sub, hero) => `<div class="kpi${hero ? " hero" : ""}"><span class="lab">${lab}</span><span class="val">${val}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
  const per = () => S.days === 365 ? "sur 1 an" : `sur ${S.days} jours`;
  const vsPrev = "vs période précédente";
  const cover = t => t.cover_url ? `<img src="${esc(t.cover_url)}" alt="" loading="lazy">` : `<span class="ph">♪</span>`;
  const trackLink = t => `<a href="../?t=${esc(t.id)}" target="_blank" rel="noopener">${esc(t.title)}</a>`;

  function barList(items, opts) {
    if (!items.length) return `<p class="none">${opts.empty}</p>`;
    const mx = Math.max(...items.map(x => x.n)) || 1;
    return `<ol class="bars">${items.map((x, i) => `<li class="bar${opts.simple ? " simple" : ""}" title="${esc(opts.title(x))} : ${fmt(x.n)} ${opts.unit}">
      <span class="rk">${opts.simple ? opts.icon(x) : i + 1}</span>${opts.simple ? "" : cover(x)}
      <span class="tx"><span class="t1">${opts.label(x)}</span>${opts.sub ? `<span class="t2">${opts.sub(x)}</span>` : ""}<span class="track"><span class="fill" style="width:${Math.max(2, x.n / mx * 100)}%"></span></span></span>
      <span class="n">${short(x.n)}</span></li>`).join("")}</ol>`;
  }

  const METRICS = { plays: ["Écoutes", "écoutes"], listeners: ["Auditeurs", "auditeurs uniques"], likes: ["Coups de cœur", "coups de cœur"], users: ["Nouveaux comptes", "inscriptions"], tracks: ["Nouveaux titres", "titres publiés"] };

  function render() {
    const d = S.data, T = d.totals, P = d.period;
    $("top-actions").hidden = false;
    document.querySelectorAll("#period button").forEach(b => b.classList.toggle("is-on", +b.dataset.days === S.days));
    const topSets = { top_plays: ["Plus écoutés", d.top_plays, "écoutes", "Aucune écoute sur la période."], top_likes: ["Plus aimés", d.top_likes, "coups de cœur", "Aucun coup de cœur sur la période."], top_all: ["Depuis le début", d.top_all, "écoutes", "Aucun titre."] };
    const [, topList, topUnit, topEmpty] = topSets[S.top];
    const reportedOpen = d.reported.filter(x => !x.hidden).length;
    $("app").innerHTML = `
      <p class="stamp">Mis à jour ${new Date(d.generated_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · période : ${per()} · actualisation automatique chaque minute</p>
      <section class="kpis" aria-label="Indicateurs de la période">
        ${kpi("Écoutes", fmt(P.plays), `${delta(P.plays, P.plays_prev)} ${vsPrev}`, true)}
        ${kpi("Auditeurs uniques", fmt(P.listeners), `${delta(P.listeners, P.listeners_prev)} · appareils distincts`, true)}
        ${kpi("Coups de cœur", fmt(P.likes), `${delta(P.likes, P.likes_prev)} ${vsPrev}`)}
        ${kpi("Nouveaux comptes", fmt(P.users), `${delta(P.users, P.users_prev)} ${vsPrev}`)}
        ${kpi("Nouveaux titres", fmt(P.tracks), `${delta(P.tracks, P.tracks_prev)} ${vsPrev}`)}
        ${kpi("Nouveaux artistes", fmt(P.artists), `${delta(P.artists, P.artists_prev)} ${vsPrev}`)}
      </section>

      <section class="sec card">
        <div class="sec-h"><div><h2>Évolution jour par jour</h2><p>${METRICS[S.metric][0]} ${per()}</p></div>
          <div class="chips" role="group" aria-label="Indicateur affiché">${Object.entries(METRICS).map(([k, [n]]) => `<button class="chip${S.metric === k ? " is-on" : ""}" type="button" data-metric="${k}">${n}</button>`).join("")}</div></div>
        <div class="chart" id="chart" role="img" aria-label="${METRICS[S.metric][0]} par jour"></div>
        <div class="chart-sum" id="chart-sum"></div>
        <button class="table-toggle" type="button" data-table="daily">${S.tables.daily ? "Masquer le tableau" : "Voir en tableau"}</button>
        ${S.tables.daily ? `<div class="tscroll"><table class="data"><thead><tr><th>Jour</th><th>Écoutes</th><th>Auditeurs</th><th>Cœurs</th><th>Comptes</th><th>Titres</th></tr></thead><tbody>${d.daily.slice().reverse().map(r => `<tr><td>${day(r.day)}</td><td>${fmt(r.plays)}</td><td>${fmt(r.listeners)}</td><td>${fmt(r.likes)}</td><td>${fmt(r.users)}</td><td>${fmt(r.tracks)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      </section>

      <section class="sec"><div class="sec-h"><div><h2>Depuis le lancement</h2></div></div>
        <div class="mini">
          ${kpi("Utilisateurs inscrits", fmt(T.users), `${fmt(T.newsletter)} abonnés newsletter`)}
          ${kpi("Auditeurs (appareils)", fmt(Math.max(T.listeners, T.like_devices)), "écoute ou coup de cœur")}
          ${kpi("Titres en ligne", fmt(T.tracks), T.hidden ? `${fmt(T.hidden)} masqué${T.hidden > 1 ? "s" : ""}` : "aucun masqué")}
          ${kpi("Artistes", fmt(T.artists), "")}
          ${kpi("Écoutes totales", fmt(T.plays), "")}
          ${kpi("Coups de cœur", fmt(T.likes), "")}
          ${kpi("Playlists", fmt(T.playlists), "")}
          ${kpi("Note de l'appli", T.rating ? `${nf1.format(T.rating)} ★` : "—", `${fmt(T.reviews)} avis`)}
          ${kpi("Signalements", fmt(T.reports), `${fmt(T.reported_tracks)} titres concernés`)}
        </div></section>

      <div class="grid2 sec">
        <section class="card"><div class="sec-h"><div><h2>Top titres</h2><p>${S.top === "top_all" ? "Écoutes cumulées" : per()}</p></div>
          <div class="chips">${Object.entries(topSets).map(([k, [n]]) => `<button class="chip${S.top === k ? " is-on" : ""}" type="button" data-top="${k}">${n}</button>`).join("")}</div></div>
          ${barList(topList, { empty: topEmpty, unit: topUnit, title: x => x.title, label: trackLink, sub: x => esc(x.artist) + (x.likes ? ` · ${fmt(x.likes)} ♥` : "") })}</section>
        <section class="card"><div class="sec-h"><div><h2>Nouveaux artistes</h2><p>Premier titre publié ${per()}</p></div></div>
          ${d.new_artists.length ? `<ol class="bars">${d.new_artists.map(a => `<li class="bar simple"><span class="rk">🎤</span><span class="tx"><span class="t1">${esc(a.name)}</span><span class="t2">${ago(a.first_at)} · ${fmt(a.n)} titre${a.n > 1 ? "s" : ""}</span></span><span class="n">${short(a.plays)} <small style="color:var(--muted);font-weight:500">écoutes</small></span></li>`).join("")}</ol>` : `<p class="none">Aucun nouvel artiste sur la période.</p>`}</section>
      </div>

      <div class="grid2 sec">
        <section class="card"><div class="sec-h"><div><h2>Pays des auditeurs</h2><p>Écoutes ${per()}</p></div></div>
          ${barList(d.countries, { simple: true, empty: "Pas encore de données.", unit: "écoutes", icon: x => flag(x.country), title: x => country(x.country), label: x => esc(country(x.country)) })}</section>
        <section class="card"><div class="sec-h"><div><h2>Origine des titres</h2><p>Titres en ligne par source</p></div></div>
          ${barList(d.sources.map(x => ({ ...x, n: +x.n })), { simple: true, empty: "Aucun titre.", unit: "titres", icon: x => ({ suno: "✨", upload: "🎵", soundcloud: "☁️", youtube: "▶️" }[x.source] || "♪"), title: x => SRC[x.source] || x.source, label: x => esc(SRC[x.source] || x.source) })}</section>
      </div>

      <section class="sec card"><div class="sec-h"><div><h2>Signalements et modération</h2><p>${reportedOpen ? `${reportedOpen} titre${reportedOpen > 1 ? "s" : ""} signalé${reportedOpen > 1 ? "s" : ""} encore visible${reportedOpen > 1 ? "s" : ""}` : "Rien à traiter pour le moment"} · un titre est masqué automatiquement à 5 signalements</p></div></div>
        ${d.reported.length ? d.reported.map(t => `<div class="mod">${cover(t)}<div class="tx"><div class="t1"><b>${trackLink(t)}</b>${t.hidden ? `<span class="badge">Masqué</span>` : `<span class="badge">${t.reports} signalement${t.reports > 1 ? "s" : ""}</span>`}</div><small style="color:var(--muted)">${esc(t.artist)} · ${esc(SRC[t.source] || t.source)} · publié ${ago(t.created_at)}</small></div>
          <div class="acts">${t.hidden ? `<button class="btn" type="button" data-hide="${t.id}" data-v="0">Rétablir</button>` : `<button class="btn" type="button" data-hide="${t.id}" data-v="1">Masquer</button><button class="btn" type="button" data-hide="${t.id}" data-v="0">Ignorer les signalements</button>`}<button class="btn danger" type="button" data-del="${t.id}" data-title="${esc(t.title)}">Supprimer</button></div></div>`).join("") : `<p class="none">Aucun signalement. 🎉</p>`}
      </section>

      <div class="grid2 sec">
        <section class="card"><div class="sec-h"><div><h2>Derniers titres publiés</h2></div></div>
          <ol class="bars">${d.latest_tracks.map(t => `<li class="bar simple" style="grid-template-columns:40px minmax(0,1fr) auto">${cover(t)}<span class="tx"><span class="t1">${trackLink(t)}</span><span class="t2">${esc(t.artist)}${t.username ? ` · compte « ${esc(t.username)} »` : ""} · ${esc(SRC[t.source] || t.source)}</span></span><span class="t2" style="color:var(--muted);font-size:12px">${ago(t.created_at)}</span></li>`).join("")}</ol></section>
        <section class="card"><div class="sec-h"><div><h2>Derniers inscrits</h2><p>${fmt(T.users)} comptes au total</p></div></div>
          ${d.latest_users.length ? `<ol class="bars">${d.latest_users.map(u => `<li class="bar simple"><span class="rk">👤</span><span class="tx"><span class="t1">${esc(u.username || "(sans pseudo)")}</span><span class="t2">${ago(u.created_at)} · ${fmt(u.tracks)} titre${u.tracks > 1 ? "s" : ""} publié${u.tracks > 1 ? "s" : ""}${u.newsletter ? " · newsletter ✓" : ""}</span></span><span></span></li>`).join("")}</ol>` : `<p class="none">Aucun compte pour l'instant.</p>`}</section>
      </div>

      <section class="sec card"><div class="sec-h"><div><h2>Avis sur l'appli</h2><p>${T.reviews ? `${nf1.format(T.rating)} ★ en moyenne sur ${fmt(T.reviews)} avis` : "Aucun avis pour l'instant"}</p></div></div>
        ${d.reviews.length ? d.reviews.map(r => `<div class="rev"><span class="st" aria-label="${r.rating} étoiles sur 5">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span> <b>${esc(r.author)}</b> <small>· ${ago(r.created_at)}</small>${r.hidden ? `<span class="badge">Masqué</span>` : ""}${r.comment ? `<p>${esc(r.comment)}</p>` : ""}${r.hidden ? "" : `<button class="btn" type="button" data-hide-review="${r.id}">Masquer cet avis</button>`}</div>`).join("") : `<p class="none">Les avis laissés dans DOZE apparaîtront ici.</p>`}
      </section>`;
    drawChart();
  }

  // ---------- Graphique (une série, survol avec réticule) ----------
  function niceMax(v) { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function drawChart() {
    const el = $("chart"); if (!el || !S.data) return;
    const rows = S.data.daily, key = S.metric, vals = rows.map(r => +r[key] || 0);
    const W = el.clientWidth, H = el.clientHeight, L = 34, R = 10, Tp = 10, B = 24, w = W - L - R, h = H - Tp - B;
    const mx = niceMax(Math.max(...vals, 1)), n = vals.length;
    const X = i => L + (n === 1 ? w / 2 : i / (n - 1) * w), Y = v => Tp + h - v / mx * h;
    const ticks = [0, .25, .5, .75, 1].map(f => Math.round(mx * f));
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));
    const line = vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DA9A68" stop-opacity=".32"/><stop offset="1" stop-color="#DA9A68" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map(t => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text class="ax" x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${short(t)}</text>`).join("")}
      ${rows.map((r, i) => (i % step === 0 && n - 1 - i >= step * .85) || i === n - 1 ? `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${day(r.day)}</text>` : "").join("")}
      <path d="${line}L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z" fill="url(#ga)"/>
      <path class="ln" d="${line}"/>
      <line class="cross" id="cross" y1="${Tp}" y2="${Tp + h}" visibility="hidden"/>
      <circle class="dot" id="cdot" r="5" visibility="hidden"/>
    </svg>`;
    const total = vals.reduce((a, b) => a + b, 0), best = vals.indexOf(Math.max(...vals));
    $("chart-sum").innerHTML = `<span>Total : <b>${fmt(total)}</b> ${METRICS[key][1]}</span><span>Moyenne : <b>${nf1.format(total / n)}</b> / jour</span>${total ? `<span>Record : <b>${fmt(vals[best])}</b> le ${day(rows[best].day)}</span>` : ""}`;
    const tip = $("tip"), cross = el.querySelector("#cross"), dot = el.querySelector("#cdot");
    const move = e => {
      const r = el.getBoundingClientRect(), x = e.clientX - r.left;
      const i = Math.max(0, Math.min(n - 1, Math.round((x - L) / (w || 1) * (n - 1))));
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(vals[i])); dot.setAttribute("visibility", "visible");
      tip.innerHTML = `<span>${new Date(rows[i].day + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span><b>${fmt(vals[i])}</b><span>${METRICS[key][1]}</span>`;
      tip.hidden = false;
      const tx = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + X(i) - tip.offsetWidth / 2));
      tip.style.left = tx + "px"; tip.style.top = Math.max(8, r.top + Y(vals[i]) - tip.offsetHeight - 14) + "px";
    };
    const leave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
    el.onpointermove = move; el.onpointerdown = move; el.onpointerleave = leave;
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
    if (e.target.closest("#logout")) { if (confirm("Te déconnecter du Studio sur cet appareil ?")) { st.del("doze.studio.key"); S.key = null; S.data = null; loginView(); } return; }
    const hd = e.target.closest("[data-hide]");
    if (hd) {
      const on = hd.dataset.v === "1";
      try { const ok = await rpc("admin_set_hidden", { p_id: hd.dataset.hide, p_key: S.key, p_hidden: on }); toast(ok ? (on ? "Titre masqué" : "Titre rétabli, signalements remis à zéro") : "Action refusée"); load(true); }
      catch { toast("Action impossible : lance d'abord la mise à jour 8"); }
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
