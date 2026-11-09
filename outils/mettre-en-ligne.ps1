# Bouton « Mettre en ligne » de clippitstudio (raccourci créé par installer.ps1).
#   1. enregistre les modifications de public\ (commit) ;
#   2. récupère celles des autres (git pull --rebase) ;
#   3. envoie sur GitHub, pour que personne n'écrase le travail des autres ;
#   4. met en ligne sur Cloudflare avec le garde-fou (outils\deployer.js).
# CLIPPIT_ESSAI=1 : commit local seulement, pas d'envoi sur GitHub, et
# deployer.js --essai (rien n'est mis en ligne).
# Fichier en UTF-8 avec BOM : sans BOM, PowerShell 5.1 lit les accents de travers.

$ErrorActionPreference = 'Continue'
$essai = [bool]$env:CLIPPIT_ESSAI
$env:WRANGLER_SEND_METRICS = 'false'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
try { $Host.UI.RawUI.WindowTitle = 'Clippit - Mettre en ligne' } catch { }
Set-Location (Split-Path -Parent $PSScriptRoot)

function Etape($texte) { Write-Host ''; Write-Host "=== $texte" -ForegroundColor Cyan }
function Ok($texte) { Write-Host "[OK] $texte" -ForegroundColor Green }
function Info($texte) { Write-Host "     $texte" }
function Fin($code) {
  Write-Host ''
  if (-not $env:CLIPPIT_SANS_PAUSE) { Read-Host 'Appuie sur Entrée pour fermer' | Out-Null }
  exit $code
}
function Echec($texte) {
  Write-Host ''
  Write-Host "[ERREUR] $texte" -ForegroundColor Red
  Write-Host "Rien n'a été mis en ligne."
  Fin 1
}

Write-Host "Mise en ligne de clippitstudio$(if ($essai) { ' (ESSAI : rien ne sera envoyé)' })" -ForegroundColor Cyan
foreach ($outil in 'git', 'node', 'npm.cmd') {
  if (-not (Get-Command $outil -ErrorAction SilentlyContinue)) {
    Echec "$outil est introuvable : relance l'installation (voir README.md)."
  }
}

# --- 1. Tes modifications
Etape '1. Tes modifications'
$lignes = @(& git -c core.quotepath=false status --porcelain=v1 --untracked-files=all)
$horsPublic = @()
$dansPublic = @()
foreach ($ligne in $lignes) {
  $chemins = $ligne.Substring(3) -split ' -> ' | ForEach-Object { $_.Trim('"') }
  if (@($chemins | Where-Object { -not $_.StartsWith('public/') }).Count) { $horsPublic += $ligne }
  else { $dansPublic += $ligne }
}
if ($horsPublic.Count) {
  Write-Host 'Fichiers modifiés hors du dossier public :'
  $horsPublic | ForEach-Object { Write-Host "  $_" }
  Echec 'Seuls les fichiers du dossier public se modifient. Remets ceux-là comme avant, ou demande à wal.'
}
if ($dansPublic.Count) {
  $dansPublic | ForEach-Object { Write-Host "  $_" }
  $message = "$(Read-Host 'Décris ta modification en quelques mots (Entrée = « Mise à jour du site »)')".Trim()
  if (-not $message) { $message = 'Mise à jour du site' }
  & git add -A -- public
  & git commit --quiet -m $message
  if ($LASTEXITCODE -ne 0) { Echec "L'enregistrement (commit) a échoué : lis le message au-dessus." }
  Ok "modifications enregistrées : $message"
} else {
  Ok 'aucune nouvelle modification dans public'
}

# --- 2. Le travail des autres
Etape '2. Récupération du travail des autres'
$verrouAvant = "$(& git rev-parse HEAD:package-lock.json 2>$null)"
& git pull --rebase --quiet
if ($LASTEXITCODE -ne 0) {
  & git rebase --abort *> $null
  Echec ("Impossible de récupérer la dernière version : pas d'internet, ou quelqu'un a modifié les mêmes " +
    'fichiers que toi. Tes modifications restent dans ton dossier : préviens wal.')
}
Ok 'à jour'
# wal a pu changer les outils (package-lock.json) : on les réinstalle.
if (("$(& git rev-parse HEAD:package-lock.json 2>$null)" -ne $verrouAvant) -or -not (Test-Path 'node_modules\wrangler')) {
  Info 'Mise à jour des outils (npm ci)...'
  & npm.cmd ci --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { Echec "La mise à jour des outils (npm ci) a échoué : lis le message au-dessus." }
}

# --- 3. GitHub
Etape '3. Envoi sur GitHub'
$enAvance = [int]"$(& git rev-list --count '@{u}..HEAD')"
if ($enAvance -eq 0 -and -not $dansPublic.Count) {
  $reponse = "$(Read-Host 'Rien de nouveau à envoyer. Remettre le site en ligne quand même ? (o/N)')".Trim()
  if ($reponse -notmatch '^(o|oui|y|yes)$') { Write-Host 'Rien à faire.'; Fin 0 }
}
if ($enAvance -eq 0) {
  Ok 'GitHub a déjà cette version'
} elseif ($essai) {
  Info "[essai] envoi sauté ($enAvance commit(s) restent sur ce PC)"
} else {
  Info 'La première fois, une fenêtre GitHub peut s''ouvrir pour te connecter.'
  & git push --quiet
  if ($LASTEXITCODE -ne 0) {
    Echec ("GitHub refuse l'envoi. Si c'est la première fois : demande à wal de t'ajouter au dépôt " +
      "(Settings > Collaborators), accepte l'invitation GitHub reçue par e-mail, puis relance.")
  }
  Ok 'envoyé sur GitHub'
}

# --- 4. Cloudflare
Etape '4. Mise en ligne sur Cloudflare'
$arguments = @('outils\deployer.js')
if ($essai) { $arguments += '--essai' }
& node @arguments
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '[ERREUR] La mise en ligne a échoué : lis les lignes [ERREUR] au-dessus.' -ForegroundColor Red
  Fin 1
}
Write-Host ''
Write-Host 'Terminé.' -ForegroundColor Green
Fin 0
