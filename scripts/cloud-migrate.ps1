# Cloud (Supabase) par pending migrations lagata hai. Password kahin save nahi hota.
$ErrorActionPreference = "Stop"
$projectRef = "qtvettmzlrrtvurtdceg"
$poolerHost = "aws-0-ap-south-1.pooler.supabase.com"

$sec = Read-Host "Supabase database password" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
    $pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $enc = [uri]::EscapeDataString($pw)
    $env:DATABASE_URL = "postgresql://postgres.${projectRef}:${enc}@${poolerHost}:5432/postgres"
    $env:DIRECT_URL = $env:DATABASE_URL
    Write-Host "Target: ${poolerHost}:5432 (project $projectRef)"
    $answer = Read-Host "Cloud database par migrations lagani hain? (yes/no)"
    if ($answer -ne "yes") { Write-Host "Cancelled."; return }
    npx prisma migrate status
    npx prisma migrate deploy
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:DIRECT_URL -ErrorAction SilentlyContinue
    $pw = $null; $enc = $null
}