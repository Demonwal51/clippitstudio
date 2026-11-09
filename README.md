# Clippit Studio — le site

En ligne sur **https://clippitstudio.cc** (et https://www.clippitstudio.cc).

## Une seule fois : s'installer

1. Accepter l'invitation Cloudflare envoyée par wal (e-mail « You've been
   invited… »). Elle donne accès au seul site `clippitstudio`, rien d'autre.
2. Installer [Node.js](https://nodejs.org) (version LTS) et Git.
3. Récupérer le projet et ses outils :

   ```bash
   git clone https://github.com/Demonwal51/clippitstudio.git
   ```

   ```bash
   cd clippitstudio
   ```

   ```bash
   npm ci
   ```

4. Se connecter à Cloudflare avec **son propre compte** (une page s'ouvre dans
   le navigateur, accepter) :

   ```bash
   npx wrangler login
   ```

## Mettre une modification en ligne

1. `git pull` pour partir de la dernière version.
2. Modifier les fichiers dans **`public/`** : `public/index.html` est la page
   d'accueil, les images vont dans `public/img/`.
3. Faire un commit et le pousser sur **`main`** (`git push`, GitHub Desktop ou
   VS Code).
4. Mettre en ligne :

   ```bash
   npm run deployer
   ```

   L'outil vérifie les règles, demande confirmation (`o` puis Entrée), envoie,
   puis contrôle que chaque fichier est bien servi sur les deux adresses. Il
   refuse de partir si des modifications ne sont pas commitées.

## Voir le site avant de l'envoyer

```bash
npx wrangler dev
```

Puis http://localhost:8787. Cette commande ne met rien en ligne.

Pour vérifier seulement les règles : `npm run verifier`.

## Règles

- **Ne modifier que `public/`.** Ne touche pas à `wrangler.jsonc`, `outils/`,
  `package.json` ni `package-lock.json` : ce sont eux qui mettent le site en
  ligne et le vérifient. Modifiés de travers, la mise en ligne est refusée.
- **Seulement des fichiers statiques** : HTML, CSS, JavaScript qui tourne dans
  le navigateur, images, polices. Pas de code serveur.
- **Images légères** : visez moins de 1 Mo (format WebP, taille adaptée à
  l'écran). Au-delà de 25 Mo, un fichier est refusé.
- **Le dépôt est public** : jamais de mot de passe, de clé ni de donnée
  personnelle dedans.

## Si ça échoue

Les lignes `[ERREUR]` disent quoi corriger.

- Le plus souvent, un changement enfreint une règle (étape 1) : corrige ce qui
  est signalé, commite, relance. Rien n'a été envoyé.
- « More than one account » ou « Authentication error » : relance
  `npx wrangler login`, et vérifie que tu as bien accepté l'invitation.
- Si l'outil affiche **« ARRÊT : ne tente PAS de réparer le quiz »** :
  préviens wal et ne relance rien tant qu'il n'a pas regardé.

## Pour wal

- Essai complet sans rien envoyer : `node outils/deployer.js --essai`.
- Tests du garde-fou : `npm test`.
- Accès d'un membre : Cloudflare → Manage Account → Members → Invite, accès
  limité au Worker `clippitstudio`, rôle Editor (jamais Admin, jamais tout le
  compte).
