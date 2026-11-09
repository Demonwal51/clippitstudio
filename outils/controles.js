'use strict';
// Règles du garde-fou de mise en ligne. Aucune entrée/sortie ici : tout est
// testable sans réseau (tests/controles.test.js). Ces règles arrêtent les
// accidents ; elles ne protègent pas d'un membre malveillant (voir CLAUDE.md).

const NOM = 'clippitstudio';
const COMPTE = 'aeeb4be461ed38195fefd2e782f23684';  // compte de wal, celui du quiz
const DOMAINES = ['clippitstudio.cc', 'www.clippitstudio.cc'];
const DOSSIER = 'public';

// Tout le reste (main, build, triggers, d1_databases, env, ...) est refusé :
// le site doit rester fait de fichiers statiques, sans code exécuté.
const CLES_AUTORISEES = new Set([
  '$schema', 'name', 'account_id', 'compatibility_date', 'compatibility_flags',
  'assets', 'workers_dev', 'routes',
]);
const CLES_ASSETS = new Set(['directory', 'not_found_handling']);

const MAX_FICHIERS = 20000;               // palier gratuit Workers
const MAX_OCTETS = 25 * 1024 * 1024;      // 25 Mio par fichier
const ALERTE_OCTETS = 1024 * 1024;        // au-delà, la page devient lente

// Fichiers lus par Cloudflare mais jamais servis tels quels.
const FICHIERS_SPECIAUX = new Set(['_headers', '_redirects', '.assetsignore']);

