# Clippit Studio — le site

En ligne sur **https://clippitstudio.cc** (et https://www.clippitstudio.cc).

## Une seule fois : s'installer (Windows)

1. Accepter les deux invitations envoyées par wal : celle de **Cloudflare**
   (accès au seul site `clippitstudio`) et celle de **GitHub** (droit d'envoyer
   sur le dépôt).
2. Ouvrir **PowerShell** (menu Démarrer → « PowerShell »), y coller cette
   ligne, puis Entrée :

   ```powershell
   irm https://raw.githubusercontent.com/Demonwal51/clippitstudio/main/outils/installer.ps1 -OutFile $env:TEMP\clippit.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\clippit.ps1
   ```

3. Deux pages s'ouvrent dans le navigateur, Cloudflare puis GitHub :
   connecte-toi avec **ton propre compte** et clique « Allow » /
   « Authorize ». C'est tout : l'installation ne pose aucune question.

   Elle installe Git et Node.js s'il le faut, copie le projet dans
   `Documents\clippitstudio`, crée l'icône **Clippit Studio** sur le bureau,
   puis ouvre l'appli. En cas d'erreur, fais ce qu'elle dit et relance la même
   ligne.

## Utiliser Clippit Studio

Double-clic sur l'icône **Clippit Studio** du bureau :

- **Modifier le site** : ouvre le dossier des fichiers. `index.html` est la
  page d'accueil, les images vont dans `img/`.
- **Voir avant d'envoyer** : ouvre ta version dans le navigateur.
- **Mettre en ligne** : montre la liste de tes modifications, puis, sur
  « Oui », les envoie sur GitHub et sur clippitstudio.cc. Environ une minute.
  Un bandeau vert : c'est en ligne. Un bandeau rouge : il dit ce qui bloque,
  et rien n'a été mis en ligne.
- **Voir le site en ligne** : ouvre https://clippitstudio.cc.

À l'ouverture, l'appli récupère toute seule les modifications des autres.

## À la main (sans l'appli)

Commit, `git pull --rebase`, `git push`, puis `npm run deployer`. Ou bien
`powershell -File outils\mettre-en-ligne.ps1`, qui fait tout cela.

Voir le site avant de l'envoyer, avec un vrai serveur :

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

Le bandeau rouge et les lignes `[ERREUR]` du journal disent quoi corriger.
Rien n'a été mis en ligne.

- Le plus souvent, un changement enfreint une règle (fichier trop lourd,
  fichier modifié hors du dossier du site) : corrige-le, puis reclique sur
  « Mettre en ligne ».
- « GitHub refuse l'envoi » ou un problème de compte Cloudflare : accepte
  l'invitation de wal (ou demande-la), puis relance la ligne d'installation.
- Si l'outil affiche **« ARRÊT : ne tente PAS de réparer le quiz »** :
  préviens wal et ne relance rien tant qu'il n'a pas regardé.

## Pour wal

- Essai complet sans rien envoyer : `node outils/deployer.js --essai`, ou
  l'appli avec la variable `CLIPPIT_ESSAI=1` (commit local, pas de push).
- Tests du garde-fou : `npm test`.
- Accès d'un membre : Cloudflare → Manage Account → Members → Invite, accès
  limité au Worker `clippitstudio`, rôle Editor (jamais Admin, jamais tout le
  compte). Plus, sur GitHub : Settings → Collaborators → Add people, rôle
  Write.
