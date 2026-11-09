# Installation de clippitstudio pour un membre de l'équipe (Windows).
#
# À coller dans PowerShell (une seule ligne) :
#   irm https://raw.githubusercontent.com/Demonwal51/clippitstudio/main/outils/installer.ps1 -OutFile $env:TEMP\clippit.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\clippit.ps1
#
# On peut la relancer sans risque : ce qui est déjà fait est sauté, le projet
# est mis à jour. Fichier en UTF-8 avec BOM : sans BOM, PowerShell 5.1 lit les
# accents de travers.
# Essais seulement : CLIPPIT_DOSSIER et CLIPPIT_BUREAU remplacent le dossier du
# projet et le bureau.

$ErrorActionPreference = 'Continue'
$DEPOT = 'https://github.com/Demonwal51/clippitstudio.git'
$NODE_MIN = 22   # wrangler 4 exige Node >= 22
$env:WRANGLER_SEND_METRICS = 'false'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

function Etape($texte) { Write-Host ''; Write-Host "=== $texte" -ForegroundColor Cyan }
function Ok($texte) { Write-Host "[OK] $texte" -ForegroundColor Green }
function Info($texte) { Write-Host "     $texte" }
function Attention($texte) { Write-Host "[ATTENTION] $texte" -ForegroundColor Yellow }
function Echec($texte) {
  Write-Host ''
  Write-Host "[ERREUR] $texte" -ForegroundColor Red
  Write-Host 'Corrige ce point, puis relance la même ligne : ce qui est déjà fait sera sauté.'
  exit 1
}

# Après une installation par winget, le PATH de cette fenêtre est périmé.
function RechargerPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $utilisateur = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$utilisateur"
}

function VersionNode {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
  $v = "$(& node -v 2>$null)"
  if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
  return 0
}

function InstallerAvecWinget($id, $nom, $lien) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Echec "$nom manque et winget n'est pas disponible. Installe $nom depuis $lien, ferme PowerShell, rouvre-le, puis relance."
  }
  Info "Installation de $nom avec winget (en acceptant ses conditions d'utilisation)."
  Info 'Windows peut demander une autorisation : accepte-la.'
  & winget install --id $id -e --source winget --accept-package-agreements --accept-source-agreements
  RechargerPath
}

Write-Host 'Installation de clippitstudio' -ForegroundColor Cyan

# --- 1. Git et Node
Etape '1. Git et Node.js'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  InstallerAvecWinget 'Git.Git' 'Git' 'https://git-scm.com/download/win'
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Echec "Git n'est toujours pas trouvé. Ferme PowerShell, rouvre-le, puis relance."
  }
}
Ok "$(& git --version)"

if ((VersionNode) -lt $NODE_MIN) {
  InstallerAvecWinget 'OpenJS.NodeJS.LTS' 'Node.js' 'https://nodejs.org'
  if ((VersionNode) -lt $NODE_MIN) {
    Echec "Il faut Node.js $NODE_MIN ou plus récent. Installe la version LTS depuis https://nodejs.org, ferme PowerShell, rouvre-le, puis relance."
  }
}
Ok "Node.js $(& node -v)"

# --- 2. Identité git (elle signe les modifications envoyées sur GitHub)
Etape '2. Ton identité pour GitHub'
function Demander($cle, $question) {
  $valeur = "$(& git config --global $cle)".Trim()
  for ($essai = 0; -not $valeur -and $essai -lt 3; $essai++) {
    $valeur = "$(Read-Host $question)".Trim()
  }
  if (-not $valeur) { Echec 'Réponse vide : relance et réponds à la question.' }
  & git config --global $cle $valeur
  return $valeur
}
$nom = Demander 'user.name' 'Ton prénom (il signera tes modifications)'
if (-not "$(& git config --global user.email)".Trim()) {
  Info "Le dépôt est public : ton e-mail sera visible dans l'historique."
  Info "Tu peux mettre l'adresse « noreply » de GitHub (github.com > Settings > Emails)."
}
$mail = Demander 'user.email' "L'e-mail de ton compte GitHub"
Ok "$nom <$mail>"

