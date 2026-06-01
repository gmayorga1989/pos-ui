# Publica el build de producción en el Droplet (/opt/pos-ui/html).
# Uso: .\deploy\publish-dist.ps1  [-SkipBuild]

param(
    [string]$IP = "159.89.41.88",
    [string]$User = "root",
    [string]$SshKey = "$env:USERPROFILE\.ssh\id_ed25519.pem",
    [int]$Port = 22,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$AppRoot = Split-Path $PSScriptRoot -Parent
$DistBrowser = Join-Path $AppRoot "dist\pos-ui\browser"
$RemoteOpt = "/opt/pos-ui"
$TarName = "pos-ui-dist.tar.gz"

Push-Location $AppRoot
try {
    if (-not $SkipBuild) {
        Write-Host ">> npm ci && ng build (production)..." -ForegroundColor Cyan
        npm ci
        npm run build -- --configuration production
    }

    if (-not (Test-Path $DistBrowser)) {
        throw "No existe $DistBrowser — ejecuta el build antes."
    }

    $TarPath = Join-Path $AppRoot $TarName
    if (Test-Path $TarPath) { Remove-Item $TarPath -Force }

    tar -czf $TarName -C $DistBrowser .

    $ScpBase = @("-i", $SshKey)
    if ($Port -ne 22) { $ScpBase += @("-P", $Port) }

    scp @ScpBase (Join-Path $AppRoot "deploy\nginx-pos-ui.conf.example") "${User}@${IP}:${RemoteOpt}/nginx.conf.example"
    scp @ScpBase $TarPath "${User}@${IP}:${RemoteOpt}/"

    $RemoteScript = @"
set -euo pipefail
mkdir -p ${RemoteOpt}/html
rm -rf ${RemoteOpt}/html/*
tar -xzf ${RemoteOpt}/${TarName} -C ${RemoteOpt}/html
rm -f ${RemoteOpt}/${TarName}
sudo nginx -t && sudo systemctl reload nginx
"@ -replace "`r`n", "`n"

    ssh -i $SshKey "${User}@${IP}" $RemoteScript
    Write-Host ">> POS UI publicado en ${RemoteOpt}/html" -ForegroundColor Green
}
finally {
    Pop-Location
}
