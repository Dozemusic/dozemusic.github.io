# Veille DOZE

Mémoire du robot quotidien « DOZE · veille, son et améliorations ». Chaque session repart de zéro : ces fichiers sont sa mémoire.

- `IDEES.md` : idées classées par priorité, issues des plaintes chez les concurrents (avis App Store et Google Play) et de la recherche sur le son. Chaque passage en réalise une, la coche et en ajoute de nouvelles.
- `SON.md` : notes de recherche sur la qualité du son (sources sérieuses : ingénieurs reconnus, documentations, cours en ligne, publications AES/ITU/EBU), avec ce qui est déjà appliqué dans l'égaliseur DOZE.
- `JOURNAL.md` : une ligne par passage (date, sources lues, changement publié, version).

## Lire les avis des boutiques
- App Store (JSON, 50 avis récents par page, pays `fr`, `ci`, `us`, `gb`, `ng`…) :
  `https://itunes.apple.com/{pays}/rss/customerreviews/page=1/id={id}/sortby=mostrecent/json`
  Identifiants : Spotify 324684580 · Deezer 292738169 · Apple Music 1108187390 · Audiomack 921765888 · YouTube Music 1017492454 · SoundCloud 336353151 · Boomplay 1031996963 · Amazon Music 510855668 · Tidal 913943275.
- Google Play : `https://play.google.com/store/apps/details?id={paquet}&hl=fr&gl=CI` (avis visibles dans la page) ; paquets : com.spotify.music · deezer.android.app · com.apple.android.music · com.audiomack · com.google.android.apps.youtube.music · com.soundcloud.android · com.boomplay.music.
- Compléter avec la recherche web : forums Reddit, Trustpilot, articles « ce que les utilisateurs reprochent à … ».
