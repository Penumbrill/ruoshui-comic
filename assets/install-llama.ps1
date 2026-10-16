param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$destination=[System.IO.Path]::GetFullPath($Target)
$zip=[System.IO.Compression.ZipFile]::OpenRead($Archive)
try {
 foreach($entry in $zip.Entries) {
  $resolved=[System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destination,$entry.FullName))
  if(!$resolved.StartsWith($destination+[System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Invalid archive path'}
 }
} finally {$zip.Dispose()}
Expand-Archive -LiteralPath $Archive -DestinationPath $destination -Force
$server=Get-ChildItem -LiteralPath $destination -Filter llama-server.exe -Recurse | Select-Object -First 1
if(!$server){throw 'llama-server.exe not found'}
if($server.DirectoryName -ne $destination){Get-ChildItem -LiteralPath $server.DirectoryName -File | Copy-Item -Destination $destination -Force}
