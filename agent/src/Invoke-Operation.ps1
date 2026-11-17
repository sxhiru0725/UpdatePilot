param([Parameter(Mandatory)][string]$InputPath, [Parameter(Mandatory)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Agent.Core.psm1') -Force
$operation = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
try {
    Import-PackageClient
    if ($operation.operation -ceq 'SCAN') {
        $inventory = @(Get-AgentInventory)
        @{ status = 'COMPLETED'; applications = $inventory } | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    } elseif ($operation.operation -ceq 'UPDATE') {
        Assert-ApprovedTarget $operation
        # Argument array only; no command string, Invoke-Expression, RunAs or trust overrides.
        $code = Invoke-WinGetUpgrade $operation
        @{ phase = 'VERIFYING'; exitCode = $code } | ConvertTo-Json -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8
        $resulting = $null
        for ($attempt = 0; $attempt -lt 3; $attempt++) {
            try { $observed = Get-ExactInstalledPackage $operation.packageId; $resulting = [string]$observed.InstalledVersion } catch { $resulting = $null }
            if ($resulting -ceq $operation.targetVersion) { break }
            if ($attempt -lt 2) { Start-Sleep -Seconds 3 }
        }
        $outcome = 'FINISHED'; $errorMessage = $null
        # WinGet HRESULTs: reboot required and reboot initiated, plus Windows installer success/reboot codes.
        if ($code -in @(3010, 1641, -1978334967, -1978334966, -1978334965)) { $outcome = 'RESTART_REQUIRED' }
        elseif ($code -in @(1602, -1978334964, -1978335227)) { $outcome = 'CANCELLED' }
        elseif ($code -ne 0) { $outcome = 'FAILED'; $errorMessage = "WinGet returned exit code $code. Rescan before retrying. No automatic retry was performed." }
        @{ outcome = $outcome; exitCode = $code; resultingVersion = $resulting; error = $errorMessage } | ConvertTo-Json -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    } else { throw 'Operation is not allowlisted.' }
} catch {
    # Avoid returning arbitrary installer output, paths, credentials or exception internals.
    $message = 'Operation failed during validation or package-manager access. Check WinGet source availability, rescan and review the exact package.'
    if ($operation.operation -ceq 'SCAN') { @{ status = 'FAILED'; error = $message } | ConvertTo-Json -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8 }
    else { @{ outcome = 'FAILED'; exitCode = -1; resultingVersion = $null; error = $message } | ConvertTo-Json -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8 }
}
