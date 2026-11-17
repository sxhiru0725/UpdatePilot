param([ValidateSet('1.29.380')][string]$Version = '1.29.380', [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'The agent requires Windows 10/11.' }
Import-Module (Join-Path $PSScriptRoot '..\src\Agent.Core.psm1') -Force
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$moduleRoot = [IO.Path]::GetFullPath((Join-Path $root '.local\modules\Microsoft.WinGet.Client'))
$target = Join-Path $moduleRoot $Version
$manifest = Join-Path $target 'Microsoft.WinGet.Client.psd1'
if (Test-Path -LiteralPath $manifest) {
    Assert-PackageClientSignature $manifest
    Write-Output "Verified existing Microsoft.WinGet.Client $Version. No download or installation performed."
    exit 0
}
if ($CheckOnly) { throw 'The project-local WinGet module is missing. Setup requires a separately approved download.' }
if (Test-Path -LiteralPath $target) { throw 'The module directory is incomplete. Move it aside before retrying setup; it will not be trusted or overwritten.' }
New-Item -ItemType Directory -Path $moduleRoot -Force | Out-Null
$stage = [IO.Path]::GetFullPath((Join-Path $moduleRoot ('.staging-' + [guid]::NewGuid().ToString())))
$archive = Join-Path $stage 'module.zip'
New-Item -ItemType Directory -Path $stage | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
    Invoke-WebRequest -UseBasicParsing -Uri "https://www.powershellgallery.com/api/v2/package/Microsoft.WinGet.Client/$Version" -OutFile $archive -TimeoutSec 120
    Expand-Archive -LiteralPath $archive -DestinationPath $stage -Force
    Remove-Item -LiteralPath $archive -Force
    Assert-PackageClientSignature (Join-Path $stage 'Microsoft.WinGet.Client.psd1')
    if (-not $stage.StartsWith($moduleRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFullPath($target)).StartsWith($moduleRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid module staging path.' }
    Move-Item -LiteralPath $stage -Destination $target
    Write-Output "Verified Microsoft.WinGet.Client $Version in project-local .local/modules. No system package was changed."
} finally {
    if (Test-Path -LiteralPath $stage) {
        if (-not $stage.StartsWith($moduleRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $stage -Leaf) -notlike '.staging-*') { throw 'Refusing to clean an unexpected staging path.' }
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