# --- 3. Le projet
Etape '3. Le projet'
$dossier = $env:CLIPPIT_DOSSIER
if (-not $dossier) { $dossier = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'clippitstudio' }

if (Test-Path (Join-Path $dossier '.git')) {
  & git -C $dossier pull --ff-only --quiet
  if ($LASTEXITCODE -eq 0) { Ok "projet mis à jour : $dossier" }
  else { Attention "projet pas mis à jour (modifications en cours ?) : le bouton « Mettre en ligne » s'en chargera." }
} elseif ((Test-Path $dossier) -and (Get-ChildItem -Force $dossier | Select-Object -First 1)) {
  Echec "Le dossier $dossier existe déjà, mais ce n'est pas le projet. Renomme-le, puis relance."
} else {
  & git clone --quiet $DEPOT $dossier
  if ($LASTEXITCODE -ne 0) { Echec "Impossible de copier le projet depuis GitHub (connexion internet ?)." }
  Ok "projet copié dans $dossier"
}
Set-Location $dossier

# npm.cmd et pas npm : PowerShell prendrait npm.ps1, bloqué par la politique
# d'exécution des scripts par défaut.
& npm.cmd ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Echec "L'installation des outils (npm ci) a échoué : lis le message au-dessus." }
Ok 'outils installés (wrangler)'

# --- 4. Cloudflare
Etape '4. Ton compte Cloudflare'
$wrangler = Join-Path $dossier 'node_modules\wrangler\bin\wrangler.js'
& node $wrangler whoami --json *> $null
if ($LASTEXITCODE -ne 0) {
  Info 'Une page Cloudflare va s''ouvrir dans ton navigateur : connecte-toi avec TON compte,'
  Info 'puis clique sur « Allow ». Reviens ensuite ici.'
  & node $wrangler login
  & node $wrangler whoami --json *> $null
  if ($LASTEXITCODE -ne 0) { Echec "La connexion à Cloudflare n'a pas abouti." }
}
# Le droit qui compte : lire le Worker clippitstudio (account_id de wrangler.jsonc).
& node $wrangler deployments list --name clippitstudio --json *> $null
if ($LASTEXITCODE -ne 0) {
  & node $wrangler whoami
  Echec ("Ce compte Cloudflare n'a pas accès au site. Accepte l'invitation de wal (e-mail de Cloudflare), " +
    "ou, si tu es connecté avec un autre compte, lance « npx wrangler logout » dans $dossier. Puis relance.")
}
Ok 'accès au site clippitstudio confirmé'

# --- 5. Raccourcis sur le bureau
Etape '5. Raccourcis sur le bureau'
$bureau = $env:CLIPPIT_BUREAU
if (-not $bureau) { $bureau = [Environment]::GetFolderPath('Desktop') }   # suit OneDrive
$shell = New-Object -ComObject WScript.Shell

$bouton = $shell.CreateShortcut((Join-Path $bureau 'Clippit - Mettre en ligne.lnk'))
$bouton.TargetPath = Join-Path $PSHOME 'powershell.exe'
$bouton.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$dossier\outils\mettre-en-ligne.ps1`""
$bouton.WorkingDirectory = $dossier
$bouton.Description = 'Envoie les modifications de public sur GitHub, puis sur clippitstudio.cc'
$bouton.Save()

$fichiers = $shell.CreateShortcut((Join-Path $bureau 'Clippit - Fichiers du site.lnk'))
$fichiers.TargetPath = Join-Path $dossier 'public'
$fichiers.Description = 'Les fichiers du site (index.html = page d''accueil)'
$fichiers.Save()
Ok "« Clippit - Mettre en ligne » et « Clippit - Fichiers du site » créés"

Write-Host ''
Write-Host 'Installation terminée.' -ForegroundColor Green
Write-Host '- Modifier le site : raccourci « Clippit - Fichiers du site » (index.html = page d''accueil).'
Write-Host '- Mettre en ligne : double-clic sur « Clippit - Mettre en ligne ».'
Write-Host '- Règles et aide : README.md dans le dossier du projet.'
exit 0
