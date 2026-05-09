param(
  [string]$HostName = "14.103.219.42",
  [string]$User = "root"
)

$localScript = Join-Path $PSScriptRoot "connect-backend.local.ps1"
if (Test-Path -LiteralPath $localScript) {
  & $localScript -HostName $HostName -User $User
  exit $LASTEXITCODE
}

ssh -o StrictHostKeyChecking=accept-new "$User@$HostName"
