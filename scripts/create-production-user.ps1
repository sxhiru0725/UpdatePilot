param([string]$WebOrigin = 'https://frontend-sxhiru.vercel.app')
# Run locally from the repository root. Keep the local .env and account unchanged.
$ErrorActionPreference = 'Stop'
$names = @('DATABASE_URL', 'WEB_ORIGIN', 'NODE_ENV', 'HOST')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $secureUrl = Read-Host 'Paste the cloud database connection string (hidden)' -AsSecureString
    $env:DATABASE_URL = [Net.NetworkCredential]::new('', $secureUrl).Password
    $databaseUri = $null
    if (-not [Uri]::TryCreate($env:DATABASE_URL, [UriKind]::Absolute, [ref]$databaseUri) -or $databaseUri.Scheme -notin @('postgres','postgresql') -or $databaseUri.IsLoopback -or $databaseUri.Query -notmatch '(?:\?|&)sslmode=(?:require|verify-full)(?:&|$)') { throw 'Use a cloud PostgreSQL connection string requiring TLS.' }
    $env:WEB_ORIGIN = $WebOrigin
    $env:NODE_ENV = 'production'
    $env:HOST = '127.0.0.1'
    # The CLI prompts for the email and a hidden password; it creates no default account.
    & npm run user:create
    if ($LASTEXITCODE -ne 0) { throw 'Production account creation failed.' }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    $secureUrl = $null
}
