// DOZE · robot « suno-sync » (Supabase Edge Function)
// Chaque matin (programmé par la mise à jour 10), il passe sur les profils Suno que les artistes ont choisi de suivre
// et ajoute à DOZE leurs nouvelles chansons PUBLIQUES qui n'y sont pas encore. Il ne touche jamais aux chansons existantes.
// Appel : POST /functions/v1/suno-sync            → tous les profils suivis
//         POST /functions/v1/suno-sync?follow=<id> → un seul profil (bouton « Mettre à jour maintenant »)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "Accept-Language": "fr-FR,fr;q=0.9" };
const URL_DB = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = (path: string, init: RequestInit = {}) => fetch(`${URL_DB}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });

// Les données de la page sont dans des appels self.__next_f.push([1,"…"]) : on les rassemble.
function flightText(html: string): string {
  let out = "";
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { try { out += JSON.parse(m[1]); } catch { /* morceau illisible : ignoré */ } }
  return out;
}

// Extrait l'objet JSON qui entoure la position donnée.
function objectAround(text: string, pos: number): any {
  let depth = 0, start = -1;
  for (let i = pos; i >= 0; i--) {
    const c = text[i];
    if (c === "}") depth++;
    else if (c === "{") { if (depth === 0) { start = i; break; } depth--; }
  }
  if (start < 0) return null;
  let d = 0, inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

// Résout une référence « $c6 » vers un bloc texte « c6:T<taille hex>,<texte> » (utilisé pour les paroles).
function resolveRef(text: string, ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  if (!ref.startsWith("$")) return ref || null;
  const key = ref.slice(1), marker = "\n" + key + ":T";
  const k = text.indexOf(marker); if (k < 0) return null;
  const comma = text.indexOf(",", k + marker.length); if (comma < 0) return null;
  const len = parseInt(text.slice(k + marker.length, comma), 16); if (!(len > 0)) return null;
  const bytes = new TextEncoder().encode(text.slice(comma + 1));
  return new TextDecoder().decode(bytes.slice(0, len));
}

function parseSongs(html: string) {
  const text = flightText(html) || html;
  const seen = new Map<string, any>();
  const re = /"id":"([0-9a-f-]{36})","(?:entityType|entity_type)":"song_schema"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const o = objectAround(text, m.index); if (!o || !o.id || seen.has(o.id)) continue;
    const meta = o.metadata || {};
    const media = (o.mediaUrls || o.media_urls || []).map((x: any) => x && x.url).filter(Boolean);
    const video = o.videoUrl || o.video_url || "";
    seen.set(o.id, {
      id: o.id,
      title: o.title || "",
      artist: o.displayName || o.display_name || o.handle || "",
      handle: String(o.handle || "").toLowerCase(),
      cover: o.imageLargeUrl || o.image_large_url || o.imageUrl || o.image_url || null,
      isPublic: (o.isPublic ?? o.is_public) === true,
      duration: meta.duration || null,
      tags: meta.tags || o.displayTags || o.display_tags || "",
      lyrics: resolveRef(text, meta.prompt),
      video: video || null,
      media: media[0] || null,
    });
  }
  const title = (/<title>([^<]*)<\/title>/.exec(html) || [])[1] || "";
  return { title: title.replace(/\s*\|\s*Suno\s*$/, "").replace(/\s+by\s+@?\S+$/i, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'"), songs: [...seen.values()] };
}


// Paroles : on retire les blocs techniques de Suno ([Style], [Genre], [Instruments]…)
function cleanLyrics(text: string | null): string | null {
  if (!text) return null;
  const out: string[] = []; let skip = false;
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (/^\[\s*(style|styles|genre|instruments?)\b[^\]]*\]$/i.test(t)) { skip = true; continue; }
    if (/^\[[^\]]+\]$/.test(t)) skip = false;
    if (!skip) out.push(line);
  }
  const s = out.join("\n").trim();
  return s ? s.slice(0, 8000) : null;
}

// Le son public de Suno est-il prêt ? (fichier vidéo dont la piste audio est lue par DOZE)
async function playable(id: string): Promise<boolean> {
  try { const r = await fetch(`https://cdn1.suno.ai/${id}.mp4`, { headers: { Range: "bytes=0-1" } }); await r.body?.cancel(); return r.status === 200 || r.status === 206; }
  catch { return false; }
}

async function syncOne(f: any) {
  const page = await fetch(`https://suno.com/@${f.handle}`, { headers: UA });
  if (!page.ok) return { handle: f.handle, error: `Suno a répondu ${page.status}` };
  const songs = parseSongs(await page.text()).songs.filter((s: any) => s.handle === f.handle && s.isPublic);
  if (!songs.length) return { handle: f.handle, added: 0 };
  const ids = songs.map((s: any) => s.id);
  const have = await (await db(`tracks?select=suno_id&suno_id=in.(${ids.join(",")})`)).json();
  const known = new Set((Array.isArray(have) ? have : []).map((x: any) => x.suno_id));
  const fresh = songs.filter((s: any) => !known.has(s.id)).slice(0, 30);
  let added = 0; const waiting: string[] = [];
  for (const s of fresh) {
    if (!(await playable(s.id))) { waiting.push(s.title); continue; }   // son pas encore prêt : réessayé demain
    const row: any = { title: (s.title || "Sans titre").slice(0, 120), artist: f.artist, genre: f.genre || null, source: "suno", suno_id: s.id,
      audio_url: `https://cdn1.suno.ai/${s.id}.mp4`, cover_url: s.cover || `https://cdn2.suno.ai/image_large_${s.id}.jpeg`,
      lyrics: cleanLyrics(s.lyrics), ai: true, made_with: f.made_with || "Suno", user_id: f.user_id };
    const r = await db("tracks", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
    if (r.ok) added++;
  }
  await db(`suno_follows?id=eq.${f.id}`, { method: "PATCH", body: JSON.stringify({ last_sync: new Date().toISOString(), last_added: added }) });
  return { handle: f.handle, added, waiting };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const only = new URL(req.url).searchParams.get("follow");
  const q = only && /^[0-9a-f-]{36}$/i.test(only) ? `suno_follows?select=*&active=eq.true&id=eq.${only}` : "suno_follows?select=*&active=eq.true";
  const follows = await (await db(q)).json();
  if (!Array.isArray(follows)) return json({ error: "Table suno_follows introuvable : lance la mise à jour 10." }, 500);
  const results = [];
  for (const f of follows) { try { results.push(await syncOne(f)); } catch (e) { results.push({ handle: f.handle, error: String(e) }); } }
  return json({ profiles: results.length, added: results.reduce((a, r: any) => a + (r.added || 0), 0), results });
});
