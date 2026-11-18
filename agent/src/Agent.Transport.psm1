Set-StrictMode -Version Latest
function Resolve-AgentBackend {
    param([string]$BackendUrl, [string]$CredentialPath)
    $uri = $null
    if (-not [Uri]::TryCreate($BackendUrl, [UriKind]::Absolute, [ref]$uri)) { throw 'Invalid backend URL.' }
    if ($uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') { throw 'Backend URL must be an origin without credentials, path, query or fragment.' }
    $local = $uri.Scheme -ceq 'http' -and $uri.Host -ceq '127.0.0.1' -and $uri.Port -in @(4310,4311)
    $remote = $uri.Scheme -ceq 'https' -and $uri.Port -eq 443 -and -not $uri.IsLoopback -and $uri.HostNameType -eq [UriHostNameType]::Dns
    if (-not ($local -or $remote)) { throw 'Use fixed HTTP loopback ports 4310/4311 or a trusted HTTPS backend hostname on port 443.' }
    if ($uri.Port -eq 4311 -and -not $CredentialPath) { throw 'The isolated test backend requires an explicit separate credential path.' }
    return $uri.GetLeftPart([UriPartial]::Authority)
}
function Assert-AgentBackendIdentity {
    param($Identity, [string]$BackendUrl)
    if ($null -ne $Identity.PSObject.Properties['BackendUrl']) {
        if ($Identity.BackendUrl -cne $BackendUrl) { throw 'Stored credential belongs to another backend. Use a separate credential path and pair explicitly.' }
    } elseif ($BackendUrl -cne 'http://127.0.0.1:4310') {
        throw 'Legacy credentials are only valid for the local backend. Pair explicitly with this backend.'
    }
}
Export-ModuleMember -Function Resolve-AgentBackend, Assert-AgentBackendIdentity
