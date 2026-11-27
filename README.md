# DOZE

La musique des créateurs Suno, gratuite pour tout le monde. Les artistes publient leurs chansons (lien Suno ou fichier MP3) et tout le monde peut les écouter en boucle ou en aléatoire.

**Appli :** https://dozemusic.github.io/ · **Studio (administrateur) :** https://dozemusic.github.io/studio/

Version 6.9.1

## Fonctions
- **Accueil** façon plateforme de streaming : nouveaux sons mis en exergue (badge « NOUVEAU » 7 jours, section « Nouveaux sons » en tête, son tout juste publié à la une, bandeau « X nouveaux sons depuis ta dernière visite »), titre à la une, rayons « Écoutés récemment », « Nouveautés », « Pépites à découvrir » (titres peu écoutés mis en avant à tour de rôle), « Les plus écoutées », artistes et genres.
- **Rechercher** par titre, artiste ou genre, avec filtres par genre.
- **Bibliothèque** sans compte : coups de cœur et historique gardés sur l'appareil.
- **Pages d'artiste et de genre**, avec lecture et aléatoire.
- **Lecteur** : Aléatoire DOZE (artistes alternés, sons écoutés récemment en fin de file ; « Hasard pur » au choix dans « À suivre »), répéter (liste ou titre), « écouter juste après », minuteur de sommeil, lecteur plein écran avec file d'attente, contrôles sur l'écran verrouillé.
- **Publier** sans compte : lien Suno (`suno.com/song/…`) ou fichier MP3/WAV/M4A (15 Mo max) avec pochette.
- **Transparence** : chaque titre est marqué « IA ». Partage d'un titre par lien direct (`?t=…`), signalement (masquage automatique après 5 signalements).
- **Orbite** (exclusivité, `#orbite`) : le son voyage autour de la tête, sur n'importe quel titre DOZE ou Suno. Le morceau est démonté en direct en 4 objets sonores (voix, basses, ambiance G et D : matrice mid/side + Linkwitz-Riley à 150 Hz). Double moteur binaural mélangé par un curseur « Intensité » : PannerNode HRTF + moteur DOZE (retard interaural de Woodworth, ombre de la tête, écart de niveau, assourdissement derrière soi, loi de distance), plus une salle synthétique (ConvolverNode) qui sort le son de la tête. Trajectoires automatiques calées sur le tempo (cercle, huit, balancier, spirale, envol), scène en perspective 3D avec traînées, karaoké d'un appui, boussole du téléphone, partage par lien. Conseil AirPods : couper l'audio spatial d'Apple pendant Orbite.
- **Moments 3D** (activés par défaut, réglage dans Orbite) : pendant l'écoute normale, le son voyage de gauche à droite seulement sur certains passages repérés automatiquement dans chaque titre (intro calme, pont ou plus forte envolée du milieu, outro), avec fondu de 2,5 s, puis revient au mixage d'origine. Repérage par l'enveloppe d'énergie du morceau, gardé sur l'appareil. Bouton « Arrêter Orbite » sur la scène. Sur iPhone, une version « 3D pré-calculée » (OfflineAudioContext → WAV) est lue par le lecteur normal pour que l'effet continue écran verrouillé, en arrière-plan et en mode silencieux.
- **Signature « DOZE BY CLB »** (mode Radio, Voix DOZE activée) : une fois par titre, sur le moment chaud (envolée ou pont, sinon vers 40 %), grosse voix avec scratch et écho gauche/droite (voice/signature-doze-by-clb.mp3) ; la musique baisse le temps de la signature. Sur iPhone, gravée dans la version 3D pré-calculée pour passer aussi écran verrouillé.
- **Égaliseur DOZE** : 10 bandes paramétriques avec courbe à glisser au doigt et spectre en direct, basses profondes, clarté, espace 3D (stéréo), **confort casque** (crossfeed Bauer/Linkwitz : chaque oreille entend un peu l'autre côté, réglages Léger, Naturel, Fort ; en pause pendant Orbite), volume nivelé, limiteur anti-saturation, comparaison A/B et réglages personnels enregistrés.
- **IA DOZE** : si l'artiste n'indique pas le genre, l'appli le déduit (titre, fiche de création Suno, puis analyse du son : tempo, poids des basses, attaques, dynamique) et applique le bon réglage, plus une correction tonale propre à chaque morceau. Le résultat est partagé entre auditeurs après la mise à jour `supabase/migration-7.sql`.
- **DOZE Studio** (`/studio/`) : tableau de bord réservé à l'administrateur (clé admin) : écoutes, auditeurs uniques, coups de cœur, nouveaux comptes, titres et artistes, top titres, pays, signalements avec modération, avis. Nécessite `supabase/migration-8.sql`.
- Installable sur téléphone (PWA).

## Mise en ligne (une seule fois, environ 10 minutes)

### 1. Base de données gratuite (Supabase)
1. Crée un compte sur https://supabase.com puis **New project** (région : Europe ou la plus proche).
2. Menu **SQL Editor** › **New query** : colle tout le contenu de `supabase/schema.sql`, puis **Run**.
3. Menu **Project Settings** › **API** : copie la **Project URL** et la clé **anon public**.
4. Colle-les dans `config.js`. La clé *anon* est publique par conception ; ne mets jamais la clé *service_role* ici.

### 2. Hébergement gratuit (GitHub Pages)
Dans le dépôt : **Settings** › **Pages** › Source : *Deploy from a branch*, branche `main`, dossier `/ (root)`.
L'appli sera à `https://<ton-compte>.github.io/<nom-du-depot>/`.

## Modération
Dans Supabase › **Table Editor** › `tracks` :
- pour remettre en ligne une chanson masquée : `hidden` = false et `reports` = 0 ;
- pour supprimer : supprime la ligne (et le fichier dans **Storage** › `songs` si c'était un envoi MP3).

## Limites à connaître
- **Droits Suno** : avec l'offre gratuite de Suno, les chansons appartiennent à Suno et ne sont utilisables qu'à titre non commercial. Une plateforme gratuite et sans publicité reste dans ce cadre. Avant toute monétisation (pubs, abonnements), n'accepter que les chansons créées avec un abonnement Suno payant (Pro/Premier).
- **Liens courts** `suno.com/s/…` : le navigateur ne peut pas les déchiffrer ; l'appli demande l'adresse complète `suno.com/song/…`.
- **Offre gratuite Supabase** : 500 Mo de base (des centaines de milliers de titres) et 1 Go de fichiers (environ 200 à 250 MP3). Les liens Suno ne consomment pas de stockage.
- Un projet Supabase gratuit se met en pause après 7 jours sans aucune visite ; il suffit de le relancer depuis le tableau de bord.

## Fichiers
- `index.html`, `style.css`, `app.js` : l'appli
- `config.js` : adresse et clé publique Supabase
- `supabase/schema.sql` : tables, règles de sécurité, stockage
- `sw.js`, `manifest.json`, `icon.svg` : installation sur téléphone

## Identité
- **Nom** : DOZE. **Slogan** : « Chaque talent mérite d'être entendu ».
- **Logo** : DOZE sculpté (lettres bleu nuit et cuivre, casque formant le « O », ondes cuivrées) sur fond transparent : `brand/logo-doze.webp` / `.png` ; icônes `icon-*.png`, bannière de partage `brand/banniere-doze.jpg`.
- **Couleurs** : noir bleuté, bleu nuit, cuivre et ivoire, reprises du logo.
- **Typographies** : Montserrat (titres), Inter (texte).

## Relais Suno (import de playlist)
Le navigateur ne peut pas lire les pages de Suno. Le relais `supabase/functions/suno-import/index.ts`
(Supabase Edge Function) les lit à sa place et renvoie titres, pochettes, durées, paroles et visibilité.
Seules les chansons publiques sur Suno sont importées, avec leur version publique (MP4).

Installation (une fois) : Supabase › Edge Functions › Deploy a new function › Via Editor,
nom `suno-import`, coller le fichier, Deploy, puis dans ses réglages désactiver « Verify JWT ».
