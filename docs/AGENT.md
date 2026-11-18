# Windows agent operations

Run from the repository root as the same normal Windows account that owns the applications. Windows PowerShell 5.1 is supported. The Microsoft module is pinned to 1.29.380 and stays under `.local/modules`; setup and every runtime import verify the primary cmdlets DLL's Microsoft Authenticode signature. This does not attest every file or sign UpdatePilot's own scripts. Setup stages new downloads and verifies before moving them into the version directory. The new-download branch was reviewed, not executed during the assessment. It never invokes package-manager repair, resets sources, or installs unrelated applications.

```powershell
npm run agent:setup
# Existing setup, no download:
npm run agent:check
# Unpaired read-only comparison, no update processing:
npm run agent:scan:check
npm run agent
# After credential revocation/expiry:
npm run agent -- -Pair
```

Generate the one-use pairing code from authenticated Settings first. Default credential path is `%LOCALAPPDATA%/UpdatePilot/credential.xml`. `Export-Clixml` stores its PSCredential with Windows user/machine DPAPI. ACL setup grants only the current SID and SYSTEM. Moving the file to a different user or computer will not decrypt it.

`Start-Agent.ps1` defaults to the normal fixed loopback backend `http://127.0.0.1:4310`. The isolated browser test backend on `127.0.0.1:4311` is allowed only with an explicitly supplied `-CredentialPath`, preventing normal stored credentials being sent there. For a deployed backend, explicitly supply `-BackendUrl https://YOUR-BACKEND-HOST -Pair`; HTTPS DNS origins on port 443 are supported with certificate validation, TLS 1.2 and no redirects. Cloud credentials use separate backend-specific DPAPI storage and cannot be reused against another origin. Plaintext remote HTTP, URL credentials, query strings and non-root paths are rejected. See [cloud setup](DEPLOYMENT.md). The agent reports health, claims a job once, and launches `Invoke-Operation.ps1` through a local PowerShell job. A named per-device mutex rejects duplicate agent instances. Progress/heartbeat is sent roughly every five seconds while a worker runs. The execution lease expires after 90 seconds; an old lease cannot submit a result after recovery. All connections are outbound; no Windows listener or port forwarding is introduced.

The operation allowlist is `SCAN` and `UPDATE`. `Agent.Core.psm1` performs identity/source/version validation independently of the server. `Get-WinGetPackage` supplies structured `Id`, `Source`, `InstalledVersion`, `AvailableVersions` and `IsUpdateAvailable` fields. Versions follow the catalog's ordering. An exact installed/source version match is needed to claim current; missing or newer-than-source metadata stays unverified. Duplicate identities are update-ineligible. Unmatched ARP/MSIX identities are never guessed.

Update workers recheck exact correlation and target availability immediately before calling the fixed WinGet argument vector, then re-observe the installed package up to three times. No installer retry occurs. The agent sends safe exit codes and generic category diagnostics instead of arbitrary installer output. Known WinGet/Windows reboot and cancellation codes are classified separately; other nonzero codes are failures. Restart is never automatic. Detailed package-manager diagnostics remain in WinGet's own local logs for the operator.

Scan timeout is five minutes; update timeout is twenty. The worker is stopped on timeout or failed communication, but publisher installer child processes may outlive it. The outcome is interrupted/unknown, never success or rollback. If the agent restarts, it does not resume or replay the installer. Check Windows, wait for any active installer to stop, then rescan and review a new approval before retrying. The API expires abandoned jobs in its maintenance loop.

Connection retries back off up to 30 seconds; after five consecutive failures the agent exits with a warning. Expired/revoked credentials require explicit re-pairing. Health prerequisites are evaluated at startup, so restart after fixing module/WinGet/source availability. `MODULE_UNAVAILABLE`, `WINGET_UNAVAILABLE` and `SOURCE_UNAVAILABLE` are displayed in Settings.

For automated integration, `-Once` runs a single poll and fails nonzero on health/communication errors, `-CredentialPath` isolates credential storage, and `-PairingCodePath` reads a one-use code from a protected local test file. The browser suite queues only SCAN for the real agent; `-Once` itself is not a read-only switch and can process an approved UPDATE. These options do not enable arbitrary commands, change trust or bypass pairing. Never pass permanent bearer credentials on the command line. Interactive users should use the normal hidden pairing-code prompt.

Authoritative references used for the structured integration and code classification:

- [Microsoft Get-WinGetPackage contract](https://github.com/microsoft/winget-cli/blob/master/src/PowerShell/Help/Microsoft.WinGet.Client/Get-WinGetPackage.md)
- [Microsoft WinGet module distribution](https://www.powershellgallery.com/packages/Microsoft.WinGet.Client/1.29.380)
- [WinGet result codes](https://github.com/microsoft/winget-cli/blob/master/src/AppInstallerSharedLib/Public/AppInstallerErrors.h)
