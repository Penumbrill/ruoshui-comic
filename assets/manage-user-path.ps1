param([ValidateSet('Add','Remove','Status')][string]$Mode,[Parameter(Mandatory=$true)][string]$Target,[switch]$PlanOnly,[string]$ExistingPath,[string]$TrackedPath)
$ErrorActionPreference='Stop'
$targetPath=[IO.Path]::GetFullPath($Target).TrimEnd('\','/')
if($targetPath.Contains(';') -or $targetPath.Contains("`n") -or $targetPath -eq [IO.Path]::GetPathRoot($targetPath)){throw 'Invalid application PATH entry'}
function Normalize([string]$Value){return [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"')).TrimEnd('\','/').ToLowerInvariant()}
if($Mode -eq 'Status'){
 $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
 try{$userPath=if($key){[string]$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{''}}finally{if($key){$key.Dispose()}}
 @{registered=[bool]($userPath.Split(';')|Where-Object {(Normalize $_) -eq (Normalize $targetPath)})}|ConvertTo-Json -Compress
 exit 0
}
$environmentKey=$null;$applicationKey=$null
if(!$PlanOnly){
 $environmentKey=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
 $applicationKey=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\RuoshuiComic')
 $ExistingPath=[string]$environmentKey.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
 $TrackedPath=[string]$applicationKey.GetValue('AddedPath','')
}
$entries=@();if($ExistingPath){$entries=@($ExistingPath.Split(';'))}
$changed=$false;$tracked=$TrackedPath
if($Mode -eq 'Add'){
 if($TrackedPath -and (Normalize $TrackedPath) -ne (Normalize $targetPath)){
  $filtered=@($entries|Where-Object {(Normalize $_) -ne (Normalize $TrackedPath)})
  $changed=$filtered.Count -ne $entries.Count;$entries=$filtered;$tracked=''
 }
 if(!($entries|Where-Object {(Normalize $_) -eq (Normalize $targetPath)})){
  $entries+=$targetPath;$changed=$true;$tracked=$targetPath
 }
}elseif($TrackedPath -and (Normalize $TrackedPath) -eq (Normalize $targetPath)){
 $filtered=@($entries|Where-Object {(Normalize $_) -ne (Normalize $TrackedPath)})
 $changed=$filtered.Count -ne $entries.Count;$entries=$filtered;$tracked=''
}
$nextPath=$entries -join ';'
if($PlanOnly){@{path=$nextPath;trackedPath=$tracked;changed=$changed}|ConvertTo-Json -Compress;exit 0}
try{
 if($changed){$environmentKey.SetValue('Path',$nextPath,[Microsoft.Win32.RegistryValueKind]::ExpandString)}
 if($tracked){$applicationKey.SetValue('AddedPath',$tracked,[Microsoft.Win32.RegistryValueKind]::String)}elseif($Mode -eq 'Remove' -or $TrackedPath){$applicationKey.DeleteValue('AddedPath',$false)}
}finally{$environmentKey.Dispose();$applicationKey.Dispose()}
if($changed){
 Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class RuoshuiEnvironmentBroadcast{[DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint Msg,UIntPtr wParam,string lParam,uint flags,uint timeout,out UIntPtr result);}'
 $broadcastResult=[UIntPtr]::Zero
 [RuoshuiEnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff,0x1a,[UIntPtr]::Zero,'Environment',2,5000,[ref]$broadcastResult)|Out-Null
}
Write-Output ('User PATH '+$Mode+' completed. Open a new terminal to use the updated PATH.')
