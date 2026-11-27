# Aligne les paroles connues d'un titre sur les mots horodatés d'une transcription (alignement global de séquences).
import json, re, sys, unicodedata
from difflib import SequenceMatcher

def norm(w):
    w = unicodedata.normalize("NFD", w.lower()); w = "".join(c for c in w if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", w.replace("œ", "oe"))

def parse_lyrics(text):  # même règle que parseLyrics() de l'appli
    lines = []
    for raw in (text or "").splitlines():
        line = re.sub(r"\[[^\]]*\]", "", raw).strip()
        if not line: 
            if re.match(r"^\s*\[[^\]]+\]\s*$", raw) and lines: lines[-1]["gap"] = True
            continue
        if re.match(r"^\(.*\)$", line): continue
        lines.append({"text": line})
    return lines

def toks(s):  # mots d'une ligne (les élisions « j'ai » restent un mot, comme Scribe)
    return [w for w in re.findall(r"[\w'’-]+", s) if norm(w)]

def sim(a, b):
    if a == b: return 2.0
    if not a or not b: return -1.0
    r = SequenceMatcher(None, a, b).ratio()
    return 1.2 if r >= .8 else (.4 if r >= .6 else -1.0)

def align(lines, words):
    L = [(i, norm(w), w) for i, l in enumerate(lines) for w in toks(l["text"])]
    T = [w for w in words if w.get("type") == "word" and norm(w["text"])]
    # transcription : un mot Scribe peut contenir une élision collée ; on garde tel quel
    n, m, gap = len(L), len(T), -.55
    # alignement global (Needleman-Wunsch) en bande large
    import array
    S = [array.array("f", [0.0]) * (m + 1) for _ in range(n + 1)]
    P = [bytearray(m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1): S[i][0] = i * gap; P[i][0] = 1
    for j in range(1, m + 1): S[0][j] = j * gap; P[0][j] = 2
    tn = [norm(t["text"]) for t in T]
    for i in range(1, n + 1):
        a = L[i - 1][1]; Si, Sp, Pi = S[i], S[i - 1], P[i]
        for j in range(1, m + 1):
            d = Sp[j - 1] + sim(a, tn[j - 1]); u = Sp[j] + gap; l = Si[j - 1] + gap
            if d >= u and d >= l: Si[j] = d; Pi[j] = 0
            elif u >= l: Si[j] = u; Pi[j] = 1
            else: Si[j] = l; Pi[j] = 2
    i, j, match = n, m, {}
    while i > 0 and j > 0:
        p = P[i][j]
        if p == 0:
            if sim(L[i - 1][1], tn[j - 1]) > 0: match[i - 1] = T[j - 1]
            i -= 1; j -= 1
        elif p == 1: i -= 1
        else: j -= 1
    # temps par mot, interpolés pour les mots non reconnus
    wt = [None] * n
    for k, t in match.items(): wt[k] = [t["start"], t["end"]]
    known = [k for k in range(n) if wt[k]]
    for k in range(n):
        if wt[k]: continue
        a = max([x for x in known if x < k], default=None); b = min([x for x in known if x > k], default=None)
        if a is not None and b is not None:
            t0, t1 = wt[a][1], wt[b][0]; f = (k - a) / (b - a); s = t0 + (t1 - t0) * f; wt[k] = [s, s + .2]
        elif a is not None: s = wt[a][1] + .3 * (k - a); wt[k] = [s, s + .2]
        elif b is not None: s = max(0, wt[b][0] - .3 * (b - k)); wt[k] = [s, s + .2]
    out = []
    for li, l in enumerate(lines):
        ks = [k for k in range(n) if L[k][0] == li]
        if not ks: out.append({"text": l["text"], "t": None}); continue
        got = [k for k in ks if k in match]
        out.append({"text": l["text"], "t": round(wt[ks[0]][0], 2), "e": round(wt[ks[-1]][1], 2),
                    "w": [[L[k][2], round(wt[k][0], 2), round(wt[k][1], 2)] for k in ks], "ok": round(len(got) / len(ks), 2)})
    # lignes sans mots (rare) : entre les voisines
    for k, o in enumerate(out):
        if o["t"] is None:
            prv = next((x for x in reversed(out[:k]) if x["t"] is not None), None); o["t"] = round((prv["e"] if prv else 0) + .2, 2); o["e"] = o["t"] + 1
    # cohérence : temps croissants
    for k in range(1, len(out)):
        if out[k]["t"] < out[k - 1]["t"]: out[k]["t"] = out[k - 1]["t"] + .05
    cov = sum(1 for k in range(n) if k in match) / max(1, n)
    return out, cov

if __name__ == "__main__":
    lyrics_file, words_file, out_file = sys.argv[1:4]
    lines = parse_lyrics(open(lyrics_file, encoding="utf-8").read())
    words = json.load(open(words_file))["words"]
    out, cov = align(lines, words)
    json.dump({"v": 1, "src": "scribe+alignement", "coverage": round(cov, 3), "lines": out}, open(out_file, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(out)} lignes, {cov:.0%} des mots reconnus")
