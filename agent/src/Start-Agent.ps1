param([string]$BackendUrl = 'http://127.0.0.1:4310', [switch]$Pair, [switch]$Once, [string]$CredentialPath, [string]$PairingCodePath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$version = '0.1.0'
Import-Module (Join-Path $PSScriptRoot 'Agent.Transport.psm1') -Force
$BackendUrl = Resolve-AgentBackend $BackendUrl $CredentialPath
if ($BackendUrl.StartsWith('https://')) { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }
Import-Module (Join-Path $PSScriptRoot 'Agent.Core.psm1') -Force
$store = Join-Path $env:LOCALAPPDATA 'UpdatePilot'
if (-not $CredentialPath) { $CredentialPath = Join-Path $store 'credential.xml' }
if ($BackendUrl.StartsWith('https://') -and -not $PSBoundParameters.ContainsKey('CredentialPath')) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $targetHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($BackendUrl))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
    $CredentialPath = Join-Path (Join-Path $store "cloud-$targetHash") 'credential.xml'
}
New-Item -ItemType Directory -Path (Split-Path $CredentialPath -Parent) -Force | Out-Null
# DPAPI is user + machine bound. Restrict the directory to the current SID and SYSTEM.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$null = & icacls (Split-Path $CredentialPath -Parent) /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F'
if ($LASTEXITCODE -ne 0) { throw 'Unable to protect agent credential directory.' }
$identity = $null
if ((Test-Path $CredentialPath) -and -not $Pair) {
    $identity = Import-Clixml -LiteralPath $CredentialPath
    Assert-AgentBackendIdentity $identity $BackendUrl
}
else {
    if ($PairingCodePath) { $code = (Get-Content -LiteralPath $PairingCodePath -Raw).Trim() }
    else { $codeSecure = Read-Host 'Enter the one-use code from Settings & Agent' -AsSecureString; $code = [Net.NetworkCredential]::new('', $codeSecure).Password }
    if ($code -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid pairing code format.' }
    $payload = @{ code = $code; name = $env:COMPUTERNAME; os = [Environment]::OSVersion.VersionString; agentVersion = $version } | ConvertTo-Json -Compress
    $paired = Invoke-RestMethod -Uri "$BackendUrl/api/v1/agent/pair" -Method Post -ContentType 'application/json' -Body $payload -TimeoutSec 15 -MaximumRedirection 0
    $identity = [PSCustomObject]@{ BackendUrl = $BackendUrl; DeviceId = $paired.data.deviceId; Credential = [PSCredential]::new('updatepilot', (ConvertTo-SecureString $paired.data.token -AsPlainText -Force)) }
    $identity | Export-Clixml -LiteralPath $CredentialPath
    $code = $null; $payload = $null; $paired = $null
    Write-Output 'Device paired. Credential is protected with Windows DPAPI.'
}
$token = $identity.Credential.GetNetworkCredential().Password
function Send-AgentRequest {
    param([string]$Path, [hashtable]$Body)
    $headers = @{ Authorization = "Bearer $token"; 'X-Agent-Timestamp' = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); 'X-Request-ID' = [guid]::NewGuid().ToString() }
    # Every request uses a fresh nonce. Result submission is never retried with a new operation.
    $json = $Body | ConvertTo-Json -Depth 12 -Compress
    Invoke-RestMethod -Uri "$BackendUrl/api/v1/agent$Path" -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 15 -MaximumRedirection 0
}
$health = 'READY'; $wingetVersion = $null
try { $wingetVersion = [string](& winget --version); if ($LASTEXITCODE -ne 0) { $health = 'WINGET_UNAVAILABLE' } } catch { $health = 'WINGET_UNAVAILABLE' }
if ($health -eq 'READY') { try { Import-PackageClient } catch { $health = 'MODULE_UNAVAILABLE' } }
if ($health -eq 'READY') { try { Assert-TrustedSource } catch { $health = 'SOURCE_UNAVAILABLE' } }
# A single active instance owns this user credential; reboot/restart never resumes an installer.
$mutex = [Threading.Mutex]::new($false, "Local\UpdatePilot-$($identity.DeviceId)")
if (-not $mutex.WaitOne(0)) { throw 'An agent for this device is already running.' }
Write-Output "UpdatePilot agent $version. Health: $health. Press Ctrl+C to stop."
$worker = $null; $workDir = $null; $failures = 0
try {
    do {
        try {
            $null = Send-AgentRequest '/heartbeat' @{ agentVersion = $version; wingetVersion = $wingetVersion; health = $health }
            if ($health -ne 'READY') { if ($Once) { throw "Agent cannot scan: $health." }; Write-Output "Agent cannot scan: $health. Stop, fix setup and restart."; Start-Sleep -Seconds 15; continue }
            $claimed = Send-AgentRequest '/jobs/claim' @{}
            $operation = $claimed.data
            if ($operation) {
                if ($operation.operation -cnotin @('SCAN', 'UPDATE') -or $operation.id -notmatch '^[a-f0-9-]{36}$' -or $operation.lease -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid operation envelope.' }
                if ($operation.operation -ceq 'UPDATE') { Assert-UpdateOperation $operation }
                $workDir = Join-Path (Split-Path $CredentialPath -Parent) ([guid]::NewGuid().ToString())
                New-Item -ItemType Directory -Path $workDir | Out-Null
                $inputFile = Join-Path $workDir 'input.json'; $outputFile = Join-Path $workDir 'output.json'
                # The backend persists the claimed lease before this worker launches. Lost results never requeue.
                $operation | Select-Object operation, packageId, source, previousVersion, targetVersion | ConvertTo-Json -Compress | Set-Content -LiteralPath $inputFile -Encoding UTF8
                Write-Output "Starting $($operation.operation) job $($operation.id)."
                $runner = Join-Path $PSScriptRoot 'Invoke-Operation.ps1'
                $worker = Start-Job -ScriptBlock { param($Runner, $InputFile, $OutputFile) & $Runner -InputPath $InputFile -OutputPath $OutputFile } -ArgumentList $runner, $inputFile, $outputFile
                $deadline = [DateTime]::UtcNow.AddMinutes($(if ($operation.operation -ceq 'SCAN') { 5 } else { 20 }))
                $phase = 'RUNNING'; $timedOut = $false
                while ($worker.State -eq 'Running') {
                    if ([DateTime]::UtcNow -gt $deadline) { $timedOut = $true; Stop-Job $worker; break }
                    if (Test-Path $outputFile) {
                        try { $partial = Get-Content -LiteralPath $outputFile -Raw | ConvertFrom-Json; if ($partial.PSObject.Properties.Name -contains 'phase' -and $partial.phase -ceq 'VERIFYING') { $phase = 'VERIFYING' } } catch { <# Atomic writer can briefly be between writes. #> }
                    }
                    $null = Send-AgentRequest "/jobs/$($operation.id)/progress" @{ lease = $operation.lease; status = $phase }
                    $null = Send-AgentRequest '/heartbeat' @{ agentVersion = $version; wingetVersion = $wingetVersion; health = $health }
                    $null = Wait-Job $worker -Timeout 5
                }
                if ($timedOut) {
                    if ($operation.operation -ceq 'SCAN') { $result = @{ status = 'INTERRUPTED'; error = 'Scan timed out. No inventory was replaced.' } }
                    else { $result = @{ outcome = 'INTERRUPTED'; exitCode = -1; resultingVersion = $null; error = 'Operation timed out. Installer may still be running. Do not retry until the installer stops and a fresh scan is reviewed.' } }
                } elseif ((Test-Path $outputFile) -and $worker.State -eq 'Completed') {
                    $resultObject = Get-Content -LiteralPath $outputFile -Raw | ConvertFrom-Json
                    $result = @{}; foreach ($property in $resultObject.PSObject.Properties) { $result[$property.Name] = $property.Value }
                } else {
                    if ($operation.operation -ceq 'SCAN') { $result = @{ status = 'FAILED'; error = 'Scan worker exited without a result.' } }
                    else { $result = @{ outcome = 'INTERRUPTED'; exitCode = -1; resultingVersion = $null; error = 'Worker exited without a verified result. Rescan before any retry.' } }
                }
                $result.lease = $operation.lease
                if ($operation.operation -ceq 'UPDATE') {
                    # Fast installers may finish before the parent observes the intermediate file.
                    if ($result.outcome -in @('FINISHED','RESTART_REQUIRED')) { $null = Send-AgentRequest "/jobs/$($operation.id)/progress" @{ lease = $operation.lease; status = 'VERIFYING' } }
                    $result.packageId = $operation.packageId; $result.source = 'winget'
                    $answer = Send-AgentRequest "/jobs/$($operation.id)/update-result" $result
                } else { $answer = Send-AgentRequest "/jobs/$($operation.id)/scan-result" $result }
                Write-Output "Job result recorded for $($operation.id)."
                Remove-Job $worker -Force; $worker = $null
                # Only this freshly generated, credential-directory child is cleaned up.
                $resolvedWork = [IO.Path]::GetFullPath($workDir)
                $allowedRoot = [IO.Path]::GetFullPath((Split-Path $CredentialPath -Parent)) + [IO.Path]::DirectorySeparatorChar
                if (-not $resolvedWork.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid work directory.' }
                Remove-Item -LiteralPath $resolvedWork -Recurse -Force; $workDir = $null
            }
            $failures = 0
        } catch {
            if ($worker) { Stop-Job $worker -ErrorAction SilentlyContinue; Remove-Job $worker -Force -ErrorAction SilentlyContinue; $worker = $null }
            $failures++
            Write-Warning 'Agent communication or operation failed. An interrupted operation is never rerun. Check connectivity and device credentials; re-pair if revoked or expired.'
            if ($Once) { throw 'Single-pass agent failed. Check connectivity, credentials and agent health.' }
            if ($failures -ge 5) { throw 'Agent stopped after five consecutive failures. Fix connectivity or pair again, then restart.' }
        }
        if (-not $Once) { Start-Sleep -Seconds ([Math]::Min(30, 5 * [Math]::Max(1, $failures))) }
    } while (-not $Once)
} finally {
    if ($worker) { Stop-Job $worker -ErrorAction SilentlyContinue; Remove-Job $worker -Force -ErrorAction SilentlyContinue }
    $token = $null; $mutex.ReleaseMutex(); $mutex.Dispose()
}
