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
- Guide de l'équipe : `README.md`.

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
  les secrets. Demander aussi avant chaque push.

## Mise en ligne

L'équipe pousse sur `main` (dépôt GitHub public) ; Workers Builds (intégration
GitHub de Cloudflare, reliée au seul Worker `clippitstudio`) lance
`npm run deployer`, c'est-à-dire `outils/deployer.js`, le garde-fou :

1. contrôles du projet (`outils/controles.js`) : nom `clippitstudio`, liste
   blanche de clés dans `wrangler.jsonc` (pas de `main`, `build`, D1, cron,
   `env`…), exactement les deux domaines personnalisés, limites de fichiers ;
2. référence du quiz : dernier déploiement (`deployments list --json`) et page
   d'accueil ;
3. `wrangler deploy --config wrangler.jsonc --name clippitstudio` ;
4. le quiz n'a pas bougé, sinon ARRÊT : ne pas réparer, prévenir ;
5. empreinte SHA-256 de chaque fichier servi sur les deux domaines et sur
   workers.dev, égale à celle de `public/` (nouvelles tentatives pendant 60 s).

Modes : `npm run verifier` (étape 1 seulement), `node outils/deployer.js
--essai` (tout, avec `--dry-run` ; rien n'est envoyé), `npm run deployer` en
local (refuse si des modifications ne sont pas commitées, demande o/N, `--oui`
sans terminal). Tests : `npm test` (`node --test`, sans dépendance). Un
défaut corrigé = un test de plus dans `tests/controles.test.js`.

Réglages Workers Builds à conserver : branche `main`, build `npm ci`,
déploiement `npm run deployer`, **builds des autres branches désactivés**. Ne
jamais supprimer le jeton « Workers Builds » créé par Cloudflare.

**Risque accepté par l'utilisateur le 2026-11-09** : les membres poussent sur
`main` sans validation. La clé de Workers Builds vaut pour tout le compte (une
clé Workers ne peut pas être limitée à un Worker) : un membre malveillant, ou
un compte piraté, pourrait toucher au quiz. Le garde-fou n'arrête que les
accidents. Parade possible plus tard : protéger `main` (pull request validée
par l'utilisateur), gratuit sur un dépôt public.

## Pièges

- wrangler 4.158 n'affiche pas le nom du Worker dans la sortie du dry-run :
  le garde-fou le lit avec `unstable_readConfig`.
- Lancé sans terminal interactif (Claude, Workers Builds), wrangler répond
  **oui** tout seul à ses questions de confirmation, y compris « remplacer ces
  enregistrements DNS / domaines ? ». Le garde-fou repère « fallback value »
  dans la sortie. Avant d'ajouter un domaine, vérifier par DoH qu'il n'a
  encore aucun enregistrement.
- Charger wrangler dans le processus (`require('wrangler')`) remplace le
  client de `fetch()`, qui échoue alors sur ce réseau : le garde-fou n'utilise
  que `node:https`.
- Le pare-feu Fortinet du réseau habituel bloque les domaines récents (répond
  208.91.112.55), et son résolveur détourne aussi `cloudflare-dns.com`
  (vers `::1` / `13.37.118.35`). Vérifier par
  `https://1.1.1.1/dns-query?name=clippitstudio.cc&type=A` avec
  `accept: application/dns-json`, puis se connecter à l'IP obtenue en gardant
  le nom (SNI) ; ou tester en 4G.
- Après chaque mise en ligne faite à la main, vérifier aussi le quiz
  (https://quiz-hardcore.quiz-hardcore.workers.dev et
  `npx wrangler deployments list --name quiz-hardcore`) : le garde-fou le fait
  déjà.
