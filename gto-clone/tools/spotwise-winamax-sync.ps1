# Spotwise - Winamax gateway helper.
# Copies the Winamax hand histories and tournament summaries of every account
# (%APPDATA%\winamax\documents\accounts\<name>\history) into
# Documents\Spotwise\Winamax, a folder Chrome and Edge are allowed to open.
# Spotwise then reads that folder by itself (My Data > Winamax gateway).
#
#   Copy once:                     powershell -ExecutionPolicy Bypass -File spotwise-winamax-sync.ps1
#   Copy every 10 minutes:         ... -File spotwise-winamax-sync.ps1 -Install
#   Stop the automatic copy:       ... -File spotwise-winamax-sync.ps1 -Uninstall
#
# It only reads Winamax's folder and only writes inside Documents\Spotwise.
param(
  [string]$Source = (Join-Path $env:APPDATA 'winamax\documents\accounts'),
  [string]$Dest = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Spotwise\Winamax'),
  [switch]$Install,
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Spotwise Winamax sync'

if ($Uninstall) {
  schtasks /Delete /TN $TaskName /F | Out-Null
  Write-Output "Automatic copy stopped."
  return
}

if ($Install) {
  # Keep a copy of this script next to the files so the task never points to Downloads.
  $root = Split-Path $Dest -Parent
  New-Item -ItemType Directory -Force $root | Out-Null
  $self = Join-Path $root 'spotwise-winamax-sync.ps1'
  if ($PSCommandPath -ne $self) { Copy-Item $PSCommandPath $self -Force }
  $cmd = "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$self`""
  schtasks /Create /SC MINUTE /MO 10 /TN $TaskName /TR $cmd /F | Out-Null
  Write-Output "Automatic copy every 10 minutes is on (task '$TaskName')."
}

if (-not (Test-Path $Source)) {
  Write-Output "Winamax folder not found: $Source"
  return
}
New-Item -ItemType Directory -Force $Dest | Out-Null
$copied = 0
foreach ($account in Get-ChildItem $Source -Directory) {
  $history = Join-Path $account.FullName 'history'
  if (-not (Test-Path $history)) { continue }
  foreach ($file in Get-ChildItem $history -Filter *.txt -File -Recurse) {
    # Prefix with the account name so two accounts never overwrite each other.
    $target = Join-Path $Dest ($account.Name + '_' + $file.Name)
    $old = Get-Item $target -ErrorAction SilentlyContinue
    if (-not $old -or $old.Length -ne $file.Length -or $old.LastWriteTime -lt $file.LastWriteTime) {
      Copy-Item $file.FullName $target -Force
      $copied++
    }
  }
}
Write-Output "$copied file(s) copied to $Dest"
