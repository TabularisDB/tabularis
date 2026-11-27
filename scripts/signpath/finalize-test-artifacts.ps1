param(
    [Parameter(Mandatory)][string]$SignedDirectory,
    [Parameter(Mandatory)][string]$ExpectedSignerSha256,
    [Parameter(Mandatory)][string]$SignedAppSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$config = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$version = $config.version
$expectedNames = @("tabularis_${version}_x64-setup.exe", "tabularis_${version}_x64_en-US.msi")
$installers = @(Get-ChildItem -LiteralPath $SignedDirectory -Recurse -File -Force)
if ($installers.Count -ne 2 -or @(Compare-Object $expectedNames @($installers.Name)).Count -ne 0) {
    throw 'SignPath must return exactly the expected NSIS and MSI files'
}
if ((Get-FileHash src-tauri/target/release/tabularis.exe).Hash -ne $SignedAppSha256) {
    throw 'Bundling changed the signed application executable'
}

# Use the official Minisign verifier, pinned by version and archive SHA-256.
$archive = Join-Path $env:RUNNER_TEMP 'minisign-0.12-win64.zip'
Invoke-WebRequest 'https://github.com/jedisct1/minisign/releases/download/0.12/minisign-0.12-win64.zip' -OutFile $archive
if ((Get-FileHash $archive).Hash -ne '37B600344E20C19314B2E82813DB2BFDCC408B77B876F7727889DBD46D539479') {
    throw 'Minisign archive checksum mismatch'
}
$toolsDirectory = Join-Path $env:RUNNER_TEMP 'signpath-verification-tools'
Expand-Archive $archive -DestinationPath $toolsDirectory
$minisign = Join-Path $toolsDirectory 'minisign-win64/x86_64/minisign.exe'
$publicKeyFile = Join-Path $env:RUNNER_TEMP 'tabularis-updater.pub'
[IO.File]::WriteAllBytes($publicKeyFile, [Convert]::FromBase64String($config.plugins.updater.pubkey))

New-Item -ItemType Directory -Path signpath-results -Force | Out-Null
foreach ($installer in $installers) {
    $output = Join-Path (Resolve-Path signpath-results) $installer.Name
    Copy-Item -LiteralPath $installer.FullName -Destination $output
    # No .sig is made before Authenticode signing. Use the existing updater key.
    pnpm tauri signer sign $output
    if ($LASTEXITCODE -ne 0) { throw "Updater signing failed: $output" }
    $decodedSignature = Join-Path $env:RUNNER_TEMP "$($installer.Name).minisig"
    [IO.File]::WriteAllBytes($decodedSignature, [Convert]::FromBase64String((Get-Content "$output.sig" -Raw).Trim()))
    & $minisign -Vm $output -x $decodedSignature -p $publicKeyFile
    if ($LASTEXITCODE -ne 0) { throw "Updater signature verification failed: $output" }

    # A stale signature must reject modified installer bytes.
    $tampered = Join-Path $env:RUNNER_TEMP "tampered-$($installer.Name)"
    Copy-Item $output $tampered
    $stream = [IO.File]::Open($tampered, [IO.FileMode]::Append)
    try { $stream.WriteByte(1) } finally { $stream.Dispose() }
    & $minisign -Vm $tampered -x $decodedSignature -p $publicKeyFile
    if ($LASTEXITCODE -eq 0) { throw 'Updater verifier accepted a tampered installer' }
    $global:LASTEXITCODE = 0
}

$portableDirectory = Join-Path $env:RUNNER_TEMP 'signpath-portable'
New-Item -ItemType Directory -Path $portableDirectory | Out-Null
Copy-Item src-tauri/target/release/tabularis.exe $portableDirectory
Copy-Item packages/web-ui/dist (Join-Path $portableDirectory 'web-ui') -Recurse
$portable = "signpath-results/tabularis_${version}_x64-portable.zip"
Compress-Archive -Path "$portableDirectory/*" -DestinationPath $portable
$expanded = Join-Path $env:RUNNER_TEMP 'signpath-portable-verified'
Expand-Archive $portable -DestinationPath $expanded
if ((Get-FileHash "$expanded/tabularis.exe").Hash -ne $SignedAppSha256 -or
    (Get-FileHash "$expanded/web-ui/index.html").Hash -ne (Get-FileHash packages/web-ui/dist/index.html).Hash) {
    throw 'Portable archive contents do not match the signed build'
}
& "$PSScriptRoot/verify-authenticode.ps1" -Paths "$expanded/tabularis.exe" -ExpectedSignerSha256 $ExpectedSignerSha256 |
    ConvertTo-Json -Depth 5 | Set-Content signpath-results/portable-authenticode.json

@"
TEST CERTIFICATE ONLY - NOT FOR REDISTRIBUTION
Commit: $env:GITHUB_SHA
Run: https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID
Signer SHA-256: $ExpectedSignerSha256
Application request: $env:APP_SIGNING_REQUEST
Installer request: $env:INSTALLER_SIGNING_REQUEST
No GitHub Release or latest.json was created or changed.
"@ | Set-Content signpath-results/TEST-ONLY.txt
Get-ChildItem signpath-results -File | Get-FileHash -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_.Path))" } |
    Set-Content signpath-results/SHA256SUMS
