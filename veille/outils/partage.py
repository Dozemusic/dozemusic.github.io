#!/usr/bin/env python3
"""Robot DOZE : régénère les pages de partage des titres (t/<id>.html) et sitemap.xml.

Chaque page porte les balises Open Graph / Twitter (pochette, titre, artiste) : un lien partagé
sur WhatsApp, Facebook, X ou Telegram affiche la vraie pochette du son. Un visiteur est
renvoyé aussitôt vers l'appli (?t=<id>). À lancer à chaque passage : python3 -I veille/outils/partage.py
N'utilise que la clé publique de config.js (lecture des titres publics)."""
import html, json, os, re, sys, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE = "https://dozemusic.github.io/"
cfg = open(os.path.join(ROOT, "config.js"), encoding="utf-8").read()
url = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg).group(1)
key = re.search(r'supabaseAnonKey:\s*"([^"]+)"', cfg).group(1)
req = urllib.request.Request(url + "/rest/v1/tracks?select=id,title,artist,genre,cover_url,created_at,hidden&order=created_at.desc",
                             headers={"apikey": key, "Authorization": "Bearer " + key})
tracks = [t for t in json.load(urllib.request.urlopen(req, timeout=30)) if not t.get("hidden")]
ID = re.compile(r"^[0-9a-f-]{36}$")
e = lambda s: html.escape(str(s or ""), quote=True)
out = os.path.join(ROOT, "t")
os.makedirs(out, exist_ok=True)
keep = set()
for t in tracks:
    if not ID.match(t["id"]):
        continue
    keep.add(t["id"] + ".html")
    title, artist = t.get("title") or "Sans titre", t.get("artist") or "Artiste"
    cover = t.get("cover_url") or ""
    if not cover.startswith("https://"):
        cover = SITE + "brand/banniere-doze.jpg"
    page = SITE + "t/" + t["id"] + ".html"
    desc = f"Écoute « {title} » de {artist} gratuitement et sans pub sur DOZE" + (f" · {t['genre']}" if t.get("genre") else "") + "."
    ld = json.dumps({"@context": "https://schema.org", "@type": "MusicRecording", "name": title, "url": page,
                     "byArtist": {"@type": "MusicGroup", "name": artist}, "image": cover,
                     "datePublished": (t.get("created_at") or "")[:10], "inLanguage": "fr"}, ensure_ascii=False).replace("</", "<\\/")
    app = "../?t=" + t["id"]
    doc = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)} · {e(artist)} | DOZE</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(page)}">
<meta property="og:type" content="music.song"><meta property="og:site_name" content="DOZE">
<meta property="og:url" content="{e(page)}"><meta property="og:title" content="{e(title)} · {e(artist)}">
<meta property="og:description" content="{e(desc)}"><meta property="og:image" content="{e(cover)}"><meta property="og:locale" content="fr_FR">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{e(title)} · {e(artist)}">
<meta name="twitter:description" content="{e(desc)}"><meta name="twitter:image" content="{e(cover)}">
<meta name="theme-color" content="#0A0C12"><link rel="icon" href="../icon-192.png">
<script type="application/ld+json">{ld}</script>
<script>location.replace("{app}" + (location.hash || ""));</script>
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0C12;color:#F4EEE6;font:16px/1.4 system-ui,sans-serif;text-align:center}}img{{width:220px;height:220px;object-fit:cover;border-radius:16px}}a{{display:inline-block;margin-top:16px;padding:12px 22px;border-radius:999px;background:#DA9A68;color:#14100C;font-weight:700;text-decoration:none}}</style>
</head><body><main><img src="{e(cover)}" alt=""><h1>{e(title)}</h1><p>{e(artist)} · sur DOZE, gratuit et sans pub</p><a href="{e(app)}">▶ Écouter sur DOZE</a></main></body></html>
"""
    open(os.path.join(out, t["id"] + ".html"), "w", encoding="utf-8").write(doc)
for f in os.listdir(out):            # titre supprimé ou masqué : sa page disparaît
    if f.endswith(".html") and f not in keep:
        os.remove(os.path.join(out, f))
today = date.today().isoformat()
rows = [f'  <url><loc>{SITE}</loc><lastmod>{today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>']
for t in tracks:
    if t["id"] + ".html" in keep:
        img = f'<image:image><image:loc>{e(t["cover_url"])}</image:loc></image:image>' if (t.get("cover_url") or "").startswith("https://") else ""
        rows.append(f'  <url><loc>{SITE}t/{t["id"]}.html</loc><lastmod>{(t.get("created_at") or today)[:10]}</lastmod><priority>0.7</priority>{img}</url>')
open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
    + "\n".join(rows) + "\n</urlset>\n")
print(f"{len(keep)} pages de partage, sitemap de {len(rows)} adresses")
