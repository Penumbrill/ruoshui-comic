param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Plan,[Parameter(Mandatory=$true)][string]$Helper)
$ErrorActionPreference='Stop'
$p=Get-Content -LiteralPath $Plan -Raw|ConvertFrom-Json
$p|Add-Member -MemberType NoteProperty -Name root -Value ([IO.Path]::GetFullPath($Root)) -Force
$p|Add-Member -MemberType NoteProperty -Name skipUninstaller -Value $true -Force
$p|ConvertTo-Json|Set-Content -LiteralPath $Plan -Encoding UTF8
& $Helper -Mode uninstall -Plan $Plan
