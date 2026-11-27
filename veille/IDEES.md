# Idées d'amélioration DOZE

Format : `- [ ] (priorité) Idée — origine`. Le robot coche `[x]` avec la version quand c'est fait. Priorité : P1 = gros irritant chez les concurrents que DOZE peut battre facilement.

## Veille du 26 novembre 2026 (avis App Store FR et CI : Spotify, Deezer, Apple Music, Audiomack, YouTube Music, SoundCloud)
Plaintes les plus fréquentes : publicités envahissantes (Audiomack, YouTube Music, Spotify gratuit), hors ligne qui ne marche pas ou téléchargements qui disparaissent (Audiomack, Spotify CI, SoundCloud CI, YouTube Music), aléatoire qui rejoue toujours les mêmes titres (Spotify, YouTube Music), playlists perdues sans possibilité de récupération (Apple Music), interface où l'on ne retrouve plus ses playlists après une mise à jour (Deezer, Apple Music), radio qui propose des titres sans rapport (Apple Music), pas d'égaliseur (YouTube Music), musique IA non signalée (YouTube Music), écouter toute la discographie d'un artiste impossible (Deezer), paroles réservées au premium ou absentes (Deezer, Spotify), paiement sans carte Visa impossible (Deezer CI), crashs écran verrouillé et CarPlay (Deezer, YouTube Music), lenteur au lancement en 4G (Deezer).

DOZE a déjà : zéro pub, gratuit, mention « IA », égaliseur, hors ligne, paroles, radio d'un titre.

- [ ] (P1) Corbeille : playlists et coups de cœur supprimés récupérables 30 jours — Apple Music (« 400 sons disparus »)
- [x] (P1) Aléatoire vraiment varié — fait en 6.5.0 (« Aléatoire DOZE », bouton « Hasard pur ») : ne pas rejouer un titre écouté dans les N derniers, mélange équilibré entre artistes — Spotify, YouTube Music
- [ ] (P1) Vérification des téléchargements hors ligne au démarrage (titres manquants re-téléchargés, compteur clair « 34/34 disponibles ») — Audiomack, YouTube Music
- [ ] (P1) « Tout écouter » d'un artiste (discographie en un appui, aléatoire ou dans l'ordre) bien visible sur sa page — Deezer
- [ ] (P2) Mode économie de données (qualité réduite en 3G/4G, préchargement du titre suivant en Wi-Fi seulement, compteur de Mo) — Audiomack CI, Deezer 4G
- [ ] (P2) Radio plus pertinente : même genre, tempo proche (BPM déjà analysé), énergie proche — Apple Music
- [ ] (P2) Sauvegarde / transfert de la bibliothèque entre appareils par code ou QR (sans compte obligatoire) — Apple Music synchro
- [ ] (P2) Ouverture instantanée : afficher la dernière liste en cache avant le réseau, reprendre le dernier titre — Deezer « lent au lancement »
- [ ] (P2) Filtre « IA / humain » dans la recherche et la radio — YouTube Music
- [ ] (P3) Minuteur de sommeil avec fondu progressif et « fin du titre en cours »
- [ ] (P3) Écran « Mode voiture » : gros boutons, contraste élevé, recherche vocale — plaintes CarPlay
- [ ] (P3) Rubrique « Récap de la semaine » : temps d'écoute, artistes découverts, à partager

## Veille du 27 novembre 2026 (avis App Store NG : YouTube Music, Spotify ; Boomplay via analyses d'avis Google Play et Trustpilot)
Flux App Store vides ce jour pour us, gb et la plupart des applis en ng : à retenter demain.
Plaintes : YouTube Music NG — lecture automatique impossible à couper (« on avait l'option, pourquoi l'enlever ? »), onglets Paroles et « À découvrir » supprimés, 2 longues pubs par chanson, « pas de connexion internet » alors que le réseau est bon, hausse de prix. Spotify NG — pubs trop nombreuses, pas d'écoute hors ligne en gratuit, déconnecté du compte et « toutes mes playlists ont disparu », mise à jour qui casse la file d'attente. Boomplay — pubs plein écran impossibles à fermer qui figent l'appli, téléchargements peu fiables (source : analyses kimola.com et marlvel.ai d'avis Google Play, Trustpilot).

- [ ] (P1) Interrupteur « Lecture automatique » bien visible (à la fin d'une liste : s'arrêter ou enchaîner sur la radio) — YouTube Music NG ; DOZE a déjà le réglage radio, à rendre visible dans le lecteur
- [ ] (P1) Mode hors connexion honnête : distinguer « pas de réseau » et « serveur lent », et basculer tout seul sur les titres téléchargés — YouTube Music NG
- [ ] (P2) File d'attente robuste : glisser pour réordonner, annuler une suppression — Spotify NG

## Veille de la nuit du 26 au 27 novembre (avis App Store US et NG, robot)
Plaintes : trop de pubs (YouTube Music NG « 2 longues pubs pour 1 chanson », SoundCloud, Spotify) ; aléatoire et lecture auto mal faits (Audiomack « ne mélange pas les sons », Spotify « choisit les titres à ma place », YouTube Music a retiré le bouton pour couper la lecture automatique) ; Deezer : impossible de bloquer un artiste, impossible de retrouver le titre qui vient de passer.

- [ ] (P2) Bloquer un artiste (il n'apparaît plus nulle part pour cet auditeur) — Deezer
- [ ] (P2) « Titre précédent » et historique de lecture accessibles en un appui depuis le lecteur — Deezer

## Son (voir SON.md)
- [ ] (P2) Normalisation de sonie à −14 LUFS intégrés (référence des plateformes) mesurée par titre, au lieu d'un nivellement dynamique
- [ ] (P2) Mode « écouteurs » : légère cible de courbe type Harman pour casques et écouteurs, réglable
- [x] (P3) Crossfeed optionnel au casque (réduit la fatigue des mixages très stéréo) — fait en 6.4.0 (« Confort casque », préréglages bs2b)
