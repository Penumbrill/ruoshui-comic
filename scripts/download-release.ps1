param([Parameter(Mandatory=$true)][string]$Target,[Parameter(Mandatory=$true)][string]$Manifest,[switch]$VerifyOnly)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem
$installRoot=[IO.Path]::GetFullPath($Target).TrimEnd('\','/')
if($installRoot -eq [IO.Path]::GetPathRoot($installRoot) -or (Test-Path -LiteralPath (Join-Path $installRoot '.git'))){throw 'Choose a dedicated installation folder'}
if(Test-Path -LiteralPath $installRoot){
 if((Get-Item -LiteralPath $installRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked installation folder'}
 $marker=Join-Path $installRoot 'ruoshui-installation.json'
 $owned=$false
 if(Test-Path -LiteralPath $marker){$owned=(Get-Content -LiteralPath $marker -Raw -Encoding UTF8|ConvertFrom-Json).appId -eq 'com.guangyingruoshui.comic'}
 if(!$VerifyOnly -and !$owned -and (Get-ChildItem -LiteralPath $installRoot -Force|Where-Object {$_.Name -ne 'works'}|Select-Object -First 1)){throw 'Choose an empty dedicated folder or an existing managed installation'}
}
$spec=Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8|ConvertFrom-Json
if($spec.appId -ne 'com.guangyingruoshui.comic' -or $spec.repository -ne 'Penumbrill/ruoshui-comic' -or $spec.tag -notmatch '^v[\w.+-]+$' -or !$spec.packages){throw 'Invalid release manifest'}
function FileSha256([string]$Full){$hash=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($Full);try{return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','')}finally{$stream.Dispose();$hash.Dispose()}}
function SafePath([string]$Base,[string]$Name){
 if($Name.Contains('\') -or $Name.Contains(':') -or ($Name.Split('/')|Where-Object {$_ -eq '..' -or $_ -eq '.' -or $_ -eq ''})){throw 'Unsafe archive path'}
 $full=[IO.Path]::GetFullPath([IO.Path]::Combine($Base,$Name))
 if(!$full.StartsWith($Base+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Archive path escapes installation'}
 $parent=$full
 while($parent -and $parent.Length -ge $installRoot.Length){if([IO.File]::Exists($parent) -or [IO.Directory]::Exists($parent)){if([IO.File]::GetAttributes($parent) -band [IO.FileAttributes]::ReparsePoint){throw 'Linked installation path'}};$parent=[IO.Path]::GetDirectoryName($parent)}
 return $full
}
function ProgramPath([string]$Name){
 if($Name -match '^(works|models|\.git|\.codex|\.agents)(/|$)' -or $Name -match '\.(safetensors|ckpt|gguf|onnx|pt|pth)$'){return $false}
 if($Name.StartsWith('runtime/')){return $Name -match '^runtime/(python|ComfyUI|llama-official)/' -and $Name -notmatch '^runtime/ComfyUI/(models|input|output|temp|user)(/|$)' -and $Name -notmatch '(^|/)(cache|downloads|\.git|__pycache__|user_data|user_data_old|lora_userdatas|translate_userdatas|random_tag)(/|$)' -and $Name -notmatch '(^|/)(extra_model_paths\.ya?ml|init\.json|user_cloud_package\.json|tag_labels\.json)$'}
 return $Name -match '^(resources/|locales/)' -or $Name -match '^[^/]+\.(exe|dll|pak|dat|bin|json|txt|md|html)$' -or $Name -eq 'version'
}
$routes=@()
$envProxy=$env:HTTPS_PROXY;if(!$envProxy){$envProxy=$env:HTTP_PROXY}
if($envProxy){try{$routes+=@{name='environment proxy';proxy=[Net.WebProxy]::new($envProxy)}}catch{}}
$routes+=@{name='Windows network';proxy=[Net.WebRequest]::DefaultWebProxy}
$routes+=@{name='direct';proxy=$null}
$cache=[IO.Path]::GetFullPath((Join-Path $installRoot ('works/cache/installation-'+$spec.tag)))
if($VerifyOnly){$cache=$installRoot}
New-Item -ItemType Directory -Path $cache -Force|Out-Null
$checked=@()
foreach($pkg in $spec.packages){
 if($pkg.name -notmatch '^ruoshui-[\w.-]+\.zip$' -or $pkg.sha256 -notmatch '^[a-f0-9]{64}$' -or $pkg.size -le 0 -or $pkg.size -ge 2147483648){throw 'Invalid package record'}
 $file=SafePath $cache $pkg.name
 if(!(Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -ne $pkg.size -or (FileSha256 $file) -ne $pkg.sha256){
  if($VerifyOnly){throw ('Missing or invalid package: '+$pkg.name)}
  $direct='https://github.com/'+$spec.repository+'/releases/download/'+$spec.tag+'/'+$pkg.name+'?ruoshui_sha256='+$pkg.sha256
  $sources=@($direct)
  # Only public release bytes are routed through mirrors; pinned SHA256 is mandatory.
  $publicMirrors=@('https://gh-proxy.org/','https://ghfast.top/')|ForEach-Object {$_+$direct}
  $preferProxy=$false
  foreach($route in $routes){if($route.proxy){try{if(!$route.proxy.IsBypassed([Uri]$direct)){$preferProxy=$true;break}}catch{}}}
  $sources=if($preferProxy){@($sources)+@($publicMirrors)}else{@($publicMirrors)+@($sources)}
  if(!('RuoshuiReleaseTransfer' -as [type])){
   $helper=Join-Path $PSScriptRoot 'release-transfer.cs'
   if(!(Test-Path -LiteralPath $helper)){$helper=Join-Path $PSScriptRoot '../assets/release-transfer.cs'}
   Add-Type -Path $helper
  }
  Write-Output ('Downloading '+$pkg.name+' with source selection and up to 4 continuous ranges')
  [RuoshuiReleaseTransfer]::Download([string[]]$sources,[Net.IWebProxy[]]@($routes|ForEach-Object {$_.proxy}),$file,[long]$pkg.size,[string]$pkg.sha256,$preferProxy)

 }
 $checked+=$file
}
# Validate every archive before writing any program file. Personal data is never a destination.
$seen=@{}
foreach($file in $checked){$zip=[IO.Compression.ZipFile]::OpenRead($file);try{foreach($entry in $zip.Entries){if($entry.FullName.EndsWith('/')){continue};$dest=SafePath $installRoot $entry.FullName;if(!(ProgramPath $entry.FullName) -or $seen.ContainsKey($entry.FullName.ToLowerInvariant()) -or ($entry.ExternalAttributes -shr 16 -band 61440) -eq 40960){throw 'Unsafe or duplicate archive entry'};$seen[$entry.FullName.ToLowerInvariant()]=$true}}finally{$zip.Dispose()}}
if(!$seen.ContainsKey('resources/app.asar') -or !$seen.ContainsKey('runtime/python/python.exe')){throw 'Incomplete application packages'}
if($VerifyOnly){Write-Output 'All release packages verified';exit 0}
foreach($file in $checked){Write-Output ('Extracting '+[IO.Path]::GetFileName($file));$zip=[IO.Compression.ZipFile]::OpenRead($file);try{foreach($entry in $zip.Entries){if($entry.FullName.EndsWith('/')){continue};$dest=SafePath $installRoot $entry.FullName;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))|Out-Null;[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$dest,$true)}}finally{$zip.Dispose()}}
if(Test-Path -LiteralPath (Join-Path $installRoot 'ruoshui-comic.exe')){$legacy=SafePath $installRoot '若水漫画.exe';if([IO.File]::Exists($legacy)){Remove-Item -LiteralPath $legacy -Force}}
@{appId=$spec.appId;version=$spec.tag.TrimStart('v')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $installRoot 'ruoshui-installation.json') -Encoding UTF8
foreach($file in $checked){Remove-Item -LiteralPath $file -Force}
Write-Output 'Installation complete. Models can be downloaded inside the application.'
