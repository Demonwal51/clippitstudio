# Clippit Studio : la petite fenêtre de l'équipe (raccourci « Clippit Studio »
# créé par installer.ps1). Quatre boutons : modifier le site, le voir avant de
# l'envoyer, le mettre en ligne (moteur : mettre-en-ligne.ps1), le voir en ligne.
#
# Les sorties des processus lancés (git, moteur) sont lues par ReadLineAsync(),
# interrogé par un Windows.Forms.Timer sur le fil de l'interface : les
# événements .NET (OutputDataReceived) arrivent sur un autre fil, où un
# scriptblock PowerShell planterait.
#
# Test seulement : CLIPPIT_AUTOTEST=<fichier.png> lance une mise en ligne en
# mode essai sans confirmation, enregistre la fenêtre en image (et le journal
# en .txt à côté), puis ferme.
# Fichier en UTF-8 avec BOM : sans BOM, PowerShell 5.1 lit les accents de travers.

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Clippit -Name Ecran -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Clippit.Ecran]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

$RACINE = Split-Path -Parent $PSScriptRoot
$PUBLIC = Join-Path $RACINE 'public'
$SITE = 'https://clippitstudio.cc'
$AUTOTEST = $env:CLIPPIT_AUTOTEST
$env:CLIPPIT_FENETRE = '1'
if ($AUTOTEST) { $env:CLIPPIT_ESSAI = '1' }
$ESSAI = [bool]$env:CLIPPIT_ESSAI
$GIT = (Get-Command git -ErrorAction SilentlyContinue).Source
$POWERSHELL = Join-Path $PSHOME 'powershell.exe'
Set-Location $RACINE

$script:proc = $null
$script:sortie = $null
$script:erreurs = $null
$script:quandFini = $null
$script:modifs = @()
$script:derniereErreur = ''

# --- Fenêtre (coordonnées à 96 ppp, multipliées par E)
$police = 'Segoe UI'
$form = New-Object System.Windows.Forms.Form
# Échelle de l'écran (125 %, 150 %...) : les polices en points suivent seules,
# les positions et tailles en pixels sont multipliées par E.
$g = $form.CreateGraphics()
$ECHELLE = $g.DpiX / 96
$g.Dispose()
function E([double]$n) { [int][Math]::Round($n * $ECHELLE) }
$form.Text = 'Clippit Studio'
$form.ClientSize = New-Object System.Drawing.Size((E 640), (E 580))
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font($police, 10)
try { $form.Icon = New-Object System.Drawing.Icon (Join-Path $PSScriptRoot 'clippit.ico') } catch { }

$logo = New-Object System.Windows.Forms.PictureBox
$logo.SetBounds((E 20), (E 16), (E 64), (E 64))
$logo.SizeMode = 'Zoom'
try { $logo.Image = [System.Drawing.Image]::FromFile((Join-Path $PUBLIC 'apple-touch-icon.png')) } catch { }

$titre = New-Object System.Windows.Forms.Label
$titre.SetBounds((E 96), (E 14), (E 520), (E 36))
$titre.Text = 'Clippit Studio'
$titre.Font = New-Object System.Drawing.Font($police, 18, [System.Drawing.FontStyle]::Bold)

$etat = New-Object System.Windows.Forms.Label
$etat.SetBounds((E 98), (E 52), (E 520), (E 24))
$etat.ForeColor = [System.Drawing.Color]::DimGray
$etat.Text = 'Récupération de la dernière version...'

function NouveauBouton($texte, $x, $y, $largeur, $hauteur) {
  $b = New-Object System.Windows.Forms.Button
  $b.SetBounds((E $x), (E $y), (E $largeur), (E $hauteur))
  $b.Text = $texte
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderColor = [System.Drawing.Color]::Silver
  $b.BackColor = [System.Drawing.Color]::WhiteSmoke
  $b.Cursor = [System.Windows.Forms.Cursors]::Hand
  return $b
}
$modifier = NouveauBouton 'Modifier le site' 20 96 295 46
$apercu = NouveauBouton "Voir avant d'envoyer" 325 96 295 46
$publier = NouveauBouton 'Mettre en ligne' 20 152 600 64
$publier.Font = New-Object System.Drawing.Font($police, 15, [System.Drawing.FontStyle]::Bold)
$publier.BackColor = [System.Drawing.Color]::FromArgb(79, 70, 229)
$publier.ForeColor = [System.Drawing.Color]::White
$publier.FlatAppearance.BorderSize = 0
$voirSite = NouveauBouton 'Voir le site en ligne' 20 226 600 36

