#!/usr/bin/env node
'use strict';
// Garde-fou de mise en ligne de clippitstudio.
//
//   npm run verifier                  contrôles du projet, sans réseau
//   node outils/deployer.js --essai   tout, mais "deploy --dry-run" : rien n'est envoyé
//   npm run deployer                  mise en ligne (commande de Workers Builds)
//
// Le quiz (Worker quiz-hardcore) vit sur le même compte Cloudflare : on relève
// son état avant, on le compare après, et on s'arrête net s'il a bougé.

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
const EN_CI = Boolean(process.env.WORKERS_CI || process.env.CI);
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

async function etatQuiz() {
  const r = await wrangler(['deployments', 'list', '--name', QUIZ.nom, '--json'], { afficher: false });
  let deploiement = null;
  if (r.code === 0) {
    try { deploiement = C.dernierDeploiement(JSON.parse(r.sortie)); } catch { /* sortie illisible */ }
  }
  let accueil;
  try {
    const page = await obtenir(QUIZ.hote, '/');
    accueil = { statut: page.statut, titreOk: page.corps.toString('utf8').includes(QUIZ.titre) };
  } catch (e) {
    accueil = { statut: 0, titreOk: false, detail: e.message };
  }
  const diagnostic = (r.erreurs || r.sortie).trim().split('\n').slice(-3).join(' ');
  return { deploiement, accueil, diagnostic };
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
  const contexte = EN_CI
    ? ` (Workers Builds, branche ${process.env.WORKERS_CI_BRANCH || '?'}, commit ${(process.env.WORKERS_CI_COMMIT_SHA || '?').slice(0, 7)})`
    : '';
  console.log(`clippitstudio : ${MODE}${contexte}`);

  const fichiers = controlerProjet();
  if (MODE === 'verifier') {
    console.log("\nContrôles OK. Rien n'a été envoyé.");
    return 0;
  }

  if (EN_CI && process.env.WORKERS_CI_BRANCH && process.env.WORKERS_CI_BRANCH !== 'main') {
    arreter(`[ERREUR] Branche "${process.env.WORKERS_CI_BRANCH}" : seule main est mise en ligne.`);
  }
  if (MODE === 'deployer' && !EN_CI) {
    controlerGit();
    if (!(await confirmer(`\nMettre en ligne sur ${C.DOMAINES.join(' et ')} ? (o/N) `))) {
      console.log("Annulé : rien n'a été envoyé.");
      return 0;
    }
  }

  etape('2. État de référence du quiz');
  const avant = await etatQuiz();
  if (!avant.deploiement) {
    arreter(`[ERREUR] Impossible de lire les déploiements du quiz (${avant.diagnostic}). Rien n'a été envoyé.`);
  }
  if (avant.accueil.statut !== 200 || !avant.accueil.titreOk) {
    arreter(`[ERREUR] Le quiz ne répond déjà pas normalement (HTTP ${avant.accueil.statut}). Rien n'a été envoyé : préviens wal.`);
  }
  ok(`quiz-hardcore : déploiement ${avant.deploiement.id.slice(0, 8)} du ${avant.deploiement.date}, accueil en ligne`);

  etape(MODE === 'essai' ? "3. Essai (--dry-run) : rien n'est envoyé" : '3. Mise en ligne');
  const args = ['deploy', '--config', CONFIG, '--name', C.NOM];
  if (MODE === 'essai') args.push('--dry-run');
  const envoi = await wrangler(args);
  const problemes = [];
  if (/fallback value/i.test(envoi.sortie + envoi.erreurs)) {
    const m = 'wrangler a répondu OUI tout seul à une question (voir plus haut) : vérifie dans le tableau de bord ce qui a été remplacé.';
    erreur(m);
    problemes.push(m);
  }
  if (envoi.code !== 0) {
    const m = `wrangler deploy a échoué (code ${envoi.code}, voir plus haut).`;
    erreur(m);
    problemes.push(m);
  } else {
    const version = /Current Version ID:\s*(\S+)/.exec(envoi.sortie);
    ok(MODE === 'essai' ? 'dry-run réussi' : `en ligne, version ${version ? version[1] : '?'}`);
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
  ok(`quiz-hardcore : toujours le déploiement ${apres.deploiement.id.slice(0, 8)}, accueil en ligne`);

  if (envoi.code !== 0) return 1;

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
