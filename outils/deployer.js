#!/usr/bin/env node
'use strict';
// Garde-fou de mise en ligne de clippitstudio.
//
//   npm run verifier                  contrôles du projet, sans réseau
//   node outils/deployer.js --essai   tout, mais "deploy --dry-run" : rien n'est envoyé
//   npm run deployer                  mise en ligne (lancée par GitHub Actions à chaque push sur main)
//
// Le quiz (Worker quiz-hardcore) vit sur le même compte Cloudflare : on relève
// son état avant, on le compare après, et on s'arrête net s'il a bougé.
// La mise en ligne passe par `versions upload` + `versions deploy`, qui ne
// touchent ni aux domaines ni aux routes : la clé de GitHub Actions peut rester
// limitée au seul Worker clippitstudio, sans aucun droit sur la zone.

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const { spawn, spawnSync } = require('node:child_process');
const C = require('./controles');

const RACINE = path.resolve(__dirname, '..');
process.chdir(RACINE); // wrangler ne doit jamais lire une autre config que la nôtre

const ARGS = new Set(process.argv.slice(2));
const MODE = ARGS.has('--verifier') ? 'verifier' : ARGS.has('--essai') ? 'essai' : 'deployer';
const EN_CI = Boolean(process.env.GITHUB_ACTIONS || process.env.CI);
const BRANCHE_CI = process.env.GITHUB_REF_NAME || '';
const COMMIT_CI = (process.env.GITHUB_SHA || '').slice(0, 7);
const CONFIG = 'wrangler.jsonc';
const WRANGLER = path.join(RACINE, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const QUIZ = {
  nom: 'quiz-hardcore',
  hote: 'quiz-hardcore.quiz-hardcore.workers.dev',
  titre: 'Quiz Hardcore',
};
const WORKERS_DEV = 'clippitstudio.quiz-hardcore.workers.dev';
const DELAI_PROPAGATION_MS = 60000;

class Arret extends Error {}
const arreter = (lignes) => { throw new Arret([].concat(lignes).join('\n')); };
const etape = (titre) => console.log(`\n=== ${titre}`);
const ok = (m) => console.log(`[OK] ${m}`);
const attention = (m) => console.log(`[ATTENTION] ${m}`);
const erreur = (m) => console.log(`[ERREUR] ${m}`);
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const empreinte = (octets) => crypto.createHash('sha256').update(octets).digest('hex');

// ---------- 1. Projet ----------

function listerFichiers(dossier, prefixe = '') {
  const liste = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const absolu = path.join(dossier, e.name);
    const chemin = prefixe + e.name;
    if (e.isDirectory()) liste.push(...listerFichiers(absolu, chemin + '/'));
    else if (e.isFile()) liste.push({ chemin, absolu, octets: fs.statSync(absolu).size });
  }
  return liste;
}

function controlerProjet() {
  etape('1. Contrôles du projet');
  if (!fs.existsSync(WRANGLER)) arreter('[ERREUR] wrangler n\'est pas installé : lance "npm ci".');
  for (const autre of ['wrangler.toml', 'wrangler.json']) {
    if (fs.existsSync(autre)) arreter(`[ERREUR] ${autre} existe en plus de wrangler.jsonc : supprime-le.`);
  }

  const w = require(path.join(RACINE, 'node_modules', 'wrangler'));
  const lu = w.experimental_readRawConfig({ config: CONFIG });
  const resolu = w.unstable_readConfig({ config: CONFIG });
  const erreursConfig = C.verifierConfig({ raw: lu.rawConfig, resolu, redirige: lu.redirected });
  if (erreursConfig.length) arreter(erreursConfig.map((e) => `[ERREUR] ${e}`));
  ok(`wrangler.jsonc : Worker "${C.NOM}", fichiers statiques seulement, domaines ${C.DOMAINES.join(' et ')}`);

  const fichiers = listerFichiers(path.join(RACINE, C.DOSSIER));
  const { erreurs, alertes } = C.verifierFichiers(fichiers);
  alertes.forEach(attention);
  if (erreurs.length) arreter(erreurs.map((e) => `[ERREUR] ${e}`));
  const total = fichiers.reduce((s, f) => s + f.octets, 0);
  ok(`${fichiers.length} fichiers dans ${C.DOSSIER}/ (${(total / 1024).toFixed(0)} Ko)`);
  return fichiers;
}

