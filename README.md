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

   Elle installe Git et Node.js s'il le faut, copie le projet dans
   `Documents\clippitstudio`, te connecte à Cloudflare avec **ton propre
   compte** (une page s'ouvre : clique « Allow »), puis crée deux raccourcis
   sur le bureau. En cas d'erreur, corrige ce qu'elle dit et relance la même
   ligne.

## Mettre une modification en ligne

1. **« Clippit - Fichiers du site »** (sur le bureau) : modifie les fichiers.
   `index.html` est la page d'accueil, les images vont dans `img/`.
2. Double-clic sur **« Clippit - Mettre en ligne »**. Il enregistre tes
   modifications (il te demande de les décrire en quelques mots), récupère
   celles des autres, envoie le tout sur GitHub, puis met en ligne sur
   Cloudflare après une dernière confirmation (`o` puis Entrée). Il vérifie
   ensuite que chaque fichier est bien servi sur les deux adresses.

Sans le raccourci, la même chose à la main : commit, `git pull --rebase`,
`git push`, puis `npm run deployer`.

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
- « GitHub refuse l'envoi » : accepte l'invitation GitHub de wal (ou
  demande-la), puis relance.
- « More than one account » ou « Authentication error » : relance
  `npx wrangler login` dans le dossier du projet, et vérifie que tu as bien
  accepté l'invitation Cloudflare.
- Si l'outil affiche **« ARRÊT : ne tente PAS de réparer le quiz »** :
  préviens wal et ne relance rien tant qu'il n'a pas regardé.

## Pour wal

- Essai complet sans rien envoyer : `node outils/deployer.js --essai`, ou le
  bouton avec la variable `CLIPPIT_ESSAI=1` (commit local, pas de push).
- Tests du garde-fou : `npm test`.
- Accès d'un membre : Cloudflare → Manage Account → Members → Invite, accès
  limité au Worker `clippitstudio`, rôle Editor (jamais Admin, jamais tout le
  compte). Plus, sur GitHub : Settings → Collaborators → Add people, rôle
  Write.
