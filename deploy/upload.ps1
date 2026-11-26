# Builds the frontend on this Windows PC, packs the project and installs it on the server.
#
# Usage (PowerShell, from the project folder):
#   .\deploy\upload.ps1 -Server 192.168.1.21 -User root
#
# The frontend is built here, not on the server: a small server (a Proxmox container with 1 GB)
# does not have the memory for the build. Leaves out node_modules, .env files and uploaded
# documents: secrets and data stay where they are. Uses the ssh/scp/tar programs built into
# Windows 10 and 11. Uses the key ~\.ssh\qadiyati_deploy when it exists.
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [string]$User = 'root',
    [switch]$SkipBuild
)
# Each program's exit code is checked below. 'Stop' would also abort on harmless messages that
# npm, ssh and scp print on stderr (Windows PowerShell 5.1 treats those as errors when captured).
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
$archive = Join-Path $env:TEMP 'qadiyati.tar.gz'
if (Test-Path $archive) { Remove-Item $archive -Force }
$key = Join-Path $env:USERPROFILE '.ssh\qadiyati_deploy'
$sshOptions = @()
if (Test-Path $key) { $sshOptions = @('-i', $key) }

if (-not $SkipBuild) {
    Write-Host '==> Building the frontend (production settings)'
    # The same values as deploy/env/frontend.env.production; process variables win over frontend/.env.
    foreach ($line in Get-Content (Join-Path $PSScriptRoot 'env\frontend.env.production')) {
        if ($line -match '^\s*(VITE_[A-Z_]+)\s*=\s*(.*)$') { Set-Item -Path "env:$($Matches[1])" -Value $Matches[2].Trim() }
    }
    Push-Location (Join-Path $root 'frontend')
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
    } finally {
        Pop-Location
        Remove-Item env:VITE_DEMO, env:VITE_API_URL -ErrorAction SilentlyContinue
    }
}

Write-Host '==> Packing the project'
# Windows tar cannot open folders with Arabic names given by path (-C), so step into the project
# folder first and pack relative paths.
Push-Location $root
try {
    tar -czf $archive `
        --exclude=node_modules --exclude=.env --exclude=.env.local `
        --exclude=private-documents --exclude=uploads --exclude=.claude --exclude=*.log `
        backend frontend deploy
    if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
} finally {
    Pop-Location
}
Write-Host ("    {0:N1} MB" -f ((Get-Item $archive).Length / 1MB))

Write-Host "==> Uploading to $User@$Server"
scp @sshOptions $archive "${User}@${Server}:/tmp/qadiyati.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'scp failed' }

Write-Host '==> Installing on the server'
# The first time, the server is prepared (setup-server.sh) before the release is installed.
$remote = 'set -e; rm -rf /tmp/qadiyati-deploy; mkdir -p /tmp/qadiyati-deploy; ' +
    'tar -xzf /tmp/qadiyati.tar.gz -C /tmp/qadiyati-deploy deploy; ' +
    'if [ ! -f /opt/qadiyati/backend/.env ]; then sudo bash /tmp/qadiyati-deploy/deploy/scripts/setup-server.sh; fi; ' +
    'sudo bash /tmp/qadiyati-deploy/deploy/scripts/deploy.sh /tmp/qadiyati.tar.gz'
ssh @sshOptions -t "${User}@${Server}" $remote
if ($LASTEXITCODE -ne 0) { throw 'deploy failed on the server' }

Remove-Item $archive -Force
Write-Host 'Done.'
