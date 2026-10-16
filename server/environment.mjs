import {about} from '../shared/about.mjs';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const links={developer:about.profile,project:about.repository,deepseek:'https://platform.deepseek.com/api_keys',vc:'https://aka.ms/vs/17/release/vc_redist.x64.exe',driver:'https://www.nvidia.com/Download/index.aspx',cuda:'https://developer.nvidia.com/cuda-downloads',python:'https://www.python.org/downloads/windows/',original:'https://huggingface.co/circlestone-labs/Anima',expanded:'https://huggingface.co/Gazingstars123/Anima-2.9B',comfy:'https://github.com/Comfy-Org/ComfyUI'};
async function run(file,args,timeout=25000){try{return{stdout:(await exec(file,args,{timeout,windowsHide:true,maxBuffer:1024*1024})).stdout.trim()};}catch(error){return{stdout:'',error:error.killed?'检测超时':error.code==='ENOENT'?'检测程序不存在':error.code==='EPERM'?'暂时无法启动检测程序':'检测程序未能完成'};}}
export async function inspectEnvironment(root,{runtime=path.join(root,'runtime'),runner=run}={}){
 runtime=path.resolve(runtime);const python=path.join(runtime,'python/python.exe'),comfy=path.join(runtime,'ComfyUI/main.py'),pythonInstalled=fs.existsSync(python),comfyInstalled=fs.existsSync(comfy),torchInstalled=fs.existsSync(path.join(runtime,'python/Lib/site-packages/torch/__init__.py'));
 const [gpuResult,vcResult,nvccResult,pythonResult,torchResult,videoResult]=await Promise.all([
  runner('nvidia-smi',['--query-gpu=name,memory.total,driver_version','--format=csv,noheader,nounits']),
  runner('reg',['query','HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64','/v','Installed']),
  runner('nvcc',['--version']),pythonInstalled?runner(python,['-I','-c','import sys;print(sys.version.split()[0])'],10000):{},pythonInstalled?runner(python,['-I','-c',"import json,torch,sys;print(json.dumps({'python':sys.version.split()[0],'torch':torch.__version__,'cuda':torch.version.cuda,'available':torch.cuda.is_available(),'device':torch.cuda.get_device_name(0) if torch.cuda.is_available() else ''}))"],45000):{},process.platform==='win32'?runner('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'],12000):{}]);
 const gpu=gpuResult.stdout||'',vc=vcResult.stdout||'',nvcc=nvccResult.stdout||'';let torchInfo={};try{torchInfo=JSON.parse(torchResult.stdout.split('\n').at(-1));}catch{}
 const gpus=gpu.split('\n').filter(Boolean).map(line=>{const [name,vram,driver]=line.split(',').map(x=>x.trim());return{name,vram:Number(vram),driver};});
 const checks=[
 {id:'os',name:'Windows 64 位',state:process.platform==='win32'&&process.arch==='x64'?'ok':'error',detail:`${os.release()} · ${process.arch}`,required:true},
 {id:'gpu',name:'NVIDIA 显卡驱动',state:gpus.length?'ok':'warning',detail:gpus.map(g=>`${g.name} · ${Math.round(g.vram/1024)} GB · 驱动 ${g.driver}`).join('；')||'未检测到 NVIDIA GPU。可使用 CPU 模式，但生成速度较慢。',link:'driver',required:true},
 {id:'vc',name:'Visual C++ 运行库',state:vc.includes('0x1')?'ok':'warning',detail:vc.includes('0x1')?'已安装 x64 运行库':'需要安装微软 x64 Visual C++ Redistributable',link:'vc',required:true},
 {id:'python',name:'软件专用 Python',state:pythonInstalled?'ok':'error',installed:pythonInstalled,detail:pythonInstalled?(torchInfo.python||pythonResult.stdout?`Python ${torchInfo.python||pythonResult.stdout} · 已安装`:'已安装 · '+(pythonResult.error||'版本检测未完成')):'尚未安装，请点击「安装 / 修复运行环境」',required:true},
 {id:'comfy',name:'独立生图引擎',state:comfyInstalled?'ok':'error',installed:comfyInstalled,detail:comfyInstalled?'已安装 · 独立代码、插件、模型与输入输出目录':'尚未安装',required:true},
 {id:'torch',name:'PyTorch / CUDA 推理',state:torchInfo.available?'ok':torchInfo.torch||torchInstalled?'warning':'error',installed:!!torchInfo.torch||torchInstalled,detail:torchInfo.torch?`PyTorch ${torchInfo.torch} · CUDA ${torchInfo.cuda||'CPU'} · ${torchInfo.available?'GPU 可用':'GPU 不可用'}`:torchInstalled?'已安装 PyTorch，GPU 复检未完成：'+(torchResult.error||'请重新检查或查看日志'):'推理依赖尚未安装，请安装 / 修复运行环境',required:true},
 {id:'cuda',name:'CUDA Toolkit（可选）',state:nvcc?'ok':'optional',detail:nvcc?nvcc.split('\n').find(x=>x.includes('release')):'普通生图使用 PyTorch 自带 CUDA 运行时，无需单独安装 Toolkit。仅编译特殊插件时需要。',link:'cuda',required:false},
 {id:'ram',name:'系统内存',state:os.totalmem()>=16*1024**3?'ok':'warning',detail:`${Math.round(os.totalmem()/1024**3)} GB 总内存 · ${Math.round(os.freemem()/1024**3)} GB 当前可用`,required:false}
 ];
 return {gpus,videoControllers:(videoResult.stdout||'').split(/\r?\n/).filter(Boolean),torch:torchInfo,checks,paths:{runtime,python,comfy},checkedAt:new Date().toISOString()};
}
