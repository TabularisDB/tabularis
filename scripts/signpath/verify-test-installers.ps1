param(
    [Parameter(Mandatory)][string]$SignedDirectory,
    [Parameter(Mandatory)][string]$ExpectedSignerSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$config = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$expectedNames = @("tabularis_$($config.version)_x64-setup.exe", "tabularis_$($config.version)_x64_en-US.msi")
$files = @(Get-ChildItem -LiteralPath $SignedDirectory -Recurse -File -Force)
if ($files.Count -ne 2 -or @(Compare-Object $expectedNames @($files.Name)).Count -ne 0) {
    throw 'SignPath must return exactly the expected NSIS and MSI files'
}
$report = @(& "$PSScriptRoot/verify-authenticode.ps1" -Paths $files.FullName -ExpectedSignerSha256 $ExpectedSignerSha256)
New-Item -ItemType Directory -Path signpath-results -Force | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content signpath-results/installers-authenticode.json

# Validate the MSI payload without installing it, and a real silent NSIS install.
# This runs only on the disposable GitHub-hosted Windows runner.
foreach ($kind in @('msi', 'nsis')) {
    $destination = Join-Path $env:RUNNER_TEMP "tabularis-signpath-$kind"
    if (Test-Path $destination) { throw "Test directory already exists: $destination" }
    if ($kind -eq 'msi') {
        $installer = $files | Where-Object Extension -eq '.msi'
        $process = Start-Process msiexec.exe -ArgumentList @('/a', "`"$($installer.FullName)`"", '/qn', "TARGETDIR=`"$destination`"") -Wait -PassThru
    } else {
        $installer = $files | Where-Object Extension -eq '.exe'
        $process = Start-Process $installer.FullName -ArgumentList @('/S', "/D=$destination") -Wait -PassThru
    }
    if ($process.ExitCode -ne 0) { throw "$kind returned exit code $($process.ExitCode)" }
    $apps = @(Get-ChildItem $destination -Recurse -File -Filter tabularis.exe)
    if ($apps.Count -ne 1) { throw "Expected exactly one tabularis.exe in $kind payload" }
    & "$PSScriptRoot/verify-authenticode.ps1" -Paths $apps[0].FullName -ExpectedSignerSha256 $ExpectedSignerSha256 |
        ConvertTo-Json -Depth 5 | Set-Content "signpath-results/$kind-payload-authenticode.json"
    $index = Join-Path $apps[0].DirectoryName 'web-ui/index.html'
    if (-not (Test-Path $index) -or
        (Get-FileHash $index).Hash -ne (Get-FileHash packages/web-ui/dist/index.html).Hash) {
        throw "$kind Web UI does not match the built distribution"
    }
    if (@(Get-ChildItem (Join-Path $apps[0].DirectoryName 'web-ui/assets') -Recurse -File).Count -eq 0) {
        throw "$kind Web UI assets are missing"
    }
}
