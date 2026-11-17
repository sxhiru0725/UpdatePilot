$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '..\src\Agent.Core.psm1') -Force
$script:passed = 0
function Assert-True { param([bool]$Condition, [string]$Description) if (-not $Condition) { throw "FAIL: $Description" }; $script:passed++; Write-Output "PASS: $Description" }
function Assert-Rejected { param([scriptblock]$Action, [string]$Description) $rejected = $false; try { & $Action } catch { $rejected = $true }; Assert-True $rejected $Description }
$valid = [PSCustomObject]@{ operation = 'UPDATE'; source = 'winget'; packageId = 'Vendor.App'; previousVersion = '1.0'; targetVersion = '2.0' }
Assert-UpdateOperation $valid
Assert-True $true 'Accepts validated exact update envelope'
foreach ($id in @('Vendor.App; whoami', '--all', 'Vendor/App', 'Vendor.App$(Get-Content secret)', "Vendor.App`n--force", "Vendor.App`n")) {
    $copy = $valid.PSObject.Copy(); $copy.packageId = $id
    Assert-Rejected { Assert-UpdateOperation $copy } 'Rejects package command injection'
}
$copy = $valid.PSObject.Copy(); $copy.source = 'untrusted'; Assert-Rejected { Assert-UpdateOperation $copy } 'Rejects untrusted source'
$copy = $valid.PSObject.Copy(); $copy.operation = 'SHELL'; Assert-Rejected { Assert-UpdateOperation $copy } 'Rejects non-allowlisted operation'
$copy = $valid.PSObject.Copy(); $copy.previousVersion = 'Unknown'; Assert-Rejected { Assert-UpdateOperation $copy } 'Rejects unknown installed version'
$copy = $valid.PSObject.Copy(); $copy.targetVersion = '1.0'; Assert-Rejected { Assert-UpdateOperation $copy } 'Rejects identical target'
$module = Get-Module 'Agent.Core'
Assert-Rejected { Assert-PackageClientSignature (Join-Path $PSScriptRoot 'missing-module.psd1') } 'Rejects a missing cached module'
& $module {
    function script:Test-Path { param([string]$LiteralPath) return $true }
    function script:Get-AuthenticodeSignature { param([string]$LiteralPath) [PSCustomObject]@{ Status = 'HashMismatch'; SignerCertificate = [PSCustomObject]@{ Subject = 'O=Microsoft Corporation, C=US' } } }
}
Assert-Rejected { Assert-PackageClientSignature (Join-Path $PSScriptRoot 'fixture.psd1') } 'Rejects cached module signature failure'
& $module {
    function script:Get-AuthenticodeSignature { param([string]$LiteralPath) [PSCustomObject]@{ Status = 'Valid'; SignerCertificate = [PSCustomObject]@{ Subject = 'O=Untrusted Publisher, C=US' } } }
}
Assert-Rejected { Assert-PackageClientSignature (Join-Path $PSScriptRoot 'fixture.psd1') } 'Rejects a signed binary from another publisher'
& $module { Remove-Item Function:Test-Path; Remove-Item Function:Get-AuthenticodeSignature }
& $module {
    function script:Get-WinGetSource { [PSCustomObject]@{ Name = 'winget'; Argument = 'https://attacker.invalid/cache' } }
}
Assert-Rejected { Assert-TrustedSource } 'Rejects altered winget source URL'
& $module {
    function script:Get-WinGetSource { [PSCustomObject]@{ Name = 'winget'; Argument = 'https://cdn.winget.microsoft.com/cache' } }
    function script:Get-WinGetPackage {
        @([PSCustomObject]@{ Id = 'Vendor.App'; Source = 'winget'; Name = 'Fixture'; InstalledVersion = '1.0'; AvailableVersions = @('2.0','1.0'); IsUpdateAvailable = $true }, [PSCustomObject]@{ Id = 'ARP\Fixture'; Source = ''; Name = 'Unmatched'; InstalledVersion = ''; AvailableVersions = @(); IsUpdateAvailable = $false })
    }
}
$inventory = @(Get-AgentInventory)
Assert-True ($inventory.Count -eq 2 -and $inventory[0].status -eq 'UPDATE_AVAILABLE') 'Uses structured catalog update evidence'
Assert-True ($inventory[1].status -eq 'UNMATCHED' -and $null -eq $inventory[1].packageId) 'Does not guess unmatched package IDs'
& $module {
    function script:Get-WinGetPackage { [PSCustomObject]@{ Id = 'Vendor.App'; Source = 'winget'; Name = 'Fixture'; InstalledVersion = '1.1'; AvailableVersions = @('2.0'); IsUpdateAvailable = $true } }
}
Assert-Rejected { Assert-ApprovedTarget $valid } 'Rejects changed installed version after approval'
& $module {
    function script:Get-WinGetPackage { [PSCustomObject]@{ Id = 'Vendor.App'; Source = 'winget'; Name = 'Fixture'; InstalledVersion = '1.0'; AvailableVersions = @('3.0'); IsUpdateAvailable = $true } }
}
Assert-Rejected { Assert-ApprovedTarget $valid } 'Rejects missing approved target'
& $module {
    function script:Get-WinGetPackage { [PSCustomObject]@{ Id = 'Vendor.App'; Source = 'winget'; Name = 'Fixture'; InstalledVersion = '1.0'; AvailableVersions = @('2.0'); IsUpdateAvailable = $true } }
    function script:winget { $script:CapturedArguments = @($args); $script:LASTEXITCODE = 5 }
}
$code = Invoke-WinGetUpgrade $valid
Assert-True ($code -eq 5) 'Preserves non-zero package-manager exit codes'
$captured = & $module { $script:CapturedArguments }
Assert-True ($captured -contains '--exact' -and $captured -contains 'Vendor.App' -and $captured -contains '2.0') 'Executes only the exact approved identity and target'
Assert-True ($captured -notcontains '--force' -and $captured -notcontains '--ignore-security-hash' -and $captured -notcontains '--allow-reboot') 'Never weakens installer checks or requests reboot'
& $module { function script:winget { $script:LASTEXITCODE = 0 } }
Assert-True ((Invoke-WinGetUpgrade $valid) -eq 0) 'Captures zero exit without claiming version verification'
& $module {
    # Harmless native helper exercises Windows PowerShell 5.1 stderr behavior; never calls WinGet.
    Remove-Variable -Name LASTEXITCODE -Scope Script -ErrorAction SilentlyContinue
    function script:winget { & node -e 'process.stderr.write(String.fromCharCode(100));process.exit(5)' }
}
$nativeCode = Invoke-WinGetUpgrade $valid
Assert-True ($nativeCode -eq 5) "Native diagnostic stderr preserves the actual failure exit code (observed $nativeCode)"
Assert-True ((& $module { $ErrorActionPreference }) -eq 'Stop') 'Restores strict PowerShell error handling after native execution'
# Execute the actual worker with its external boundaries replaced by local fixtures.
# Import is intercepted so the worker cannot replace these mocks with the real client.
$fixtureRoot = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) ('.local\worker-test-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $fixtureRoot
$inputFile = Join-Path $fixtureRoot 'input.json'; $outputFile = Join-Path $fixtureRoot 'output.json'
$global:UpdatePilotWorkerFixture = @{}
function script:Import-Module { param($Name, [switch]$Force) }
function script:Import-PackageClient { }
function script:Assert-ApprovedTarget { param($Operation) if ($global:UpdatePilotWorkerFixture.Reject) { throw 'Controlled validation failure' } }
function script:Invoke-WinGetUpgrade { param($Operation) $global:UpdatePilotWorkerFixture.Invocations++; return $global:UpdatePilotWorkerFixture.ExitCode }
function script:Get-ExactInstalledPackage { param($Id) $global:UpdatePilotWorkerFixture.Observations++; [PSCustomObject]@{ InstalledVersion = $global:UpdatePilotWorkerFixture.Version } }
function script:Start-Sleep { param($Seconds) $global:UpdatePilotWorkerFixture.Waits++ }
try {
    $valid | ConvertTo-Json | Set-Content -LiteralPath $inputFile -Encoding UTF8
    foreach ($case in @(
        @{ Name = 'verified target'; Code = 0; Version = '2.0'; Outcome = 'FINISHED'; Observations = 1 },
        @{ Name = 'unchanged installed version'; Code = 0; Version = '1.0'; Outcome = 'FINISHED'; Observations = 3 },
        @{ Name = 'failed installer'; Code = 5; Version = '2.0'; Outcome = 'FAILED'; Observations = 1 },
        @{ Name = 'reboot required'; Code = 3010; Version = '2.0'; Outcome = 'RESTART_REQUIRED'; Observations = 1 },
        @{ Name = 'installer cancelled'; Code = 1602; Version = '1.0'; Outcome = 'CANCELLED'; Observations = 3 }
    )) {
        $global:UpdatePilotWorkerFixture.Reject = $false; $global:UpdatePilotWorkerFixture.ExitCode = $case.Code; $global:UpdatePilotWorkerFixture.Version = $case.Version
        $global:UpdatePilotWorkerFixture.Invocations = 0; $global:UpdatePilotWorkerFixture.Observations = 0; $global:UpdatePilotWorkerFixture.Waits = 0
        & (Join-Path $PSScriptRoot '..\src\Invoke-Operation.ps1') -InputPath $inputFile -OutputPath $outputFile
        $result = Get-Content -LiteralPath $outputFile -Raw | ConvertFrom-Json
        Assert-True ($result.outcome -eq $case.Outcome -and $result.exitCode -eq $case.Code -and $result.resultingVersion -eq $case.Version -and $global:UpdatePilotWorkerFixture.Invocations -eq 1 -and $global:UpdatePilotWorkerFixture.Observations -eq $case.Observations -and $global:UpdatePilotWorkerFixture.Waits -eq ($case.Observations - 1)) "Actual worker fixture: $($case.Name), bounded post-operation observations and no installer retry"
    }
    $global:UpdatePilotWorkerFixture.Reject = $true; $global:UpdatePilotWorkerFixture.Invocations = 0
    & (Join-Path $PSScriptRoot '..\src\Invoke-Operation.ps1') -InputPath $inputFile -OutputPath $outputFile
    $result = Get-Content -LiteralPath $outputFile -Raw | ConvertFrom-Json
    Assert-True ($result.outcome -eq 'FAILED' -and $result.exitCode -eq -1 -and $global:UpdatePilotWorkerFixture.Invocations -eq 0) 'Worker validation failure never invokes installer boundary'
} finally {
    foreach ($name in @('Import-Module', 'Import-PackageClient', 'Assert-ApprovedTarget', 'Invoke-WinGetUpgrade', 'Get-ExactInstalledPackage', 'Start-Sleep')) { Remove-Item "Function:$name" }
    foreach ($file in @($inputFile, $outputFile)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
    Remove-Item -LiteralPath $fixtureRoot
    Remove-Variable -Name UpdatePilotWorkerFixture -Scope Global
}
# Parse all scripts, including failure and timeout paths, without executing any installer.
foreach ($file in Get-ChildItem (Join-Path $PSScriptRoot '..') -Recurse -Include '*.ps1','*.psm1') {
    $tokens = $null; $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0) "PowerShell parses: $($file.Name)"
}
Write-Output "$script:passed agent checks passed. No applications were modified."
