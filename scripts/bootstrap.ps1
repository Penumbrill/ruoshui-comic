param([Parameter(Mandatory=$true)][string]$Target, [switch]$PlanOnly)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$taskRoot=[IO.Path]::GetFullPath($Target)
$runtimeRoot=Join-Path $taskRoot 'runtime'
$pythonRoot=Join-Path $runtimeRoot 'python'
$comfyRoot=Join-Path $runtimeRoot 'ComfyUI'
$downloadRoot=Join-Path $runtimeRoot 'downloads'
$pythonUrl='https://www.python.org/ftp/python/3.13.6/python-3.13.6-embed-amd64.zip'
$comfyUrl='https://github.com/Comfy-Org/ComfyUI/archive/6b747c0428c343e1417219641db93a4fb7cb69ae.zip'
if($PlanOnly){Write-Output "Target: $taskRoot";Write-Output "Python: $pythonUrl";Write-Output "ComfyUI: $comfyUrl";exit 0}
try {
 New-Item -ItemType Directory -Path $downloadRoot,$pythonRoot,$comfyRoot -Force | Out-Null
 if(-not (Test-Path -LiteralPath (Join-Path $pythonRoot 'python.exe'))) {
  Write-Output '[1/5] Download Python 3.13.6 from python.org'
  $pythonZip=Join-Path $downloadRoot 'python-3.13.6.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $pythonUrl -OutFile $pythonZip
  Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonRoot -Force
 }
 $pth=Join-Path $pythonRoot 'python313._pth'
 @('python313.zip','.','Lib/site-packages','../ComfyUI','import site') | Set-Content -LiteralPath $pth -Encoding ascii
 $pythonExe=Join-Path $pythonRoot 'python.exe'
 & $pythonExe -c "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('pip') else 1)"
 if($LASTEXITCODE -ne 0) {
  Write-Output '[2/5] Prepare pip inside the dedicated Python'
  $getPip=Join-Path $downloadRoot 'get-pip.py'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip
  & $pythonExe $getPip --no-warn-script-location
  if($LASTEXITCODE -ne 0){throw 'pip installation failed'}
 }
 if(-not (Test-Path -LiteralPath (Join-Path $comfyRoot 'main.py'))) {
  Write-Output '[3/5] Download pinned ComfyUI 0.38.0'
  $comfyZip=Join-Path $downloadRoot 'ComfyUI.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $comfyUrl -OutFile $comfyZip
  $unzipRoot=Join-Path $downloadRoot 'comfy-extracted'
  Expand-Archive -LiteralPath $comfyZip -DestinationPath $unzipRoot -Force
  $sourceRoot=Join-Path $unzipRoot 'ComfyUI-6b747c0428c343e1417219641db93a4fb7cb69ae'
  Get-ChildItem -LiteralPath $sourceRoot -Force | Copy-Item -Destination $comfyRoot -Recurse -Force
 }
 Write-Output '[4/5] Install GPU / CPU dependencies in this app only'
 $gpuAvailable=$false
 try { $gpuName=& nvidia-smi --query-gpu=name --format=csv,noheader 2>$null; $gpuAvailable=$LASTEXITCODE -eq 0 } catch {}
 $torchIndex=if($gpuAvailable){'https://download.pytorch.org/whl/cu130'}else{'https://download.pytorch.org/whl/cpu'}
 & $pythonExe -m pip install torch torchvision --index-url $torchIndex --no-warn-script-location
 if($LASTEXITCODE -ne 0){throw 'PyTorch installation failed; check driver and network'}
 & $pythonExe -m pip install -r (Join-Path $comfyRoot 'requirements.txt') --no-warn-script-location
 if($LASTEXITCODE -ne 0){throw 'ComfyUI dependency installation failed'}
 Write-Output '[5/5] Install inpainting, face / hand and upscale nodes'
 $plugins=@(
  @('ComfyUI-Anima-LLLite','https://github.com/kohya-ss/ComfyUI-Anima-LLLite/archive/refs/heads/main.zip'),
  @('ComfyUI-Impact-Pack','https://github.com/ltdrdata/ComfyUI-Impact-Pack/archive/refs/heads/Main.zip'),
  @('comfyui-impact-subpack','https://github.com/ltdrdata/ComfyUI-Impact-Subpack/archive/refs/heads/main.zip'),
  @('comfyui_ultimatesdupscale','https://github.com/ssitu/ComfyUI_UltimateSDUpscale/archive/refs/heads/master.zip')
 )
 foreach($plugin in $plugins) {
  $pluginName=$plugin[0];$destination=Join-Path $comfyRoot "custom_nodes\$pluginName"
  if(-not (Test-Path -LiteralPath (Join-Path $destination '__init__.py'))) {
   $zip=Join-Path $downloadRoot "$pluginName.zip";$stage=Join-Path $downloadRoot "$pluginName-extracted"
   Invoke-WebRequest -UseBasicParsing -Uri $plugin[1] -OutFile $zip
   Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
   $unpacked=Get-ChildItem -LiteralPath $stage -Directory | Select-Object -First 1
   New-Item -ItemType Directory -Path $destination -Force | Out-Null
   Get-ChildItem -LiteralPath $unpacked.FullName -Force | Copy-Item -Destination $destination -Recurse -Force
  }
 }
 $ultimateRoot=Join-Path $comfyRoot 'custom_nodes/comfyui_ultimatesdupscale/repositories/ultimate_sd_upscale'
 if(-not (Test-Path -LiteralPath (Join-Path $ultimateRoot 'scripts/ultimate-upscale.py'))) {
  $ultimateZip=Join-Path $downloadRoot 'ultimate-sd-upscale.zip';$ultimateStage=Join-Path $downloadRoot 'ultimate-extracted'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/Coyote-A/ultimate-upscale-for-automatic1111/archive/refs/heads/master.zip' -OutFile $ultimateZip
  Expand-Archive -LiteralPath $ultimateZip -DestinationPath $ultimateStage -Force
  $ultimateSource=Get-ChildItem -LiteralPath $ultimateStage -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Path $ultimateRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $ultimateSource.FullName -Force | Copy-Item -Destination $ultimateRoot -Recurse -Force
 }
 & $pythonExe -m pip install transformers sentencepiece sacremoses onnxruntime==1.24.3 ultralytics piexif dill scikit-image segment-anything matplotlib huggingface-hub opencv-python --no-warn-script-location
 if($LASTEXITCODE -ne 0){throw 'Finishing-tool dependencies failed'}
 Write-Output 'Environment ready. Restart the app and run the environment check.'
 exit 0
} catch {Write-Output "INSTALL FAILED: $($_.Exception.Message)";exit 1}
