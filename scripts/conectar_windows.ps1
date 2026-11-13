#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Conecta um cliente Windows 10/11 ao servidor VPN Mesh Vereda (Engecema).
.DESCRIPTION
  Script leve para registrar o servidor de controle Headscale da Engecema
  e conectar a estacao Windows ao tunel privado criptografado.
#>
[CmdletBinding()]
param(
  [Parameter()]
  [string]$ServerUrl = "https://engecema.com.br",

  [Parameter()]
  [string]$AuthKey = "",

  [Parameter()]
  [string]$Hostname = $env:COMPUTERNAME,

  [Parameter()]
  [bool]$AcceptRoutes = $true
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Validacao rigorosa de parametros contra injecao
$parsedUri = $null
if (-not [Uri]::TryCreate($ServerUrl, [UriKind]::Absolute, [ref]$parsedUri) -or $parsedUri.Scheme -ne "https") {
  throw "ServerUrl invalida. Informe uma URL HTTPS valida (ex.: https://engecema.com.br)."
}

$cleanHostname = ($Hostname -replace '[^a-zA-Z0-9-]', '-').Trim('-')
if ([string]::IsNullOrWhiteSpace($cleanHostname) -or $cleanHostname.Length -gt 63) {
  throw "Hostname invalido. Use apenas letras, numeros e hifen (ate 63 caracteres)."
}

if (-not [string]::IsNullOrWhiteSpace($AuthKey) -and ($AuthKey -notmatch '^[a-zA-Z0-9_-]{12,128}$')) {
  throw "Formato de AuthKey invalido."
}

function Get-TailscaleBinary {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $defaultPath = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path $defaultPath) { return $defaultPath }

  return $null
}

Write-Host "=== Vereda Mesh VPN — Conexao Windows 10 (Engecema) ===" -ForegroundColor Yellow

$tailscaleExe = Get-TailscaleBinary
if (-not $tailscaleExe) {
  Write-Host "[1/3] Cliente Tailscale nao encontrado. Iniciando instalacao segura..." -ForegroundColor Cyan
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    & winget install --id Tailscale.Tailscale --exact --silent --accept-source-agreements --accept-package-agreements
  } else {
    $msiPath = Join-Path $env:TEMP "tailscale-setup-vereda.msi"
    Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi" -OutFile $msiPath -UseBasicParsing
    Start-Process -FilePath "msiexec.exe" -ArgumentList "/i", "`"$msiPath`"", "/quiet", "/norestart" -Wait
    Remove-Item -Path $msiPath -Force -ErrorAction SilentlyContinue
  }

  $tailscaleExe = Get-TailscaleBinary
  if (-not $tailscaleExe) {
    throw "Nao foi possivel localizar tailscale.exe apos a instalacao."
  }
} else {
  Write-Host "[1/3] Cliente Tailscale detectado em: $tailscaleExe" -ForegroundColor Green
}

# Garante servico Tailscale em execucao
$svc = Get-Service -Name "Tailscale" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne "Running") {
  Start-Service -Name "Tailscale"
}

# Configura politica de servidor Headscale no Registro do Windows
Write-Host "[2/3] Configurando servidor de controle Vereda ($ServerUrl)..." -ForegroundColor Cyan
$regPath = "HKLM:\SOFTWARE\Tailscale IPN"
if (-not (Test-Path $regPath)) {
  New-Item -Path $regPath -Force | Out-Null
}
Set-ItemProperty -Path $regPath -Name "LoginURL" -Value $ServerUrl -Type String
Set-ItemProperty -Path $regPath -Name "UnattendedMode" -Value "always" -Type String

# Monta argumentos de forma segura (sem Invoke-Expression)
$argsList = @(
  "up",
  "--login-server=$ServerUrl",
  "--hostname=$cleanHostname",
  "--accept-dns=true"
)

if ($AcceptRoutes) {
  $argsList += "--accept-routes"
}

if (-not [string]::IsNullOrWhiteSpace($AuthKey)) {
  $argsList += "--authkey=$AuthKey"
}

Write-Host "[3/3] Conectando no tunel privado Engecema como '$cleanHostname'..." -ForegroundColor Cyan
& $tailscaleExe @argsList

if ($LASTEXITCODE -ne 0) {
  throw "Falha ao executar tailscale up (codigo $LASTEXITCODE)."
}

Write-Host ""
Write-Host "Conexao estabelecida com sucesso!" -ForegroundColor Green
& $tailscaleExe status
Write-Host "IP privado na rede Vereda:" -ForegroundColor Yellow
& $tailscaleExe ip -4
