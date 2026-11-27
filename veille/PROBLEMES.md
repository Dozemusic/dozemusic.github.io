# Problèmes à résoudre (veille technique quotidienne du robot)

Chaque passage, le robot choisit un problème ouvert, cherche des solutions (documentation officielle, WebKit/Chromium, MDN, forums de développeurs, projets open source), note ce qu'il a trouvé sous le problème avec les sources, et applique la solution dès qu'elle est sûre et testée. Un problème résolu est coché avec la version.

## Ouverts

- [ ] **Boutons suivant / précédent sur l'écran verrouillé (iPhone)** — signalé par Charles le 27 novembre 2026.
  Pistes à vérifier : Media Session API (`navigator.mediaSession.setActionHandler("nexttrack" / "previoustrack")`, métadonnées, `setPositionState`) ; titres lus par l'iframe SoundCloud ou YouTube (Tendances) qui échappent à l'élément `<audio>` ; moteur Web Audio (égaliseur, Orbite) qui s'arrête à l'écran verrouillé sur iOS ; enchaînement au titre suivant quand la page est en arrière-plan (préchargement du titre suivant, même élément `<audio>`) ; possibilité de passer par des fichiers MP3 / MP4 directs (CDN Suno, stockage Supabase) plutôt que par les lecteurs intégrés.
  Notes :

- [ ] **Faire connaître DOZE automatiquement** — demandé par Charles le 27 novembre 2026.
  Règle : aucun message automatique dans des communautés tierces (Discord de Suno, groupes, forums, commentaires) : c'est du spam au regard de leurs règles et cela ferait bannir DOZE. Ce qui est permis et automatisable : référencement (pages et données structurées, sitemap à jour avec les nouveaux titres), cartes de partage soignées, outils qui donnent envie aux artistes de partager eux-mêmes leur page DOZE (lien direct, image prête pour les réseaux, compteur d'écoutes), publication sur des canaux appartenant à DOZE via leurs API officielles quand Charles aura créé ces comptes (chaîne Telegram, page Facebook, compte X…), et textes de promotion prêts à publier rédigés dans veille/PROMO.md.
  Notes :
