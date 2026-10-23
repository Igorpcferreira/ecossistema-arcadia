<#
.SYNOPSIS
  Arcadia: imprime os comandos para abrir (ou fechar) a visualização na rede de casa.

.DESCRIPTION
  Este script só lê o estado da rede e imprime comandos; não muda nada. Os comandos impressos
  são rodados por você, num PowerShell aberto como administrador, quando for a hora de ver o
  Arcadia no celular.

  Abrir faz duas coisas:
  1. a Wi-Fi conectada agora (a de casa) vira rede Privada; as outras redes continuam como estão,
     e toda rede nova continua Pública;
  2. entra uma regra de entrada só para a porta da visualização, só no perfil Privado e só para
     a sub-rede local. Fora de casa a porta continua fechada.

  Desfazer remove a regra e devolve a Wi-Fi ao perfil Público.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\rede-local.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\rede-local.ps1 -Desfazer
#>
param(
  [switch]$Desfazer,
  [int]$Porta = 4780,
  [string]$Interface = 'Wi-Fi'
)

$regra = 'Arcadia (rede local)'
$perfil = Get-NetConnectionProfile -InterfaceAlias $Interface -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $perfil) {
  Write-Output "Nenhuma rede conectada na interface '$Interface'. Conecte na Wi-Fi de casa e rode de novo (ou informe -Interface)."
  exit 1
}
$rede = $perfil.Name
$redeAspas = $rede -replace "'", "''"
$ip = (Get-NetIPAddress -InterfaceAlias $Interface -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
$existe = [bool](Get-NetFirewallRule -DisplayName $regra -ErrorAction SilentlyContinue)

Write-Output "Rede conectada em '$Interface': '$rede', perfil $($perfil.NetworkCategory)."
Write-Output ("Regra '{0}': {1}." -f $regra, $(if ($existe) { 'já existe' } else { 'ainda não existe' }))
Write-Output ''

if (-not $Desfazer) {
  Write-Output 'Para abrir, num PowerShell como administrador, com o PC na Wi-Fi de casa:'
  Write-Output ''
  Write-Output "Set-NetConnectionProfile -Name '$redeAspas' -NetworkCategory Private"
  Write-Output "New-NetFirewallRule -DisplayName '$regra' -Group 'Arcadia' -Description 'Visualização do Arcadia no celular, só na rede de casa' -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile Private -RemoteAddress LocalSubnet"
  Write-Output ''
  Write-Output 'Para conferir (não precisa de administrador):'
  Write-Output ''
  Write-Output "Get-NetConnectionProfile -Name '$redeAspas' | Select-Object Name, NetworkCategory"
  Write-Output "Get-NetFirewallRule -DisplayName '$regra' | Select-Object DisplayName, Enabled, Profile, Direction, Action"
  Write-Output ''
  if ($ip) { Write-Output "No celular, na mesma Wi-Fi: http://${ip}:$Porta (quando o Arcadia estiver servindo na rede)." }
} else {
  Write-Output 'Para desfazer, num PowerShell como administrador:'
  Write-Output ''
  Write-Output "Remove-NetFirewallRule -DisplayName '$regra'"
  Write-Output "Set-NetConnectionProfile -Name '$redeAspas' -NetworkCategory Public"
}
