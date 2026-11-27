# Problèmes à résoudre (veille technique quotidienne du robot)

Chaque passage, le robot choisit un problème ouvert, cherche des solutions (documentation officielle, WebKit/Chromium, MDN, forums de développeurs, projets open source), note ce qu'il a trouvé sous le problème avec les sources, et applique la solution dès qu'elle est sûre et testée. Un problème résolu est coché avec la version.

## Ouverts

- [ ] **Son muet sur iPhone en mode silencieux** — signalé par Charles le 27 novembre 2026 (le titre avance mais aucun son).
  Cause : sur iPhone, le moteur Web Audio (égaliseur, Orbite, Moments 3D) suit le bouton silencieux, contrairement à la lecture simple (WebKit 237322, 251532).
  Fait en 6.7.1 : navigator.audioSession.type = "playback" (Safari 17+) au démarrage et avant chaque moteur audio ; sans cette API, les Moments 3D ne s'activent pas sur iPhone et Orbite prévient. À confirmer par Charles, mode silencieux activé.
- [ ] **Anciennes versions restées sur les téléphones** — un autre utilisateur n'avait pas Orbite.
  Fait en 6.7.1 : vérification de la version publiée à l'ouverture, au retour dans l'appli et toutes les 30 min ; rechargement automatique quand rien ne joue, sinon bandeau « Nouvelle version · Mettre à jour ».

- [ ] **Lecture lente au démarrage et reprise après pause** — signalé par Charles le 27 novembre 2026.
  Constat : les MP4 de Suno ont leur sommaire (« moov », ~95 Ko) à la FIN du fichier (pas de « faststart ») ; le lecteur doit faire une deuxième requête avant de jouer. La version MP3 n'est pas publique sur le CDN (403).
  Fait en 6.7.0 : préconnexion à cdn1/cdn2.suno.ai ; fin du fichier préparée d'avance (titre à la une + 2 suivants) dans le cache « ecrin-warm-v1 » et servie par le service worker (1,2 s → 0,8 s mesuré à 400 ms de latence) ; reprise : réveil du moteur Web Audio et rechargement automatique au même endroit si le son ne repart pas en 2,5 s.
  Pistes suivantes : préparer aussi le début du fichier ; remuxer les MP4 en « faststart » (Edge Function + stockage Supabase) ; vérifier sur iPhone réel avec Charles.

- [ ] **Boutons suivant / précédent sur l'écran verrouillé (iPhone)** — signalé par Charles le 27 novembre 2026.
  Pistes à vérifier : Media Session API (`navigator.mediaSession.setActionHandler("nexttrack" / "previoustrack")`, métadonnées, `setPositionState`) ; titres lus par l'iframe SoundCloud ou YouTube (Tendances) qui échappent à l'élément `<audio>` ; moteur Web Audio (égaliseur, Orbite) qui s'arrête à l'écran verrouillé sur iOS ; enchaînement au titre suivant quand la page est en arrière-plan (préchargement du titre suivant, même élément `<audio>`) ; possibilité de passer par des fichiers MP3 / MP4 directs (CDN Suno, stockage Supabase) plutôt que par les lecteurs intégrés.
  Notes (27 nov., robot) — corrections publiées en 6.5.2, à confirmer par Charles sur un vrai iPhone :
  1. Les commandes étaient enregistrées une seule fois au chargement de la page. Plusieurs lecteurs web open source constatent qu'iOS ignore les commandes enregistrées avant le début réel de la lecture et affiche alors ses boutons « ±10 s ». **Fait** : réenregistrement à chaque `play` / `playing`, et ±10 s toujours mis à `null` (sources : github.com/renderghost/ghost-radio issue 25 et PR 35, github.com/esang-MAO/Miziki PR 42 et 223).
  2. Quand un titre se termine, WebKit peut fermer la session audio, et iOS refuse d'en rouvrir une page verrouillée : le titre suivant ne démarre pas et les boutons ne répondent plus (source : article daily.dev « Getting my iPhone music app to keep playing on the lock screen »). **Fait** : sur iPhone, l'élément audio tourne en boucle, donc « ended » n'est jamais déclenché ; le saut de la fin vers 0:00 sans action de l'auditeur lance le titre suivant (« répéter ce titre » continue de boucler).
  3. Sans pochette, l'image de l'écran verrouillé était un SVG déclaré en « image/jpeg ». **Fait** : logo DOZE en PNG (icon-512.png).
  4. Limite connue, non corrigeable par DOZE : bogue WebKit 261858 (https://bugs.webkit.org/show_bug.cgi?id=261858, iOS 16 et 17, toujours ouvert) : dans l'appli installée sur l'écran d'accueil, les boutons de l'écran verrouillé peuvent ne pas répondre du tout, alors qu'ils marchent dans Safari. Si le problème persiste, tester DOZE ouvert dans Safari et noter la version d'iOS.
  5. Limite : les titres des Tendances passent par le lecteur SoundCloud ou YouTube (iframe). C'est alors ce lecteur qui pilote l'écran verrouillé, pas DOZE. Piste suivante : signaler ces titres dans le lecteur, ou proposer de rester sur les titres DOZE quand l'écran est verrouillé.
  6. Le moteur Web Audio (égaliseur, Orbite) est déjà coupé par défaut sur iPhone, parce qu'il s'arrête à l'écran verrouillé.

- [ ] **Faire connaître DOZE automatiquement** — demandé par Charles le 27 novembre 2026.
  Règle : aucun message automatique dans des communautés tierces (Discord de Suno, groupes, forums, commentaires) : c'est du spam au regard de leurs règles et cela ferait bannir DOZE. Ce qui est permis et automatisable : référencement (pages et données structurées, sitemap à jour avec les nouveaux titres), cartes de partage soignées, outils qui donnent envie aux artistes de partager eux-mêmes leur page DOZE (lien direct, image prête pour les réseaux, compteur d'écoutes), publication sur des canaux appartenant à DOZE via leurs API officielles quand Charles aura créé ces comptes (chaîne Telegram, page Facebook, compte X…), et textes de promotion prêts à publier rédigés dans veille/PROMO.md.
  Notes :
