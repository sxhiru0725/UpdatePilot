param([switch]$CompareCli)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\src\Agent.Core.psm1') -Force
Import-PackageClient
Assert-TrustedSource
$inventory = @(Get-AgentInventory)
$raw = @(& (Get-Module 'Agent.Core') { Get-WinGetPackage })
$issues = [Collections.Generic.List[string]]::new()
$byIdentity = @{}
foreach ($app in $inventory) { $byIdentity[$app.identity] = $app }
$seen = @{}; $matched = 0; $availableMatched = 0
foreach ($package in $raw) {
    $key = "$($package.Source)|$($package.Id)"
    if (-not $seen.ContainsKey($key)) { $seen[$key] = 0 }; $seen[$key]++
    $identity = "$key|$($seen[$key])"
    $app = $byIdentity[$identity]
    if (-not $app -or $app.name -cne [string]$package.Name -or $app.installedVersion -cne [string]$package.InstalledVersion) { $issues.Add("Installed observation mismatch: $identity"); continue }
    $matched++
    if ($null -ne $app.availableVersion) {
        $versions = @($package.AvailableVersions)
        if ($versions.Count -eq 0 -or $app.availableVersion -cne [string]$versions[0]) { $issues.Add("Available version mismatch: $identity") } else { $availableMatched++ }
    }
    if ($app.status -eq 'UPDATE_AVAILABLE' -and -not $package.IsUpdateAvailable) { $issues.Add("Update evidence mismatch: $identity") }
    if ($app.status -eq 'UP_TO_DATE' -and $app.installedVersion -cne $app.availableVersion) { $issues.Add("Unverified current status: $identity") }
}
if ($raw.Count -ne $inventory.Count) { $issues.Add('Inventory count changed between read-only observations; repeat the check.') }
$cliChecks = @()
if ($CompareCli) {
    foreach ($id in @('Git.Git','ArduinoSA.IDE.stable','Microsoft.VisualStudioCode')) {
        $apps = @($inventory | Where-Object packageId -eq $id)
        if ($apps.Count -ne 1) { continue }
        $app = $apps[0]; $savedPreference = $ErrorActionPreference
        try { $ErrorActionPreference = 'Continue'; $text = (& winget list --id $id --exact --source winget --disable-interactivity 2>&1 | Out-String); $code = $LASTEXITCODE }
        finally { $ErrorActionPreference = $savedPreference }
        $installedMatches = $code -eq 0 -and $text.Contains($app.installedVersion)
        $targetMatches = $app.status -ne 'UPDATE_AVAILABLE' -or $text.Contains($app.availableVersion)
        if (-not $installedMatches -or -not $targetMatches) { $issues.Add("Independent CLI observation mismatch: $id") }
        $cliChecks += [PSCustomObject]@{ packageId = $id; installedVersion = $app.installedVersion; availableVersion = $app.availableVersion; agentStatus = $app.status; exitCode = $code; installedMatches = $installedMatches; updateTargetMatches = $targetMatches }
    }
}
[PSCustomObject]@{ checkedAt = [DateTimeOffset]::Now.ToString('o'); installedApplications = $inventory.Count; installedObservationsMatched = $matched; availableVersionsMatched = $availableMatched; statuses = @($inventory | Group-Object status | Select-Object Name,Count); cliComparisons = $cliChecks; issues = @($issues.ToArray()); readOnly = $true } | ConvertTo-Json -Depth 6
if ($issues.Count -gt 0) { throw 'WinGet comparison failed or the inventory changed during observation. Review the JSON issues; no software was changed.' }
