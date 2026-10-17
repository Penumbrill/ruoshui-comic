param([ValidateSet('prepare','apply','uninstall')][string]$Mode,[Parameter(Mandatory=$true)][string]$Plan)
$ErrorActionPreference='Stop'
$taskPlan=Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
if($taskPlan.appId -ne 'com.guangyingruoshui.comic'){throw 'Invalid application identity'}
$taskRoot=[IO.Path]::GetFullPath($taskPlan.root).TrimEnd('\','/')
function FileSha256([string]$Full){$hash=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($Full);try{return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','')}finally{$stream.Dispose();$hash.Dispose()}}
function ChildPath([string]$Base,[string]$Name){
 $full=[IO.Path]::GetFullPath([IO.Path]::Combine($Base,$Name))
 if(!$full.StartsWith($Base+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Path leaves declared directory'}
 return $full
}
function IsProgram([string]$Name){
 if(!$Name -or $Name.Contains('\') -or $Name.Contains(':') -or ($Name.Split('/') | Where-Object {$_ -eq '' -or $_ -eq '.' -or $_ -eq '..'})){return $false}
 if($Name -match '^(works|models|\.git|\.codex|\.agents)(/|$)' -or $Name -match '\.(safetensors|ckpt|gguf|onnx|pt)$'){return $false}
 if($Name.StartsWith('runtime/')){return ($Name -match '^runtime/(python|llama-official|ComfyUI)/' -and $Name -notmatch '^runtime/ComfyUI/(models|input|output|temp|user)(/|$)' -and $Name -notmatch '(^|/)(cache|downloads|user_data|user_data_old|lora_userdatas|translate_userdatas|random_tag|\.git|__pycache__)(/|$)' -and $Name -notmatch '(^|/)(extra_model_paths\.ya?ml|init\.json|user_cloud_package\.json|tag_labels\.json)$')}
 return ($Name -eq 'version' -or $Name -match '^(resources|locales)/' -or ($Name -notmatch '/' -and $Name -match '\.(exe|dll|pak|dat|bin|json|txt|md|html)$'))
}
function AssertNoLinks([string]$Base,[string]$Full){
 $current=$Full
 while($current -and $current.Length -ge $Base.Length){
  if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Refusing linked update path'}}
  $current=[IO.Path]::GetDirectoryName($current)
 }
}
if($Mode -eq 'prepare'){
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $staging=[IO.Path]::GetFullPath($taskPlan.staging)
 $updates=ChildPath $taskRoot 'works/updates'
 if($staging -ne (ChildPath $updates 'staging')){throw 'Invalid staging location'}
 AssertNoLinks $taskRoot $staging
 $zip=[IO.Compression.ZipFile]::OpenRead($taskPlan.archive)
 try {
  if($zip.Entries.Count -gt 100001){throw 'Too many update files'}
  $entry=$zip.GetEntry('ruoshui-update.json');if(!$entry -or $entry.Length -gt 33554432){throw 'Missing update manifest'}
  $reader=[IO.StreamReader]::new($entry.Open());try{$manifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
  if($manifest.appId -ne $taskPlan.appId -or !$manifest.files -or $manifest.files.Count -gt 100000){throw 'Invalid update manifest'}
  $seen=@{};$total=0
  foreach($file in $manifest.files){
   if(!(IsProgram $file.path) -or $seen.ContainsKey($file.path.ToLowerInvariant()) -or $file.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $file.size -lt 0){throw 'Unsafe update entry'}
   $seen[$file.path.ToLowerInvariant()]=$file;$total+=$file.size
  }
  if(!$seen.ContainsKey('resources/app.asar') -or $total -gt 34359738368){throw 'Incomplete or oversized update'}
  $archiveNames=@{}
  foreach($entry in $zip.Entries){
   if($entry.FullName.EndsWith('/')){continue}
   if($archiveNames.ContainsKey($entry.FullName.ToLowerInvariant())){throw 'Duplicate archive file'}
   $archiveNames[$entry.FullName.ToLowerInvariant()]=$true
   if($entry.FullName -ne 'ruoshui-update.json' -and !$seen.ContainsKey($entry.FullName.ToLowerInvariant())){throw 'Unlisted archive file'}
   if(($entry.ExternalAttributes -shr 16 -band 61440) -eq 40960){throw 'Linked archive file'}
   $dest=ChildPath $staging $entry.FullName;AssertNoLinks $taskRoot $dest
   New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($dest)) -Force|Out-Null
   [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$dest,$true)
  }
  foreach($file in $manifest.files){$full=ChildPath $staging $file.path;if((Get-Item -LiteralPath $full).Length -ne $file.size -or (FileSha256 $full) -ne $file.sha256){throw 'Update checksum mismatch'}}
 }finally{$zip.Dispose()}
 exit 0
}
if($taskRoot -eq [IO.Path]::GetPathRoot($taskRoot) -or $taskRoot.Split('\').Count -lt 3 -or (Test-Path -LiteralPath (Join-Path $taskRoot '.git'))){throw 'Refusing source checkout or unsafe installation root'}
AssertNoLinks $taskRoot $taskRoot
$marker=Get-Content -LiteralPath (Join-Path $taskRoot 'ruoshui-installation.json') -Raw|ConvertFrom-Json
if($marker.appId -ne $taskPlan.appId){throw 'Installation identity mismatch'}
if($taskPlan.pid -gt 0){Wait-Process -Id $taskPlan.pid -ErrorAction SilentlyContinue}
if($Mode -eq 'apply'){
 $staging=ChildPath $taskRoot 'works/updates/staging'
 $manifest=Get-Content -LiteralPath (Join-Path $staging 'ruoshui-update.json') -Raw -Encoding UTF8|ConvertFrom-Json
 if($manifest.appId -ne $taskPlan.appId){throw 'Update identity mismatch'}
 $backup=ChildPath $taskRoot ('works/updates/rollback-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
 $changed=[Collections.Generic.List[object]]::new()
 try {
  foreach($file in $manifest.files){
   if(!(IsProgram $file.path)){throw 'Protected file in update'}
   $src=ChildPath $staging $file.path;$dest=ChildPath $taskRoot $file.path;AssertNoLinks $taskRoot $src;AssertNoLinks $taskRoot $dest
   if((Get-Item -LiteralPath $src).Length -ne $file.size -or (FileSha256 $src) -ne $file.sha256){throw 'Staged file changed'}
  }
  foreach($file in $manifest.files){
   $src=ChildPath $staging $file.path;$dest=ChildPath $taskRoot $file.path;$old=ChildPath $backup $file.path;$existed=Test-Path -LiteralPath $dest
   if($existed){New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($old)) -Force|Out-Null;Copy-Item -LiteralPath $dest -Destination $old}
   $changed.Add(@{path=$file.path;existed=$existed});New-Item -ItemType Directory -Path $backup -Force|Out-Null;$changed|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'journal.json') -Encoding UTF8
   New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($dest)) -Force|Out-Null
   Copy-Item -LiteralPath $src -Destination ($dest+'.updating') -Force;Move-Item -LiteralPath ($dest+'.updating') -Destination $dest -Force
  }
  if($manifest.files.path -contains 'ruoshui-comic.exe'){
   $legacy=ChildPath $taskRoot '若水漫画.exe';AssertNoLinks $taskRoot $legacy
   if(Test-Path -LiteralPath $legacy){$old=ChildPath $backup '若水漫画.exe';Copy-Item -LiteralPath $legacy -Destination $old;$changed.Add(@{path='若水漫画.exe';existed=$true});$changed|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'journal.json') -Encoding UTF8;Remove-Item -LiteralPath $legacy -Force}
  }
  @{version=$manifest.version;completed=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $backup 'success.json') -Encoding UTF8
  @{version=$manifest.version;completed=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRoot 'works/updates/completed.json') -Encoding UTF8
 }catch{
  foreach($item in $changed){$dest=ChildPath $taskRoot $item.path;if($item.existed){Copy-Item -LiteralPath (ChildPath $backup $item.path) -Destination $dest -Force}else{Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue}}
  throw
 }
 $executable=ChildPath $taskRoot 'ruoshui-comic.exe'
 if($taskPlan.restart -ne $false){Start-Process -FilePath $executable -WorkingDirectory $taskRoot -WindowStyle Hidden}
 exit 0
}
if($Mode -eq 'uninstall'){
 function RemoveOwned([string]$Full){
  $rel=$Full.Substring($taskRoot.Length).TrimStart('\','/').Replace('\','/')
  if($taskPlan.keepWorks -and ($rel -eq 'works' -or $rel.StartsWith('works/'))){return}
  if($taskPlan.keepModels -and ($rel -eq 'runtime/ComfyUI/models' -or $rel.StartsWith('runtime/ComfyUI/models/'))){return}
  $item=Get-Item -LiteralPath $Full -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){if($item.PSIsContainer){[IO.Directory]::Delete($Full,$false)}else{[IO.File]::Delete($Full)};return}
  if($item.PSIsContainer){foreach($child in Get-ChildItem -LiteralPath $Full -Force){$resolved=[IO.Path]::GetFullPath($child.FullName);if(!$resolved.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe removal path'};RemoveOwned $resolved};if(!(Get-ChildItem -LiteralPath $Full -Force|Select-Object -First 1)){Remove-Item -LiteralPath $Full -Force}}
  else{if(!$taskPlan.skipUninstaller -or $item.Name -notmatch '^Uninstall.*\.exe$'){Remove-Item -LiteralPath $Full -Force}}
 }
 foreach($entry in Get-ChildItem -LiteralPath $taskRoot -Force){RemoveOwned $entry.FullName}
 if(!(Get-ChildItem -LiteralPath $taskRoot -Force|Select-Object -First 1)){Remove-Item -LiteralPath $taskRoot -Force}
 $registration='HKCU:\Software\RuoshuiComic'
 if(Test-Path -LiteralPath $registration){$location=(Get-ItemProperty -LiteralPath $registration -ErrorAction SilentlyContinue).InstallLocation;if($location -and [IO.Path]::GetFullPath($location).TrimEnd('\') -eq $taskRoot){Remove-Item -LiteralPath $registration -Force}}
 $uninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
 foreach($key in Get-ChildItem -LiteralPath $uninstallKey -ErrorAction SilentlyContinue){$value=Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue;if($value.DisplayName -in @('若水漫画','Ruoshui Comic') -and $value.InstallLocation -and [IO.Path]::GetFullPath($value.InstallLocation).TrimEnd('\') -eq $taskRoot){Remove-Item -LiteralPath $key.PSPath -Force}}
 $shortcutShell=New-Object -ComObject WScript.Shell
 foreach($folder in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){foreach($name in @('Ruoshui Comic.lnk','若水漫画.lnk')){$shortcut=Join-Path $folder $name;if(Test-Path -LiteralPath $shortcut){$target=$shortcutShell.CreateShortcut($shortcut).TargetPath;if($target -and [IO.Path]::GetFullPath($target) -in @((Join-Path $taskRoot 'ruoshui-comic.exe'),(Join-Path $taskRoot '若水漫画.exe'))){Remove-Item -LiteralPath $shortcut -Force}}}}
}