$journal = New-Object System.Windows.Forms.RichTextBox
$journal.SetBounds((E 20), (E 274), (E 600), (E 236))
$journal.ReadOnly = $true
$journal.BorderStyle = 'None'
$journal.BackColor = [System.Drawing.Color]::FromArgb(246, 246, 248)
$journal.Font = New-Object System.Drawing.Font('Consolas', 9)
$journal.WordWrap = $true

$bandeau = New-Object System.Windows.Forms.Label
$bandeau.SetBounds((E 20), (E 520), (E 600), (E 44))
$bandeau.TextAlign = 'MiddleCenter'
$bandeau.Font = New-Object System.Drawing.Font($police, 11, [System.Drawing.FontStyle]::Bold)
$bandeau.Visible = $false

$form.Controls.AddRange(@($logo, $titre, $etat, $modifier, $apercu, $publier, $voirSite, $journal, $bandeau))

# --- Journal
function Ajouter([string]$ligne, [bool]$gris) {
  $ligne = ($ligne -replace "\x1b\[[0-9;]*m", '').Replace([string][char]0xFEFF, '')
  $couleur = 'Black'
  if ($ligne -match '\[ERREUR\]|ARRÊT') { $couleur = 'Firebrick' }
  elseif ($ligne -match '^\[OK\]') { $couleur = 'ForestGreen' }
  elseif ($ligne -match '^\[ATTENTION\]') { $couleur = 'DarkOrange' }
  elseif ($ligne -match '^===') { $couleur = 'SteelBlue' }
  elseif ($gris) { $couleur = 'Gray' }
  $journal.SelectionStart = $journal.TextLength
  $journal.SelectionLength = 0
  $journal.SelectionColor = [System.Drawing.Color]::FromName($couleur)
  $journal.SelectedText = $ligne + "`n"
  $journal.ScrollToCaret()
  if ($ligne -match '\[ERREUR\]\s*(.+)$') { $script:derniereErreur = $Matches[1] }
}

function Bandeau($texte, $vert) {
  $bandeau.Text = $texte
  if ($vert) {
    $bandeau.BackColor = [System.Drawing.Color]::FromArgb(230, 244, 234)
    $bandeau.ForeColor = [System.Drawing.Color]::FromArgb(19, 115, 51)
  } else {
    $bandeau.BackColor = [System.Drawing.Color]::FromArgb(252, 232, 230)
    $bandeau.ForeColor = [System.Drawing.Color]::FromArgb(165, 14, 14)
  }
  $bandeau.Visible = $true
}

function Occupe($oui) {
  foreach ($b in $modifier, $apercu, $publier) { $b.Enabled = -not $oui }
  $form.UseWaitCursor = $oui
}

# --- État : fichiers modifiés et commits pas encore envoyés
function MajEtat {
  if ($script:proc) { return }
  $script:modifs = @(& $GIT -c core.quotepath=false status --porcelain=v1 --untracked-files=all 2>$null | Where-Object { $_ })
  $enAvance = "$(& $GIT rev-list --count '@{u}..HEAD' 2>$null)".Trim()
  if ($script:modifs.Count) { $etat.Text = "$($script:modifs.Count) fichier(s) modifié(s), pas encore en ligne." }
  elseif ($enAvance -and $enAvance -ne '0') { $etat.Text = 'Des modifications enregistrées ne sont pas encore en ligne.' }
  else { $etat.Text = 'Tout est à jour.' }
}

# --- Lancement d'un processus caché, sortie lue au fil de l'eau
function Lancer($exe, $arguments, [scriptblock]$quandFini) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = $arguments
  $psi.WorkingDirectory = $RACINE
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = New-Object Text.UTF8Encoding $false
  $psi.StandardErrorEncoding = New-Object Text.UTF8Encoding $false
  $script:quandFini = $quandFini
  $script:proc = [System.Diagnostics.Process]::Start($psi)
  $script:sortie = $script:proc.StandardOutput.ReadLineAsync()
  $script:erreurs = $script:proc.StandardError.ReadLineAsync()
  $minuterie.Start()
}

