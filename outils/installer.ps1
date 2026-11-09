# Installation de Clippit Studio pour un membre de l'équipe (Windows).
#
# À coller dans PowerShell (une seule ligne) :
#   irm https://raw.githubusercontent.com/Demonwal51/clippitstudio/main/outils/installer.ps1 -OutFile $env:TEMP\clippit.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\clippit.ps1
#
# Aucune question : il faut seulement cliquer « Allow » / « Authorize » sur les
# pages Cloudflare et GitHub qui s'ouvrent. On peut relancer la ligne sans
# risque : ce qui est déjà fait est sauté, le projet est mis à jour.
# Fichier en UTF-8 avec BOM : sans BOM, PowerShell 5.1 lit les accents de travers.
# Essais seulement : CLIPPIT_DOSSIER et CLIPPIT_BUREAU remplacent le dossier du
# projet et le bureau (et la fenêtre n'est pas ouverte à la fin).

$ErrorActionPreference = 'Continue'
$DEPOT = 'https://github.com/Demonwal51/clippitstudio.git'
$NODE_MIN = 22   # wrangler 4 exige Node >= 22
$env:WRANGLER_SEND_METRICS = 'false'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

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
  Info "Installation de $nom (en acceptant ses conditions d'utilisation)."
  Info 'Si Windows demande une autorisation, accepte-la.'
  & winget install --id $id -e --source winget --accept-package-agreements --accept-source-agreements
  RechargerPath
}

Write-Host 'Installation de Clippit Studio' -ForegroundColor Cyan
Write-Host 'Deux pages vont s''ouvrir dans ton navigateur, Cloudflare puis GitHub :'
Write-Host 'connecte-toi avec TON compte et clique « Allow » / « Authorize ». Rien d''autre à faire.'

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

# --- 2. Le projet
Etape '2. Le projet'
$dossier = $env:CLIPPIT_DOSSIER
if (-not $dossier) { $dossier = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'clippitstudio' }

if (Test-Path (Join-Path $dossier '.git')) {
  & git -C $dossier -c advice.diverging=false pull --ff-only --quiet 2>$null
  if ($LASTEXITCODE -eq 0) { Ok "projet mis à jour : $dossier" }
  else { Attention "projet pas mis à jour (modifications en cours) : Clippit Studio s'en chargera à la mise en ligne." }
} elseif ((Test-Path $dossier) -and (Get-ChildItem -Force $dossier | Select-Object -First 1)) {
  Echec "Le dossier $dossier existe déjà, mais ce n'est pas le projet. Renomme-le, puis relance."
} else {
  & git clone --quiet $DEPOT $dossier
  if ($LASTEXITCODE -ne 0) { Echec "Impossible de copier le projet depuis GitHub (connexion internet ?)." }
  Ok "projet copié dans $dossier"
}
Set-Location $dossier

# Identité qui signe les modifications. Sans identité git globale, on en pose
# une dans ce projet seulement (sa configuration globale n'est pas touchée).
if (-not "$(& git config user.name)".Trim()) { & git config user.name $env:USERNAME }
if (-not "$(& git config user.email)".Trim()) {
  $id = ($env:USERNAME.ToLower() -replace '[^a-z0-9._-]', '')
  if (-not $id) { $id = 'membre' }
  & git config user.email "$id@clippitstudio.invalid"
}

# npm.cmd et pas npm : PowerShell prendrait npm.ps1, bloqué par la politique
# d'exécution des scripts par défaut.
& npm.cmd ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { Echec "L'installation des outils (npm ci) a échoué : lis le message au-dessus." }
Ok 'outils installés'

# --- 3. Cloudflare
Etape '3. Ton compte Cloudflare'
$wrangler = Join-Path $dossier 'node_modules\wrangler\bin\wrangler.js'
& node $wrangler whoami --json *> $null
if ($LASTEXITCODE -ne 0) {
  Info 'Une page Cloudflare s''ouvre : connecte-toi avec TON compte, puis clique « Allow ».'
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

# --- 4. GitHub : connexion une fois pour toutes, et droit d'envoi vérifié.
# --dry-run n'envoie rien, mais demande la connexion comme un vrai envoi.
Etape '4. Ton compte GitHub'
Info 'Si une page GitHub s''ouvre : connecte-toi, puis clique « Authorize ».'
& git push --dry-run --quiet
if ($LASTEXITCODE -ne 0) {
  Echec ("GitHub refuse l'envoi. Accepte l'invitation GitHub de wal (e-mail de GitHub, ou github.com > " +
    'Notifications), ou demande-la-lui. Puis relance.')
}
Ok 'connexion GitHub et droit d''envoi confirmés'

# --- 5. Raccourci sur le bureau
Etape '5. Raccourci sur le bureau'
$bureau = $env:CLIPPIT_BUREAU
if (-not $bureau) { $bureau = [Environment]::GetFolderPath('Desktop') }   # suit OneDrive
foreach ($ancien in 'Clippit - Mettre en ligne.lnk', 'Clippit - Fichiers du site.lnk') {
  Remove-Item (Join-Path $bureau $ancien) -ErrorAction SilentlyContinue
}
$shell = New-Object -ComObject WScript.Shell
$lien = $shell.CreateShortcut((Join-Path $bureau 'Clippit Studio.lnk'))
$lien.TargetPath = Join-Path $PSHOME 'powershell.exe'
$lien.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dossier\outils\clippit-studio.ps1`""
$lien.WorkingDirectory = $dossier
$lien.WindowStyle = 7   # console réduite : seule la fenêtre de l'appli se voit
$lien.IconLocation = "$dossier\outils\clippit.ico,0"
$lien.Description = 'Modifier et mettre en ligne clippitstudio.cc'
$lien.Save()
Ok '« Clippit Studio » créé sur le bureau'

Write-Host ''
Write-Host 'Installation terminée : double-clique sur « Clippit Studio » sur ton bureau.' -ForegroundColor Green
if (-not $env:CLIPPIT_BUREAU) {
  Start-Process $lien.TargetPath -ArgumentList $lien.Arguments -WorkingDirectory $dossier -WindowStyle Hidden
}
exit 0