function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function controlerGit() {
  const etat = git('status', '--porcelain');
  if (etat === null) return attention('git indisponible : modifications non vérifiées.');
  if (etat) {
    arreter(['[ERREUR] Des modifications ne sont pas commitées :', etat,
      'Commite-les et pousse-les sur GitHub avant de mettre en ligne.']);
  }
  const head = git('rev-parse', 'HEAD');
  const distant = git('rev-parse', '--verify', '--quiet', 'origin/main');
  if (!distant) attention("Pas de branche origin/main : ce que tu mets en ligne n'est pas sur GitHub.");
  else if (head !== distant) attention('HEAD diffère de origin/main : le prochain push de quelqu\'un remplacera cette version.');
}

async function confirmer(question) {
  if (ARGS.has('--oui')) return true;
  if (!process.stdin.isTTY) arreter('[ERREUR] Pas de terminal pour confirmer : relance avec --oui si tu es sûr.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const reponse = await rl.question(question);
  rl.close();
  return /^o(ui)?$/i.test(reponse.trim());
}

// ---------- wrangler et réseau ----------

// stdin fermé : wrangler est non interactif et répondrait seul à ses questions.
// On repère ce cas dans sa sortie ("fallback value").
function wrangler(args, { afficher = true } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: RACINE,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    let sortie = '';
    let erreurs = '';
    p.stdout.on('data', (d) => { sortie += d; if (afficher) process.stdout.write(d); });
    p.stderr.on('data', (d) => { erreurs += d; if (afficher) process.stderr.write(d); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, sortie, erreurs }));
  });
}

