Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:AgentVersion = '0.1.0'
function Assert-PackageClientSignature {
    param([Parameter(Mandatory)][string]$ManifestPath)
    $binary = Join-Path (Split-Path $ManifestPath -Parent) 'net48\Microsoft.WinGet.Client.Cmdlets.dll'
    if (-not (Test-Path -LiteralPath $ManifestPath) -or -not (Test-Path -LiteralPath $binary)) { throw 'MODULE_UNAVAILABLE: The project-local WinGet module is missing or incomplete.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $binary
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') { throw 'MODULE_UNAVAILABLE: Microsoft WinGet binary signature verification failed.' }
}
function Import-PackageClient {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $module = Join-Path $root '.local\modules\Microsoft.WinGet.Client\1.29.380\Microsoft.WinGet.Client.psd1'
    if (-not (Test-Path $module)) { throw 'MODULE_UNAVAILABLE: Run npm run agent:setup first.' }
    Assert-PackageClientSignature $module
    Import-Module $module -ErrorAction Stop
}
function Assert-TrustedSource {
    $sources = @(Get-WinGetSource | Where-Object { $_.Name -eq 'winget' })
    if ($sources.Count -ne 1 -or $sources[0].Argument.TrimEnd('/') -ne 'https://cdn.winget.microsoft.com/cache') { throw 'SOURCE_UNAVAILABLE: The winget source must be the official Microsoft community source.' }
}
function Assert-UpdateOperation {
    param($Operation)
    if ($Operation.operation -cne 'UPDATE') { throw 'Only UPDATE operations are accepted here.' }
    if ($Operation.source -cne 'winget') { throw 'Source is not allowlisted.' }
    if ($Operation.packageId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9._+-]+$' -or $Operation.packageId.Length -gt 200 -or $Operation.packageId -match '[\r\n]') { throw 'Invalid package ID.' }
    foreach ($value in @($Operation.previousVersion, $Operation.targetVersion)) {
        if ($null -eq $value -or $value.Length -gt 100 -or $value -cnotmatch '^[A-Za-z0-9][A-Za-z0-9 ._+()~-]*$' -or $value -match '^unknown$' -or $value -match '[\r\n]') { throw 'Invalid or unknown version.' }
    }
    if ($Operation.targetVersion -ceq $Operation.previousVersion) { throw 'Target must differ from installed version.' }
}
function Get-ExactInstalledPackage {
    param([string]$Id)
    $packages = @(Get-WinGetPackage -Id $Id -Source winget -MatchOption EqualsCaseInsensitive)
    if ($packages.Count -ne 1 -or $packages[0].Id -ine $Id) { throw 'Package identity is absent or ambiguous.' }
    return $packages[0]
}
function Get-AgentInventory {
    Assert-TrustedSource
    # Registry publisher enrichment uses exact displayed name + version only; it never supplies package IDs.
    $publishers = @{}
    foreach ($path in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
        if (Test-Path $path) {
            foreach ($key in @(Get-ChildItem -LiteralPath $path -ErrorAction SilentlyContinue)) {
                $displayName = [string]$key.GetValue('DisplayName'); $displayVersion = [string]$key.GetValue('DisplayVersion'); $publisherValue = [string]$key.GetValue('Publisher')
                if ($displayName -and $displayVersion -and $publisherValue) {
                    $publisherKey = "$displayName|$displayVersion"
                    if (-not $publishers.ContainsKey($publisherKey)) { $publishers[$publisherKey] = @() }
                    $publishers[$publisherKey] = @($publishers[$publisherKey] + $publisherValue | Sort-Object -Unique)
                }
            }
        }
    }
    $packages = @(Get-WinGetPackage)
    $counts = @{}
    foreach ($p in $packages) { $key = "$($p.Source)|$($p.Id)"; if (-not $counts.ContainsKey($key)) { $counts[$key] = 0 }; $counts[$key]++ }
    $seen = @{}
    foreach ($p in $packages) {
        $id = [string]$p.Id
        $source = [string]$p.Source
        $key = "$source|$id"
        if (-not $seen.ContainsKey($key)) { $seen[$key] = 0 }; $seen[$key]++
        $installed = [string]$p.InstalledVersion
        $available = $null
        $supported = $source -eq 'winget' -and $id -cmatch '^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9._+-]+$' -and $id -notmatch '^(ARP|MSIX)\\'
        $status = 'METADATA_UNAVAILABLE'
        if (-not $supported) { if ($id -match '^(ARP|MSIX)\\' -or -not $source) { $status = 'UNMATCHED' } else { $status = 'UNSUPPORTED' } }
        elseif ($counts[$key] -gt 1) { $status = 'UNSUPPORTED' }
        elseif (-not $installed -or $installed -match '^unknown$') { $status = 'UNKNOWN_VERSION' }
        else {
            # PSCatalogPackage.AvailableVersions is ordered by WinGet, not lexical version sorting.
            $versions = @($p.AvailableVersions)
            if ($versions.Count -gt 0) {
                $candidate = [string]$versions[0]
                if ($candidate -cmatch '^[A-Za-z0-9][A-Za-z0-9 ._+()~-]*$' -and $candidate.Length -le 100) {
                    $available = $candidate
                    if ($p.IsUpdateAvailable -and $installed -cne $available) { $status = 'UPDATE_AVAILABLE' }
                    elseif ($installed -ceq $available) { $status = 'UP_TO_DATE' }
                }
            }
        }
        # Publisher is absent on some catalog objects; never infer it from a package ID.
        $publisher = $null
        if ($p.PSObject.Properties.Name -contains 'Publisher' -and $p.Publisher) { $publisher = [string]$p.Publisher }
        $publisherKey = "$($p.Name)|$installed"
        if (-not $publisher -and $publishers.ContainsKey($publisherKey) -and $publishers[$publisherKey].Count -eq 1) { $publisher = $publishers[$publisherKey][0] }
        [PSCustomObject]@{ identity = "$key|$($seen[$key])"; name = [string]$p.Name; publisher = $publisher; installedVersion = $installed; availableVersion = $available; packageId = $(if ($supported) { $id } else { $null }); source = $(if ($source) { $source } else { $null }); status = $status }
    }
}
function Assert-ApprovedTarget {
    param($Operation)
    Assert-UpdateOperation $Operation
    Assert-TrustedSource
    $installed = Get-ExactInstalledPackage $Operation.packageId
    if ([string]$installed.InstalledVersion -cne $Operation.previousVersion) { throw 'Installed version changed since approval; scan and review again.' }
    if (-not $installed.IsUpdateAvailable) { throw 'WinGet no longer reports this update.' }
    if (@($installed.AvailableVersions | ForEach-Object { [string]$_ }) -cnotcontains $Operation.targetVersion) { throw 'Approved target is no longer available from the trusted source.' }
}
function Invoke-WinGetUpgrade {
    param($Operation)
    Assert-ApprovedTarget $Operation
    $arguments = @('upgrade', '--id', $Operation.packageId, '--exact', '--source', 'winget', '--version', $Operation.targetVersion, '--silent', '--disable-interactivity', '--accept-package-agreements')
    $null = Get-Command winget -ErrorAction Stop
    # Windows PowerShell 5.1 turns redirected native stderr into ErrorRecords. Diagnostic
    # stderr must not throw away the real exit code or skip post-operation verification.
    $savedPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $null = & winget @arguments 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedPreference }
    if ($null -eq $code) { throw 'WinGet did not return an exit code.' }
    return $code
}
Export-ModuleMember -Function Assert-PackageClientSignature, Import-PackageClient, Assert-TrustedSource, Assert-UpdateOperation, Get-AgentInventory, Get-ExactInstalledPackage, Assert-ApprovedTarget, Invoke-WinGetUpgrade
