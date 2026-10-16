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
function Request([string]$Url,$Route,[long]$Offset=-1,[string]$Method='GET'){
 $req=[Net.HttpWebRequest]::Create($Url);$req.Proxy=$Route.proxy;$req.UserAgent='RuoshuiComic-Installer';$req.Accept='application/octet-stream';$req.Timeout=15000;$req.ReadWriteTimeout=60000;$req.Method=$Method
 if($Offset -gt 0){$req.AddRange($Offset)}
 return $req.GetResponse()
}
$cache=[IO.Path]::GetFullPath((Join-Path $installRoot ('works/cache/installation-'+$spec.tag)))
if($VerifyOnly){$cache=$installRoot}
New-Item -ItemType Directory -Path $cache -Force|Out-Null
$metadata=$null
$metadataTried=$false
$checked=@()
foreach($pkg in $spec.packages){
 if($pkg.name -notmatch '^ruoshui-[\w.-]+\.zip$' -or $pkg.sha256 -notmatch '^[a-f0-9]{64}$' -or $pkg.size -le 0 -or $pkg.size -ge 2147483648){throw 'Invalid package record'}
 $file=SafePath $cache $pkg.name
 if(!(Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -ne $pkg.size -or (FileSha256 $file) -ne $pkg.sha256){
  if($VerifyOnly){throw ('Missing or invalid package: '+$pkg.name)}
  $direct='https://github.com/'+$spec.repository+'/releases/download/'+$spec.tag+'/'+$pkg.name
  $sources=@($direct)
  # Both sources belong to GitHub. No third-party proxy receives user data.
  if(!$metadataTried){$metadataTried=$true;foreach($route in $routes){try{$response=Request ('https://api.github.com/repos/'+$spec.repository+'/releases/tags/'+$spec.tag) $route;$reader=[IO.StreamReader]::new($response.GetResponseStream());try{$metadata=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose();$response.Dispose()};break}catch{}}}
  if($metadata){$asset=$metadata.assets|Where-Object {$_.name -eq $pkg.name}|Select-Object -First 1;if($asset){$sources+=('https://api.github.com/repos/'+$spec.repository+'/releases/assets/'+$asset.id)}}
  $ready=$false;$last='No available download route'
  foreach($source in $sources){foreach($route in $routes){
   try{
    Write-Output ('Downloading '+$pkg.name+' via '+$route.name)
    $offset=if(Test-Path -LiteralPath $file){(Get-Item -LiteralPath $file).Length}else{0}
    if($offset -ge $pkg.size){Remove-Item -LiteralPath $file -Force;$offset=0}
    $response=Request $source $route $offset
    try{
     if($response.ContentType -match 'json|text/html'){throw 'Source did not return a package'}
     $append=$offset -gt 0 -and [int]$response.StatusCode -eq 206
     if($append -and $response.Headers['Content-Range'] -notmatch ('^bytes '+$offset+'-')){throw 'Invalid resume response'}
     if(!$append){$offset=0}
     $mode=if($append){[IO.FileMode]::Append}else{[IO.FileMode]::Create}
     $stream=$response.GetResponseStream();$output=[IO.File]::Open($file,$mode,[IO.FileAccess]::Write,[IO.FileShare]::Read)
     try{$buffer=New-Object byte[] 1048576;$lastPercent=-10;while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){$offset+=$count;if($offset -gt $pkg.size){throw 'Package exceeds expected size'};$output.Write($buffer,0,$count);$percent=[int](100*$offset/$pkg.size);if($percent -ge $lastPercent+10){Write-Output ($pkg.name+' '+$percent+'%');$lastPercent=$percent}}}finally{$output.Dispose();$stream.Dispose()}
    }finally{$response.Dispose()}
    if((Get-Item -LiteralPath $file).Length -ne $pkg.size){throw 'Incomplete download; run installer again to resume'}
    if((FileSha256 $file) -ne $pkg.sha256){Remove-Item -LiteralPath $file -Force;throw 'Package checksum mismatch'}
    $ready=$true;break
   }catch{$last=$_.Exception.Message;Write-Output ('Trying another route: '+$last)}
  };if($ready){break}}
  if(!$ready){throw $last}
 }
 $checked+=$file
}
# Validate every archive before writing any program file. Personal data is never a destination.
$seen=@{}
foreach($file in $checked){$zip=[IO.Compression.ZipFile]::OpenRead($file);try{foreach($entry in $zip.Entries){if($entry.FullName.EndsWith('/')){continue};$dest=SafePath $installRoot $entry.FullName;if(!(ProgramPath $entry.FullName) -or $seen.ContainsKey($entry.FullName.ToLowerInvariant()) -or ($entry.ExternalAttributes -shr 16 -band 61440) -eq 40960){throw 'Unsafe or duplicate archive entry'};$seen[$entry.FullName.ToLowerInvariant()]=$true}}finally{$zip.Dispose()}}
if(!$seen.ContainsKey('resources/app.asar') -or !$seen.ContainsKey('runtime/python/python.exe')){throw 'Incomplete application packages'}
if($VerifyOnly){Write-Output 'All release packages verified';exit 0}
foreach($file in $checked){Write-Output ('Extracting '+[IO.Path]::GetFileName($file));$zip=[IO.Compression.ZipFile]::OpenRead($file);try{foreach($entry in $zip.Entries){if($entry.FullName.EndsWith('/')){continue};$dest=SafePath $installRoot $entry.FullName;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))|Out-Null;[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$dest,$true)}}finally{$zip.Dispose()}}
@{appId=$spec.appId;version=$spec.tag.TrimStart('v')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $installRoot 'ruoshui-installation.json') -Encoding UTF8
foreach($file in $checked){Remove-Item -LiteralPath $file -Force}
Write-Output 'Installation complete. Models can be downloaded inside the application.'