// GET en HTTPS ; avec ip, on se connecte à cette adresse en gardant le bon nom
// (SNI, certificat, Host) : contourne un DNS local qui bloque le domaine.
function obtenir(hote, chemin, ip, entetes = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: ip || hote,
      servername: net.isIP(hote) ? undefined : hote,
      port: 443,
      path: chemin,
      method: 'GET',
      headers: { host: hote, 'user-agent': 'clippitstudio-deployer', 'cache-control': 'no-cache', ...entetes },
      timeout: 15000,
    }, (res) => {
      const morceaux = [];
      res.on('data', (c) => morceaux.push(c));
      res.on('end', () => resolve({ statut: res.statusCode, corps: Buffer.concat(morceaux) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
    req.end();
  });
}

// DNS public de Cloudflare en DoH : le pare-feu du réseau local peut bloquer
// les domaines récents (il répond 208.91.112.55). On le joint par son adresse,
// 1.1.1.1 : ce même réseau détourne aussi le nom cloudflare-dns.com.
async function resoudre(nom) {
  const r = await obtenir('1.1.1.1', `/dns-query?name=${encodeURIComponent(nom)}&type=A`, null,
    { accept: 'application/dns-json' });
  if (r.statut !== 200) throw new Error(`DNS public injoignable (HTTP ${r.statut})`);
  const j = JSON.parse(r.corps.toString('utf8'));
  const ip = (j.Answer || []).find((a) => a.type === 1);
  if (!ip) throw new Error(`${nom} n'a aucune adresse dans le DNS public`);
  return ip.data;
}

async function enParallele(taches, largeur, travail) {
  const resultats = new Array(taches.length);
  let suivant = 0;
  const ouvriers = Array.from({ length: Math.min(largeur, taches.length) }, async () => {
    while (suivant < taches.length) {
      const i = suivant++;
      resultats[i] = await travail(taches[i]);
    }
  });
  await Promise.all(ouvriers);
  return resultats;
}

// ---------- 2 et 4. Le quiz ----------

// API Cloudflare appelée directement avec la clé de la CI : on obtient le code
// HTTP exact, là où wrangler se contente parfois de « la requête a échoué ».
async function apiCloudflare(chemin) {
  const r = await obtenir('api.cloudflare.com', `/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}${chemin}`, null, {
    authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
    accept: 'application/json',
  });
  let json = null;
  try { json = JSON.parse(r.corps.toString('utf8')); } catch { /* pas du JSON */ }
  const erreurs = ((json && json.errors) || []).map((e) => `${e.message} [code: ${e.code}]`).join(' ; ');
  return { statut: r.statut, json, resume: `HTTP ${r.statut}${erreurs ? ` : ${erreurs}` : ''}` };
}

async function verifierCle() {
  const r = await apiCloudflare('/tokens/verify');
  const actif = r.statut === 200 && r.json && r.json.success && r.json.result && r.json.result.status === 'active';
  if (!actif) {
    arreter(`[ERREUR] Cloudflare refuse la clé CLOUDFLARE_API_TOKEN (${r.resume}) : recolle-la dans les réglages du dépôt GitHub. Rien n'a été envoyé.`);
  }
  ok('clé Cloudflare valide');
}

// En CI : 401/403/404 avec une clé valide = le quiz est invisible pour elle,
// donc elle est limitée à clippitstudio. Toute autre réponse est une erreur.
async function deploiementsQuizCI() {
  const r = await apiCloudflare(`/workers/scripts/${QUIZ.nom}/deployments`);
  if (r.statut === 200 && r.json && r.json.result) {
    const liste = Array.isArray(r.json.result) ? r.json.result : r.json.result.deployments;
    return { deploiement: C.dernierDeploiement(liste), limite: false, diagnostic: '' };
  }
  return { deploiement: null, limite: [401, 403, 404].includes(r.statut), diagnostic: r.resume };
}

// En local : ta connexion wrangler, qui voit tout le compte. Un refus y est une erreur.
async function deploiementsQuizLocal() {
  const r = await wrangler(['deployments', 'list', '--name', QUIZ.nom, '--json'], { afficher: false });
  let deploiement = null;
  if (r.code === 0) {
    try { deploiement = C.dernierDeploiement(JSON.parse(r.sortie)); } catch { /* sortie illisible */ }
  }
  return { deploiement, limite: false, diagnostic: r.code === 0 ? '' : C.resumerErreur(r.erreurs + '\n' + r.sortie) };
}

async function etatQuiz() {
  const { deploiement, limite, diagnostic } = EN_CI ? await deploiementsQuizCI() : await deploiementsQuizLocal();
  let accueil;
  try {
    const page = await obtenir(QUIZ.hote, '/');
    accueil = { statut: page.statut, titreOk: page.corps.toString('utf8').includes(QUIZ.titre) };
  } catch (e) {
    accueil = { statut: 0, titreOk: false, detail: e.message };
  }
  return { deploiement, limite, accueil, diagnostic };
}

// ---------- 5. Le site en ligne ----------

async function verifierEnLigne(fichiers, strict) {
  const ips = {};
  for (const d of C.DOMAINES) ips[d] = await resoudre(d);
  ok(`DNS public : ${C.DOMAINES.map((d) => `${d} -> ${ips[d]}`).join(', ')}`);

  const cibles = fichiers
    .map((f) => ({ ...f, url: C.cheminVersUrl(f.chemin) }))
    .filter((f) => f.url)
    .map((f) => ({ ...f, attendu: empreinte(fs.readFileSync(f.absolu)) }));
  let restants = [];
  for (const hote of [...C.DOMAINES, WORKERS_DEV]) {
    for (const f of cibles) restants.push({ hote, f });
  }
  const total = restants.length;
  const fin = Date.now() + (strict ? DELAI_PROPAGATION_MS : 0);

  for (;;) {
    const verdicts = await enParallele(restants, 6, async (t) => {
      try {
        const r = await obtenir(t.hote, `${t.f.url}?verif=${Date.now()}`, ips[t.hote]);
        const bon = r.statut === 200 && empreinte(r.corps) === t.f.attendu;
        return { ...t, bon, statut: r.statut };
      } catch (e) {
        return { ...t, bon: false, statut: 0, detail: e.message };
      }
    });
    restants = verdicts.filter((v) => !v.bon);
    if (!restants.length || Date.now() >= fin) break;
    console.log(`     ${restants.length} fichier(s) pas encore à jour, nouvel essai dans 5 s...`);
    await attendre(5000);
  }

  // Cloudflare peut réécrire le HTML sur un domaine (ex. protection des
  // adresses e-mail) : toléré si la page arrive bien et que workers.dev est exact.
  const exactsWorkersDev = new Set(cibles.map((f) => f.chemin));
  for (const v of restants) if (v.hote === WORKERS_DEV) exactsWorkersDev.delete(v.f.chemin);
  const problemes = [];
  for (const v of restants) {
    const domaine = C.DOMAINES.includes(v.hote);
    const message = `https://${v.hote}${v.f.url} : ${v.statut ? `HTTP ${v.statut}` : v.detail}${v.statut === 200 ? ', contenu différent de public/' : ''}`;
    if (domaine && v.statut === 200 && v.f.chemin.endsWith('.html') && exactsWorkersDev.has(v.f.chemin)) {
      attention(`${message} (HTML réécrit par Cloudflare ? workers.dev est exact)`);
    } else if (!strict) {
      attention(message);
    } else {
      erreur(message);
      problemes.push(message);
    }
  }
  if (!strict && restants.length) {
    info('Le site en ligne diffère de public/ : normal si public/ contient des changements pas encore en ligne.');
  }
  const bons = total - restants.length;
  ok(`${bons}/${total} vérifications identiques à public/ (${cibles.length} fichiers x ${C.DOMAINES.length + 1} adresses)`);
  return problemes;
}

function info(m) { console.log(`     ${m}`); }

// ---------- Déroulé ----------

async function principal() {
  const contexte = EN_CI ? ` (GitHub Actions, branche ${BRANCHE_CI || '?'}, commit ${COMMIT_CI || '?'})` : '';
  console.log(`clippitstudio : ${MODE}${contexte}`);

  const fichiers = controlerProjet();
  if (MODE === 'verifier') {
    console.log("\nContrôles OK. Rien n'a été envoyé.");
    return 0;
  }

  if (EN_CI) {
    if (BRANCHE_CI !== 'main') arreter(`[ERREUR] Branche "${BRANCHE_CI}" : seule main est mise en ligne.`);
    for (const nom of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
      // Un copier-coller dans GitHub garde souvent le retour à la ligne final,
      // que l'en-tête HTTP refuse : on l'enlève. wrangler hérite de cet env.
      const valeur = (process.env[nom] || '').trim();
      if (!valeur) arreter(`[ERREUR] ${nom} absent des réglages du dépôt GitHub : préviens wal.`);
      if (/\s/.test(valeur)) {
        arreter(`[ERREUR] ${nom} contient un espace ou un retour à la ligne au milieu : recolle-le dans les réglages du dépôt GitHub.`);
      }
      process.env[nom] = valeur;
    }
  }
  if (MODE === 'deployer' && !EN_CI) {
    controlerGit();
    if (!(await confirmer(`\nMettre en ligne sur ${C.DOMAINES.join(' et ')} ? (o/N) `))) {
      console.log("Annulé : rien n'a été envoyé.");
      return 0;
    }
  }

  etape('2. État de référence du quiz');
  if (EN_CI) await verifierCle();
  const avant = await etatQuiz();
  if (avant.limite) {
    ok('la clé ne voit pas le quiz : elle est limitée à clippitstudio, donc ne peut pas le modifier non plus');
    info(`(réponse de Cloudflare : ${avant.diagnostic})`);
  } else if (!avant.deploiement) {
    arreter(`[ERREUR] Impossible de lire les déploiements du quiz (${avant.diagnostic}). Rien n'a été envoyé.`);
  } else {
    ok(`quiz-hardcore : déploiement ${avant.deploiement.id.slice(0, 8)} du ${avant.deploiement.date}`);
  }
  if (avant.accueil.statut !== 200 || !avant.accueil.titreOk) {
    arreter(`[ERREUR] Le quiz ne répond déjà pas normalement (HTTP ${avant.accueil.statut}). Rien n'a été envoyé : préviens wal.`);
  }
  ok("page d'accueil du quiz en ligne");

  // Deux temps : téléverser une version, puis la mettre en service à 100 %.
  // Aucun des deux ne touche aux domaines, déjà rattachés une fois pour toutes.
  etape(MODE === 'essai' ? "3. Essai (--dry-run) : rien n'est envoyé" : '3. Mise en ligne');
  const cible = ['--config', CONFIG, '--name', C.NOM];
  const envoi = await wrangler(['versions', 'upload', ...cible, ...(MODE === 'essai' ? ['--dry-run'] : [])]);
  let sorties = envoi.sortie + envoi.erreurs;
  let echec = envoi.code !== 0 ? `wrangler versions upload a échoué (code ${envoi.code}, voir plus haut).` : null;
  let version = null;
  if (!echec && MODE !== 'essai') {
    version = C.extraireVersion(sorties);
    if (!version) {
      echec = 'identifiant de la version téléversée introuvable dans la sortie de wrangler.';
    } else {
      const message = `GitHub ${COMMIT_CI || git('rev-parse', '--short', 'HEAD') || '?'}`;
      const bascule = await wrangler(['versions', 'deploy', `${version}@100%`, ...cible, '--yes', '--message', message]);
      sorties += bascule.sortie + bascule.erreurs;
      if (bascule.code !== 0) echec = `wrangler versions deploy a échoué (code ${bascule.code}, voir plus haut).`;
    }
  }
  const problemes = [];
  if (/fallback value/i.test(sorties)) {
    const m = 'wrangler a répondu OUI tout seul à une question (voir plus haut) : vérifie dans le tableau de bord ce qui a été remplacé.';
    erreur(m);
    problemes.push(m);
  }
  if (echec) {
    erreur(echec);
    problemes.push(echec);
  } else {
    ok(MODE === 'essai' ? 'dry-run réussi' : `en ligne, version ${version}`);
  }

  // Toujours, même si l'envoi a échoué : il a pu faire quelque chose avant.
  etape("4. Le quiz n'a pas bougé ?");
  const apres = await etatQuiz();
  const erreursQuiz = C.comparerQuiz(avant, apres);
  if (erreursQuiz.length) {
    arreter([
      ...erreursQuiz.map((e) => `[ERREUR] ${e}`),
      '',
      '!!! ARRÊT : ne tente PAS de réparer le quiz. Préviens wal tout de suite. !!!',
    ]);
  }
  ok(apres.deploiement
    ? `quiz-hardcore : toujours le déploiement ${apres.deploiement.id.slice(0, 8)}, accueil en ligne`
    : "quiz-hardcore : accueil en ligne (déploiements illisibles pour cette clé limitée)");

  if (echec) return 1;

  etape(MODE === 'essai' ? '5. Le site en ligne (comparaison simple)' : '5. Le site en ligne est-il à jour ?');
  problemes.push(...await verifierEnLigne(fichiers, MODE === 'deployer'));

  if (problemes.length) return 1;
  console.log(MODE === 'essai'
    ? "\nEssai réussi. Rien n'a été envoyé."
    : `\nEn ligne : ${C.DOMAINES.map((d) => `https://${d}`).join('  ')}`);
  return 0;
}

principal().then(
  (code) => { process.exitCode = code; if (code) console.log('\nÉCHEC.'); },
  (e) => {
    console.log(e instanceof Arret
      ? `\n${e.message}`
      : `\n[ERREUR] ${e.message}${e.cause ? ` (${e.cause.message || e.cause})` : ''}`);
    console.log('\nÉCHEC.');
    process.exitCode = 1;
  },
);