function verifierConfig({ raw, resolu, redirige }) {
  const erreurs = [];
  if (redirige) {
    erreurs.push('wrangler suit une config redirigée (.wrangler/deploy/config.json) : supprime ce fichier.');
  }
  if (!raw || typeof raw !== 'object') return ['wrangler.jsonc est illisible.'];

  for (const cle of Object.keys(raw)) {
    if (!CLES_AUTORISEES.has(cle)) {
      erreurs.push(`Clé interdite dans wrangler.jsonc : "${cle}" (le site doit rester 100 % statique).`);
    }
  }
  if (raw.name !== NOM) {
    erreurs.push(`Le nom du Worker doit être "${NOM}", pas "${raw.name}". Un autre nom pourrait écraser un autre site du compte.`);
  }
  if (resolu && resolu.name !== NOM) {
    erreurs.push(`wrangler résout le nom "${resolu.name}" au lieu de "${NOM}".`);
  }
  if (raw.account_id !== COMPTE) {
    erreurs.push(`"account_id" doit être "${COMPTE}" (le compte de wal), pas "${raw.account_id}".`);
  }
  if (resolu && resolu.main) {
    erreurs.push('Un script ("main") est déclaré : interdit, le site ne sert que des fichiers statiques.');
  }
  if (raw.workers_dev !== true) {
    erreurs.push('"workers_dev" doit rester à true.');
  }

  const a = raw.assets;
  if (!a || typeof a !== 'object') {
    erreurs.push('"assets" manque dans wrangler.jsonc.');
  } else {
    if (String(a.directory).replace(/^\.\//, '').replace(/\/$/, '') !== DOSSIER) {
      erreurs.push(`"assets.directory" doit être "${DOSSIER}".`);
    }
    for (const cle of Object.keys(a)) {
      if (!CLES_ASSETS.has(cle)) erreurs.push(`Clé interdite dans "assets" : "${cle}".`);
    }
  }

  erreurs.push(...verifierRoutes(raw.routes));
  return erreurs;
}

function verifierRoutes(routes) {
  const attendu = `exactement ${DOMAINES.join(' et ')} en domaines personnalisés`;
  if (!Array.isArray(routes)) return [`"routes" doit lister ${attendu}.`];
  const erreurs = [];
  const vus = [];
  for (const r of routes) {
    if (!r || typeof r !== 'object') {
      erreurs.push(`Route invalide : ${JSON.stringify(r)}.`);
      continue;
    }
    const cles = Object.keys(r).sort().join(',');
    if (cles !== 'custom_domain,pattern' || r.custom_domain !== true) {
      erreurs.push(`Route "${r.pattern}" : seule la forme { "pattern": ..., "custom_domain": true } est permise.`);
    }
    if (/[*/]/.test(String(r.pattern))) {
      erreurs.push(`Route "${r.pattern}" : pas de joker ni de chemin (quiz.clippitstudio.cc est réservé au quiz).`);
    }
    vus.push(r.pattern);
  }
  const ok = vus.length === DOMAINES.length && DOMAINES.every((d) => vus.includes(d));
  if (!ok) erreurs.push(`"routes" doit contenir ${attendu}, rien d'autre (trouvé : ${vus.join(', ') || 'rien'}).`);
  return erreurs;
}

// liste : [{ chemin: 'img/logo.webp', octets: 1234 }], chemins relatifs à public/ avec des /
function verifierFichiers(liste) {
  const erreurs = [];
  const alertes = [];
  if (!liste.some((f) => f.chemin === 'index.html')) {
    erreurs.push(`${DOSSIER}/index.html manque : c'est la page d'accueil.`);
  }
  if (liste.length > MAX_FICHIERS) {
    erreurs.push(`${liste.length} fichiers : le palier gratuit en accepte ${MAX_FICHIERS} au plus.`);
  }
  for (const f of liste) {
    if (f.octets > MAX_OCTETS) {
      erreurs.push(`${f.chemin} pèse ${mo(f.octets)} : 25 Mo au plus par fichier.`);
    } else if (f.octets > ALERTE_OCTETS) {
      alertes.push(`${f.chemin} pèse ${mo(f.octets)} : pense à l'alléger (WebP, taille réduite).`);
    }
  }
  return { erreurs, alertes };
}

function mo(octets) {
  return `${(octets / 1024 / 1024).toFixed(1)} Mo`;
}

// Adresse sous laquelle Cloudflare sert un fichier (html_handling par défaut :
// index.html -> /, page.html -> /page). null pour les fichiers jamais servis.
function cheminVersUrl(chemin) {
  const nom = chemin.split('/').pop();
  if (FICHIERS_SPECIAUX.has(nom)) return null;
  let url = chemin;
  if (url === 'index.html') url = '';
  else if (url.endsWith('/index.html')) url = url.slice(0, -'index.html'.length);
  else if (url.endsWith('.html')) url = url.slice(0, -'.html'.length);
  return '/' + url.split('/').map(encodeURIComponent).join('/');
}

// liste : sortie de `wrangler deployments list --json`
function dernierDeploiement(liste) {
  if (!Array.isArray(liste) || liste.length === 0) return null;
  const d = [...liste].sort((x, y) => Date.parse(y.created_on) - Date.parse(x.created_on))[0];
  return { id: d.id, date: d.created_on };
}

// etat : { deploiement: { id, date } | null, limite: bool, accueil: { statut, titreOk } }
// limite = la connexion n'a pas le droit de lire le quiz : c'est un membre
// invité avec un accès limité à clippitstudio, qui ne peut donc pas le modifier non plus.
function comparerQuiz(avant, apres) {
  const erreurs = [];
  if (!apres.accueil || apres.accueil.statut !== 200) {
    erreurs.push(`Le quiz ne répond plus normalement (HTTP ${apres.accueil && apres.accueil.statut}).`);
  } else if (!apres.accueil.titreOk) {
    erreurs.push("La page d'accueil du quiz n'est plus celle du quiz.");
  }
  if (avant.limite && apres.limite) return erreurs;
  if (!avant.deploiement || !apres.deploiement) {
    erreurs.push('Impossible de lire le dernier déploiement du quiz.');
  } else if (avant.deploiement.id !== apres.deploiement.id) {
    erreurs.push(`Le quiz a un nouveau déploiement (${apres.deploiement.date}) : il a peut-être été touché.`);
  }
  return erreurs;
}

// Lignes utiles d'une erreur de wrangler, sans le bruit (journal, bannière).
function resumerErreur(sortie) {
  const lignes = String(sortie)
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /\[code: \d+\]|ERROR|failed|error|exist|denied|forbidden/i.test(l))
    .filter((l) => !/Logs were written|Writing logs/i.test(l));
  return (lignes.length ? lignes : String(sortie).trim().split('\n').slice(-3)).slice(0, 4).join(' | ');
}

// Identifiant de la version téléversée par `wrangler versions upload`.
function extraireVersion(sortie) {
  const m = /Version ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(sortie);
  return m ? m[1] : null;
}

module.exports = {
  NOM, COMPTE, DOMAINES, DOSSIER, FICHIERS_SPECIAUX,
  verifierConfig, verifierRoutes, verifierFichiers, cheminVersUrl,
  dernierDeploiement, comparerQuiz, resumerErreur, extraireVersion,
};
