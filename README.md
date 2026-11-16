# DOZE

La musique des créateurs Suno, gratuite pour tout le monde. Les artistes publient leurs chansons (lien Suno ou fichier MP3) et tout le monde peut les écouter en boucle ou en aléatoire.

**Appli :** https://dozemusic.github.io/ · **Studio (administrateur) :** https://dozemusic.github.io/studio/

Version 5.5.1

## Fonctions
- **Accueil** façon plateforme de streaming : titre à la une, rayons « Écoutés récemment », « Nouveautés », « Pépites à découvrir » (titres peu écoutés mis en avant à tour de rôle), « Les plus écoutées », artistes et genres.
- **Rechercher** par titre, artiste ou genre, avec filtres par genre.
- **Bibliothèque** sans compte : coups de cœur et historique gardés sur l'appareil.
- **Pages d'artiste et de genre**, avec lecture et aléatoire.
- **Lecteur** : aléatoire, répéter (liste ou titre), « écouter juste après », minuteur de sommeil, lecteur plein écran avec file d'attente, contrôles sur l'écran verrouillé.
- **Publier** sans compte : lien Suno (`suno.com/song/…`) ou fichier MP3/WAV/M4A (15 Mo max) avec pochette.
- **Transparence** : chaque titre est marqué « IA ». Partage d'un titre par lien direct (`?t=…`), signalement (masquage automatique après 5 signalements).
- **Égaliseur DOZE** : 10 bandes paramétriques avec courbe à glisser au doigt et spectre en direct, basses profondes, clarté, espace 3D (stéréo), volume nivelé, limiteur anti-saturation, comparaison A/B et réglages personnels enregistrés.
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
