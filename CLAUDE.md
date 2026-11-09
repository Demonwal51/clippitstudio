# ClippitStudio

Site de Clippit Studio, Worker Cloudflare `clippitstudio`, sur le **même compte**
que le quiz (`quiz-hardcore`). Pour l'instant : une page d'attente statique.

- En ligne : https://clippitstudio.cc et https://www.clippitstudio.cc (domaines
  personnalisés, depuis le 2026-11-09), et
  https://clippitstudio.quiz-hardcore.workers.dev.
- Fichiers servis : `public/`. Pas de `main` : aucun script exécuté, les
  requêtes de fichiers statiques ne comptent pas dans le quota Workers.
- Pas de base D1 pour l'instant. S'il en faut une : `npx wrangler d1 create
  clippitstudio`, jamais celle du quiz.

## Le quiz ne doit jamais être touché

- Ne jamais déployer avec `"name": "quiz-hardcore"` ; toujours lancer wrangler
  **depuis ce dossier**.
- Jamais de `wrangler delete`, ni de `wrangler d1 …` sur la base
  `quiz-hardcore`, ni de `wrangler secret …` qui ne vise pas `clippitstudio`.
- Ne pas renommer le sous-domaine `quiz-hardcore.workers.dev` du compte.
- Domaines personnalisés seulement (`clippitstudio.cc`, `www.clippitstudio.cc`),
  pas de route générique `*.clippitstudio.cc/*` : `quiz.clippitstudio.cc` est
  réservé au quiz.
- Le palier gratuit est partagé : 100 000 requêtes Workers/jour, 5 Go de D1,
  5 tâches cron (le quiz en utilise 1).
- Aucune commande qui crée, modifie ou supprime quelque chose sur Cloudflare
  sans l'accord de l'utilisateur. Il lance lui-même `npx wrangler login` et tape
  les secrets.

## Déployer

```
npx wrangler deploy --name clippitstudio --dry-run
npx wrangler deploy --name clippitstudio
```

Avant : vérifier que le Worker s'appelle `clippitstudio`. wrangler 4.158
n'affiche pas le nom dans la sortie du dry-run : le lire avec
`node -e "console.log(require('wrangler').unstable_readConfig({config:'wrangler.jsonc'}).name)"`.
Le `--name clippitstudio` sur la ligne de commande sert de ceinture de sécurité.

Lancé sans terminal interactif (par Claude), wrangler répond **oui** tout seul
à ses questions de confirmation, y compris « remplacer ces enregistrements DNS /
domaines ? ». Avant d'ajouter un domaine ou une route, vérifier par DoH que le
nom n'a encore aucun enregistrement ; sinon, faire lancer la commande par
l'utilisateur dans un vrai terminal.

Après : vérifier que le quiz va bien —
https://quiz-hardcore.quiz-hardcore.workers.dev répond avec son accueil, et
`npx wrangler deployments list --name quiz-hardcore` montre la même date de
dernier déploiement qu'avant. Si l'un échoue : tout arrêter et prévenir, sans
toucher au quiz.

Le pare-feu Fortinet du réseau habituel bloque les domaines récents (répond
208.91.112.55) : vérifier clippitstudio.cc par
`https://cloudflare-dns.com/dns-query?name=clippitstudio.cc&type=A` avec
`accept: application/dns-json`, ou en 4G.
