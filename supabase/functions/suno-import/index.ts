// Écrin · relais « suno-import » (Supabase Edge Function)
// Lit une page publique de Suno (playlist ou chanson) à la place du navigateur, qui n'y a pas accès,
// et renvoie la liste des chansons : titre, artiste, pochette, durée, paroles, adresses audio, visibilité.
// Appel : GET /functions/v1/suno-import?type=playlist&id=<uuid>   ou   ?type=song&id=<uuid>

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" } });
}

// Les données de la page sont dans des appels self.__next_f.push([1,"…"]) : on les rassemble.
export function flightText(html: string): string {
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

export function parseSongs(html: string) {
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

if (typeof Deno !== "undefined") Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const u = new URL(req.url);
  const type = u.searchParams.get("type") === "song" ? "song" : "playlist";
  const id = ((u.searchParams.get("id") || "").match(UUID) || [])[0];
  if (!id) return json({ error: "Identifiant manquant ou invalide." }, 400);
  const page = await fetch(`https://suno.com/${type}/${id.toLowerCase()}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "Accept-Language": "fr-FR,fr;q=0.9" },
  });
  if (!page.ok) return json({ error: `Suno a répondu ${page.status}.` }, 502);
  const data = parseSongs(await page.text());
  if (type === "song") data.songs = data.songs.filter((s) => s.id === id.toLowerCase());
  return json(data);
});
