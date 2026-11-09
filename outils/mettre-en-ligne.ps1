# Moteur de mise en ligne de clippitstudio, lancé par la fenêtre Clippit Studio
# (clippit-studio.ps1) ou à la main dans une console. Aucune question :
#   1. enregistre les modifications de public\ (commit, message automatique) ;
#   2. récupère celles des autres (git pull --rebase) ;
#   3. envoie sur GitHub, pour que personne n'écrase le travail des autres ;
#   4. met en ligne sur Cloudflare avec le garde-fou (outils\deployer.js).
# CLIPPIT_FENETRE=1 (posé par la fenêtre, qui a déjà demandé confirmation) :
#   pas de pause à la fin, et deployer.js --oui.
# CLIPPIT_ESSAI=1 : commit local seulement, pas d'envoi sur GitHub, et
#   deployer.js --essai (rien n'est mis en ligne).
# Fichier en UTF-8 avec BOM : sans BOM, PowerShell 5.1 lit les accents de travers.

$ErrorActionPreference = 'Continue'
$essai = [bool]$env:CLIPPIT_ESSAI
$fenetre = [bool]$env:CLIPPIT_FENETRE
$env:WRANGLER_SEND_METRICS = 'false'
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }
if (-not $fenetre) { try { $Host.UI.RawUI.WindowTitle = 'Clippit - Mettre en ligne' } catch { } }
Set-Location (Split-Path -Parent $PSScriptRoot)

function Etape($texte) { Write-Host ''; Write-Host "=== $texte" -ForegroundColor Cyan }
function Ok($texte) { Write-Host "[OK] $texte" -ForegroundColor Green }
function Info($texte) { Write-Host "     $texte" }
function Fin($code) {
  if (-not $fenetre -and -not $env:CLIPPIT_SANS_PAUSE) {
    Write-Host ''
    Read-Host 'Appuie sur Entrée pour fermer' | Out-Null
  }
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
  $noms = @($dansPublic | ForEach-Object { (($_.Substring(3) -split ' -> ')[-1]).Trim('"') -replace '^public/', '' })
  $message = 'Mise à jour du site : ' + (($noms | Select-Object -First 3) -join ', ')
  if ($noms.Count -gt 3) { $message += " (+$($noms.Count - 3))" }
  & git add -A -- public
  & git commit --quiet -m $message
  if ($LASTEXITCODE -ne 0) { Echec "L'enregistrement (commit) a échoué : lis le message au-dessus." }
  Ok $message
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
if ($enAvance -eq 0) {
  Ok 'GitHub a déjà cette version'
  if (-not $dansPublic.Count) { Info 'Rien de nouveau : la version actuelle est remise en ligne.' }
} elseif ($essai) {
  Info "[essai] envoi sauté ($enAvance commit(s) restent sur ce PC)"
} else {
  & git push --quiet
  if ($LASTEXITCODE -ne 0) {
    Echec ("GitHub refuse l'envoi. Accepte l'invitation GitHub de wal (ou demande-la), " +
      "puis relance l'installation pour te connecter.")
  }
  Ok 'envoyé sur GitHub'
}

# --- 4. Cloudflare
Etape '4. Mise en ligne sur Cloudflare'
$arguments = @('outils\deployer.js')
if ($essai) { $arguments += '--essai' } elseif ($fenetre) { $arguments += '--oui' }
& node @arguments
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '[ERREUR] La mise en ligne a échoué : lis les lignes [ERREUR] au-dessus.' -ForegroundColor Red
  Fin 1
}
Write-Host ''
Write-Host 'Terminé.' -ForegroundColor Green
Fin 0
