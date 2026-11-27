# Recherche sur le son DOZE

Ce que le robot a lu (source, date) et ce qui en a été tiré. Ne retenir que des sources sérieuses : ingénieurs reconnus (mastering, acoustique), documentations officielles (Web Audio API, AES, ITU-R BS.1770, EBU R128), cours en ligne d'universités ou d'écoles reconnues, publications de recherche (Harman, Sean Olive…).

## Déjà dans l'égaliseur DOZE (5.9.0)
Égaliseur 10 bandes paramétrique, basses profondes, clarté, espace 3D, volume nivelé, limiteur anti-saturation, comparaison A/B, réglage automatique par genre (tempo, poids des basses, attaques, dynamique) et correction tonale par morceau (±3 dB max).

## Journal de recherche

### 27 novembre 2026 — Crossfeed au casque (Bauer 1961, Linkwitz 1971, projet bs2b de Boris Mikhaylov)
Source : https://bs2b.sourceforge.net/ (références : B. Bauer, « Stereophonic Earphones and Binaural Loudspeakers », JAES 1961 ; S. Linkwitz, « Improved Headphone Listening », Audio, déc. 1971 ; circuits de Chu Moy et Jan Meier).
Idée : au casque, il manque le son de chaque enceinte qui arrive aussi à l'oreille opposée, un peu plus tard et assourdi par la tête. Le mixage paraît « dans le crâne » et fatigue (« superstéréo »). Le crossfeed ajoute à chaque oreille le canal opposé passé dans un passe-bas du 1er ordre, et atténue un peu le direct dans les graves (étagère qui le rend dans les aigus). Le retard vient du filtre lui-même (pas de FFT : risque d'effet de peigne).
Préréglages bs2b : défaut 700 Hz / 4,5 dB (≈ enceintes à 30°, 3 m) ; Chu Moy 700 Hz / 6 dB ; Jan Meier 650 Hz / 9,5 dB (le plus discret). Gains : croisé −6,75 / direct −2,25 dB ; −8 / −2 ; −10,917 / −1,417.
Appliqué dans DOZE 6.4.0 : « Confort casque » (Aucun, Léger, Naturel, Fort) avec IIRFilterNode du 1er ordre à 700 Hz et étagère aiguë sur le direct ; coupé automatiquement pendant Orbite (qui veut au contraire séparer les oreilles).

### 27 novembre 2026 (nuit) — Normalisation du volume : Spotify pour les artistes et EBU R 128 s2
Sources : https://artists.spotify.com/help/article/loudness-normalization ; EBU R 128 s2 (diffusion en flux).
Idée : un titre trop fort est baissé, un titre trop calme n'est remonté que tant qu'il ne sature pas (pas de limiteur ajouté). « Mode album » : un seul gain pour toute une playlist, pour garder les nuances voulues par l'artiste entre ses titres. À appliquer à l'idée « normalisation à −14 LUFS » de IDEES.md.
