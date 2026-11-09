# Clippit Studio — le site

En ligne sur **https://clippitstudio.cc** (et https://www.clippitstudio.cc).

## Mettre une modification en ligne

1. Modifier les fichiers dans **`public/`** : `public/index.html` est la page
   d'accueil, les images vont dans `public/img/`.
2. Faire un commit et le pousser sur la branche **`main`** (GitHub Desktop,
   VS Code, `git push`, ou « Add file → Upload files » sur github.com).
3. Environ une minute plus tard, c'est en ligne. Sur GitHub, à côté du commit
   (ou dans l'onglet **Actions**) :
   - **coche verte** : en ligne, et vérifié sur les deux adresses ;
   - **croix rouge** : rien n'a changé en ligne, ou la vérification a trouvé un
     problème. Voir « Si c'est rouge » plus bas.

## Voir le site avant de l'envoyer

Une seule fois : `npm ci`. Ensuite :

```bash
npx wrangler dev
```

Puis http://localhost:8787. Cette commande ne contacte pas Cloudflare, rien
n'est mis en ligne.

Pour vérifier que tes changements respectent les règles :

```bash
npm run verifier
```

## Règles

- **Ne modifier que `public/`.** Ne touche pas à `wrangler.jsonc`, `outils/`,
  `.github/`, `package.json` ni `package-lock.json`. Ce sont eux qui mettent le
  site en ligne et le vérifient : s'ils sont modifiés de travers, la mise en
  ligne est refusée.
- **Seulement des fichiers statiques** : HTML, CSS, JavaScript qui tourne dans
  le navigateur, images, polices. Pas de code serveur.
- **Images légères** : visez moins de 1 Mo (format WebP, taille adaptée à
  l'écran). Au-delà de 25 Mo, un fichier est refusé.
- **Le dépôt est public** : jamais de mot de passe, de clé ni de donnée
  personnelle dedans.

## Si c'est rouge

Clique sur la croix rouge, puis sur **Details** : le journal explique ce qui
s'est passé, étape par étape. Les lignes `[ERREUR]` disent quoi corriger.

- Le plus souvent, un changement enfreint une règle (étape 1) : corrige ce
  qui est signalé, puis pousse à nouveau. Rien n'a été envoyé. Tu peux aussi
  vérifier avant de pousser avec `npm run verifier`.
- Si le journal contient **« ARRÊT : ne tente PAS de réparer le quiz »** :
  préviens wal et ne pousse plus rien tant qu'il n'a pas regardé.
- Sinon, relance depuis l'onglet **Actions** (« Re-run jobs ») ou demande à wal.

## Pour wal

- Mise en ligne depuis ton PC, avec confirmation : `npm run deployer`.
- Essai complet sans rien envoyer : `node outils/deployer.js --essai`.
- Tests du garde-fou : `npm test`.
