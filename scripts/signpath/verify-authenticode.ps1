param(
    [Parameter(Mandatory)][string[]]$Paths,
    [Parameter(Mandatory)][string]$ExpectedSignerSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

foreach ($path in $Paths) {
    $file = Get-Item -LiteralPath $path
    if ($file.PSIsContainer) { throw "Expected a signed file: $path" }
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) {
        throw "Invalid Authenticode signature on $path : $($signature.Status) - $($signature.StatusMessage)"
    }
    $signerHash = [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData($signature.SignerCertificate.RawData)
    )
    if ($signerHash -cne $ExpectedSignerSha256) {
        throw "Unexpected signing certificate on $path : $signerHash"
    }
    if (-not $signature.TimeStamperCertificate) {
        throw "No Authenticode timestamp on $path"
    }
    [pscustomobject]@{
        file = $file.Name
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        size = $file.Length
        signerSha256 = $signerHash
        signerSubject = $signature.SignerCertificate.Subject
        timestampSubject = $signature.TimeStamperCertificate.Subject
        status = $signature.Status.ToString()
    }
}