$minuterie = New-Object System.Windows.Forms.Timer
$minuterie.Interval = 100
$minuterie.Add_Tick({
  while ($script:sortie -and $script:sortie.IsCompleted) {
    $ligne = $script:sortie.Result
    if ($null -eq $ligne) { $script:sortie = $null } else {
      Ajouter $ligne $false
      $script:sortie = $script:proc.StandardOutput.ReadLineAsync()
    }
  }
  while ($script:erreurs -and $script:erreurs.IsCompleted) {
    $ligne = $script:erreurs.Result
    if ($null -eq $ligne) { $script:erreurs = $null } else {
      Ajouter $ligne $true
      $script:erreurs = $script:proc.StandardError.ReadLineAsync()
    }
  }
  if (-not $script:sortie -and -not $script:erreurs -and $script:proc.HasExited) {
    $minuterie.Stop()
    $code = $script:proc.ExitCode
    $script:proc.Dispose()
    $script:proc = $null
    & $script:quandFini $code
  }
})

# --- Mise en ligne
function Publier {
  $journal.Clear()
  $bandeau.Visible = $false
  $script:derniereErreur = ''
  Occupe $true
  $etat.Text = 'Mise en ligne en cours... (environ une minute)'
  $moteur = Join-Path $PSScriptRoot 'mettre-en-ligne.ps1'
  Lancer $POWERSHELL "-NoProfile -ExecutionPolicy Bypass -File `"$moteur`"" {
    param($code)
    Occupe $false
    MajEtat
    if ($code -eq 0 -and $ESSAI) { Bandeau "Essai réussi : rien n'a été envoyé." $true }
    elseif ($code -eq 0) { Bandeau 'En ligne sur clippitstudio.cc' $true }
    elseif ($script:derniereErreur) { Bandeau "Échec : $($script:derniereErreur)" $false }
    else { Bandeau 'Échec : lis le journal ci-dessus.' $false }
    if ($AUTOTEST) { Capturer }
  }
}

function Capturer {
  # DrawToBitmap marche hors de l'écran, mais ne dessine pas la RichTextBox :
  # le texte du journal va dans le .txt.
  $image = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
  $form.DrawToBitmap($image, (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
  $image.Save($AUTOTEST, [System.Drawing.Imaging.ImageFormat]::Png)
  $image.Dispose()
  [IO.File]::WriteAllText("$AUTOTEST.txt", $etat.Text + "`n" + $bandeau.Text + "`n---`n" + $journal.Text, (New-Object Text.UTF8Encoding $false))
  $form.Close()
}
# --- Boutons
$modifier.Add_Click({ Start-Process explorer.exe "`"$PUBLIC`"" })
$apercu.Add_Click({ Start-Process (Join-Path $PUBLIC 'index.html') })
$voirSite.Add_Click({ Start-Process $SITE })
$publier.Add_Click({
  MajEtat
  if ($script:modifs.Count) {
    $liste = ($script:modifs | Select-Object -First 8 | ForEach-Object { '  - ' + ($_.Substring(3).Trim('"') -replace '^public/', '') }) -join "`n"
    if ($script:modifs.Count -gt 8) { $liste += "`n  ... et $($script:modifs.Count - 8) autre(s)" }
    $question = "Mettre en ligne ces modifications sur clippitstudio.cc ?`n`n$liste"
  } else {
    $question = "Rien de nouveau depuis la dernière fois.`nRemettre le site en ligne quand même ?"
  }
  $reponse = [System.Windows.Forms.MessageBox]::Show($form, $question, 'Clippit Studio', 'YesNo', 'Question')
  if ($reponse -eq 'Yes') { Publier }
})

$form.Add_Activated({ if (-not $script:proc) { MajEtat } })
$form.Add_FormClosing({
  if ($script:proc -and -not $script:proc.HasExited -and -not $AUTOTEST) {
    [void][System.Windows.Forms.MessageBox]::Show($form, 'Une mise en ligne est en cours : attends la fin.', 'Clippit Studio')
    $_.Cancel = $true
  }
})

# À l'ouverture : récupérer la dernière version, puis afficher l'état.
$form.Add_Shown({
  if (-not $GIT) {
    Bandeau 'Git est introuvable : relance l''installation (voir README.md).' $false
    Occupe $true
    return
  }
  Occupe $true
  Lancer $GIT '-c advice.diverging=false pull --ff-only --quiet' {
    param($code)
    if ($code -eq 0) { Ajouter '[OK] dernière version récupérée' $false }
    else { Ajouter "[ATTENTION] dernière version pas récupérée (pas d'internet ?) : ce sera refait à la mise en ligne." $false }
    Occupe $false
    MajEtat
    if ($AUTOTEST) { Publier }
  }
})

# Test : fenêtre hors de l'écran, pour ne gêner personne.
if ($AUTOTEST) { $form.StartPosition = 'Manual'; $form.Location = New-Object System.Drawing.Point(-5000, 0) }
[void]$form.ShowDialog()
