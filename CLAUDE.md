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

Manuelle, depuis le PC de chacun : `git push` sur `main` du dépôt public
https://github.com/Demonwal51/clippitstudio, puis `npm run deployer`, c'est-à-dire
`outils/deployer.js`, le garde-fou :

1. contrôles du projet (`outils/controles.js`) : nom `clippitstudio`,
   `account_id` du compte de l'utilisateur, liste blanche de clés dans
   `wrangler.jsonc` (pas de `main`, `build`, D1, cron, `env`…), exactement les
   deux domaines personnalisés, limites de fichiers ;
2. référence du quiz : dernier déploiement (`wrangler deployments list
   --json`) et page d'accueil. Si le quiz est illisible mais que
   `clippitstudio` se lit avec la même connexion, c'est un membre à accès
   limité : seule la page d'accueil est alors comparée ;
3. `versions upload` puis `versions deploy <id>@100% --yes`, avec `--config
   wrangler.jsonc --name clippitstudio`. Ces commandes ne touchent pas aux
   domaines : aucun droit sur la zone n'est nécessaire. Pour changer de
   domaines, il faut un `wrangler deploy` lancé par l'utilisateur ou avec son
   accord ;
4. le quiz n'a pas bougé, sinon ARRÊT : ne pas réparer, prévenir ;
5. empreinte SHA-256 de chaque fichier servi sur les deux domaines et sur
   workers.dev, égale à celle de `public/` (nouvelles tentatives pendant 60 s).

Modes : `npm run verifier` (étape 1 seulement), `node outils/deployer.js
--essai` (tout, avec `--dry-run` ; rien n'est envoyé), `npm run deployer`
(refuse si des modifications ne sont pas commitées, demande o/N, `--oui` sans
terminal). Tests : `npm test` (`node --test`, sans dépendance). Un défaut
corrigé = un test de plus dans `tests/controles.test.js`.

Accès de l'équipe : chaque membre est **invité dans le compte Cloudflare**
(Manage Account → Members), avec un accès limité au Worker `clippitstudio`,
rôle Editor (met en ligne, ne supprime pas). Il se connecte avec son propre
compte (`npx wrangler login`) et ne voit ni le quiz, ni sa base D1, ni les
zones. Ne jamais donner Admin ni un accès à tout le compte. Sur GitHub, il
est collaborateur (Write) pour pouvoir pousser.

Pour les membres sous Windows, « Clippit Studio », sans aucune question à
taper (choix du 2026-11-09 : « vraiment simple ») :
- `outils/installer.ps1`, lancé par la ligne `irm … -OutFile` du README :
  installe Git et Node ≥ 22 par winget, clone dans `Documents\clippitstudio`,
  pose une identité git **locale au dépôt** s'il n'y en a pas de globale,
  `npm ci`, `wrangler login`, vérifie l'accès (`deployments list --name
  clippitstudio`), connecte GitHub et vérifie le droit d'envoi (`git push
  --dry-run`), crée l'icône « Clippit Studio », puis ouvre l'appli ;
- `outils/clippit-studio.ps1`, la fenêtre WinForms : `git pull --ff-only` à
  l'ouverture, puis quatre boutons (dossier `public`, aperçu
  `public\index.html`, mettre en ligne avec confirmation Oui/Non, site en
  ligne) et un journal en couleur. Les processus sont lus par
  `ReadLineAsync()` + `Windows.Forms.Timer` : un scriptblock branché sur
  `OutputDataReceived` tournerait sur un autre fil et planterait ;
- `outils/mettre-en-ligne.ps1`, le moteur : refuse les changements hors de
  `public/`, commit (message automatique), `pull --rebase` (`npm ci` si
  `package-lock.json` a changé), `push`, puis `deployer.js` (`--oui` quand
  `CLIPPIT_FENETRE=1`, posé par la fenêtre). `CLIPPIT_ESSAI=1` : sans push,
  avec `--essai` ;
- `outils/clippit.ico` : généré depuis `public/img/logo-960.webp` (Pillow).

Tests : `CLIPPIT_DOSSIER`, `CLIPPIT_BUREAU`, `CLIPPIT_SANS_PAUSE` et
`CLIPPIT_AUTOTEST=<png>` (la fenêtre fait un essai, s'enregistre en image et
se ferme), plus `GIT_CONFIG_GLOBAL` vers un fichier jetable, pour ne pas
toucher la config git de l'utilisateur, qui n'a pas d'identité globale sur
DEMONWAL.

Le déploiement automatique (GitHub Actions avec une clé limitée à
clippitstudio, puis Workers Builds, dont la clé vaut pour tout le compte) a
été abandonné le 2026-11-09 : plus de workflow, de secret ni de clé CI.

Pas de validation des push : tout membre qui écrit sur `main` peut changer le
site. Au pire, il touche clippitstudio, jamais le quiz. Parade possible plus
tard : protéger `main` (pull request validée par l'utilisateur), gratuit sur
un dépôt public.

## Pièges

- wrangler 4.158 n'affiche pas le nom du Worker dans la sortie du dry-run :
  le garde-fou le lit avec `unstable_readConfig`.
- Lancé sans terminal interactif (Claude, `--oui`), wrangler répond
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
- Scripts PowerShell (`outils/*.ps1`) : UTF-8 **avec BOM** (sinon
  PowerShell 5.1 lit les accents de travers ; Write et Edit l'enlèvent,
  le remettre après chaque modification) et fins de ligne CRLF
  (`.gitattributes`). Appeler `npm.cmd`, jamais `npm` : PowerShell prendrait
  `npm.ps1`, bloqué par la politique d'exécution. Le script se lance par
  `-File` après téléchargement, et non par `irm | iex`, pour garder le BOM et
  contourner cette politique.
