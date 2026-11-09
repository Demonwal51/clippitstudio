'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../outils/controles');

const bonne = () => ({
  $schema: 'node_modules/wrangler/config-schema.json',
  name: 'clippitstudio',
  account_id: 'aeeb4be461ed38195fefd2e782f23684',
  compatibility_date: '2026-11-01',
  assets: { directory: 'public' },
  workers_dev: true,
  routes: [
    { pattern: 'clippitstudio.cc', custom_domain: true },
    { pattern: 'www.clippitstudio.cc', custom_domain: true },
  ],
});
const verifier = (raw, resolu = { name: raw.name }, redirige = false) =>
  C.verifierConfig({ raw, resolu, redirige });
const contient = (erreurs, motif) =>
  assert.ok(erreurs.some((e) => motif.test(e)), `attendu ${motif} dans ${JSON.stringify(erreurs)}`);

test('la config actuelle passe', () => {
  assert.deepEqual(verifier(bonne()), []);
});

test('le nom quiz-hardcore est refusé', () => {
  const raw = { ...bonne(), name: 'quiz-hardcore' };
  contient(verifier(raw), /doit être "clippitstudio"/);
});

test('un nom résolu différent est refusé', () => {
  contient(verifier(bonne(), { name: 'quiz-hardcore' }), /résout le nom "quiz-hardcore"/);
});

test('un autre compte Cloudflare ou pas de compte est refusé', () => {
  contient(verifier({ ...bonne(), account_id: '0123456789abcdef0123456789abcdef' }), /"account_id" doit être/);
  const sans = bonne();
  delete sans.account_id;
  contient(verifier(sans), /"account_id" doit être/);
});

test('un script main est refusé', () => {
  contient(verifier({ ...bonne(), main: 'src/index.js' }), /Clé interdite.*"main"/);
  contient(verifier(bonne(), { name: 'clippitstudio', main: 'src/index.js' }), /script/);
});

test('une commande build est refusée', () => {
  contient(verifier({ ...bonne(), build: { command: 'curl evil' } }), /"build"/);
});

test('une base D1, un cron ou des environnements sont refusés', () => {
  contient(verifier({ ...bonne(), d1_databases: [{ binding: 'DB', database_name: 'quiz-hardcore' }] }), /"d1_databases"/);
  contient(verifier({ ...bonne(), triggers: { crons: ['0 3 * * *'] } }), /"triggers"/);
  contient(verifier({ ...bonne(), env: { prod: { name: 'quiz-hardcore' } } }), /"env"/);
});

test('une clé inconnue est refusée', () => {
  contient(verifier({ ...bonne(), nimporte: 1 }), /"nimporte"/);
});

test('assets : mauvais dossier ou option inconnue refusés', () => {
  contient(verifier({ ...bonne(), assets: { directory: 'dist' } }), /assets.directory/);
  contient(verifier({ ...bonne(), assets: { directory: 'public', run_worker_first: true } }), /"run_worker_first"/);
  assert.deepEqual(verifier({ ...bonne(), assets: { directory: './public/', not_found_handling: '404-page' } }), []);
});

test('workers_dev doit rester à true', () => {
  contient(verifier({ ...bonne(), workers_dev: false }), /workers_dev/);
});

test('une route joker est refusée', () => {
  const raw = bonne();
  raw.routes.push({ pattern: '*.clippitstudio.cc/*', zone_name: 'clippitstudio.cc' });
  const e = verifier(raw);
  contient(e, /joker/);
  contient(e, /seule la forme/);
});

test('un domaine en moins, en plus ou sans custom_domain est refusé', () => {
  const moins = bonne();
  moins.routes.pop();
  contient(verifier(moins), /doit contenir/);

  const plus = bonne();
  plus.routes.push({ pattern: 'quiz.clippitstudio.cc', custom_domain: true });
  contient(verifier(plus), /doit contenir/);

  const sans = bonne();
  sans.routes[0] = { pattern: 'clippitstudio.cc' };
  contient(verifier(sans), /seule la forme/);

  contient(verifier({ ...bonne(), routes: undefined }), /"routes" doit lister/);
});

test('une config redirigée est refusée', () => {
  contient(verifier(bonne(), undefined, true), /redirigée/);
});

test('fichiers : index.html obligatoire, 25 Mo max, alerte au-delà de 1 Mo', () => {
  const r = C.verifierFichiers([
    { chemin: 'index.html', octets: 3000 },
    { chemin: 'img/gros.png', octets: 2 * 1024 * 1024 },
    { chemin: 'video.mp4', octets: 26 * 1024 * 1024 },
  ]);
  contient(r.erreurs, /video.mp4 pèse 26.0 Mo/);
  contient(r.alertes, /img\/gros.png pèse 2.0 Mo/);
  assert.equal(r.erreurs.length, 1);

  contient(C.verifierFichiers([{ chemin: 'a.html', octets: 1 }]).erreurs, /index.html manque/);
});

test('fichiers : plus de 20 000 refusés', () => {
  const liste = Array.from({ length: 20001 }, (_, i) => ({ chemin: i ? `f${i}` : 'index.html', octets: 1 }));
  contient(C.verifierFichiers(liste).erreurs, /20001 fichiers/);
});

test('adresse servie pour chaque fichier', () => {
  assert.equal(C.cheminVersUrl('index.html'), '/');
  assert.equal(C.cheminVersUrl('equipe/index.html'), '/equipe/');
  assert.equal(C.cheminVersUrl('contact.html'), '/contact');
  assert.equal(C.cheminVersUrl('img/logo-480.webp'), '/img/logo-480.webp');
  assert.equal(C.cheminVersUrl('img/mon logo.png'), '/img/mon%20logo.png');
  assert.equal(C.cheminVersUrl('_headers'), null);
  assert.equal(C.cheminVersUrl('docs/_redirects'), null);
});

test('dernier déploiement = le plus récent, quel que soit l\'ordre', () => {
  const liste = [
    { id: 'b', created_on: '2026-10-20T13:03:02.5924Z' },
    { id: 'c', created_on: '2026-10-19T21:17:14.577955Z' },
    { id: 'a', created_on: '2026-10-20T10:18:33.113639Z' },
  ];
  assert.deepEqual(C.dernierDeploiement(liste), { id: 'b', date: '2026-10-20T13:03:02.5924Z' });
  assert.equal(C.dernierDeploiement([]), null);
});

test('comparerQuiz : rien ne change -> aucune erreur', () => {
  const etat = { deploiement: { id: 'x', date: 'd' }, accueil: { statut: 200, titreOk: true } };
  assert.deepEqual(C.comparerQuiz(etat, structuredClone(etat)), []);
});

test('comparerQuiz : accès limité des deux côtés -> seul l\'accueil compte', () => {
  const limite = { deploiement: null, limite: true, accueil: { statut: 200, titreOk: true } };
  assert.deepEqual(C.comparerQuiz(limite, structuredClone(limite)), []);
  contient(C.comparerQuiz(limite, { ...limite, accueil: { statut: 502, titreOk: false } }), /HTTP 502/);
  // limitée avant mais plus après : incohérent, donc erreur
  contient(C.comparerQuiz(limite, { ...limite, limite: false }), /Impossible de lire/);
});

test('résumé d\'erreur : garde le message, retire le chemin du journal', () => {
  const sortie = '\x1b[31mX [ERROR] A request to the Cloudflare API failed.\x1b[0m\n'
    + '  This Worker does not exist on your account. [code: 10007]\n'
    + '🪵  Logs were written to "/home/runner/.config/.wrangler/logs/x.log"\n';
  const r = C.resumerErreur(sortie);
  assert.match(r, /\[code: 10007\]/);
  assert.match(r, /\[ERROR\] A request/);
  assert.doesNotMatch(r, /Logs were written/);
});

test('identifiant de version extrait de la sortie de versions upload', () => {
  const sortie = 'Uploaded clippitstudio (2.1 sec)\nWorker Version ID: 14cc4e7e-bf07-4e07-bddc-2aa34de000b5\nVersion Preview URL: https://x';
  assert.equal(C.extraireVersion(sortie), '14cc4e7e-bf07-4e07-bddc-2aa34de000b5');
  assert.equal(C.extraireVersion('--dry-run: exiting now.'), null);
});

test('comparerQuiz : nouveau déploiement, page en panne ou différente', () => {
  const avant = { deploiement: { id: 'x', date: 'd1' }, accueil: { statut: 200, titreOk: true } };
  contient(C.comparerQuiz(avant, { ...avant, deploiement: { id: 'y', date: 'd2' } }), /nouveau déploiement/);
  contient(C.comparerQuiz(avant, { ...avant, accueil: { statut: 500, titreOk: false } }), /HTTP 500/);
  contient(C.comparerQuiz(avant, { ...avant, accueil: { statut: 200, titreOk: false } }), /n'est plus celle du quiz/);
  contient(C.comparerQuiz(avant, { ...avant, deploiement: null }), /Impossible de lire/);
});
