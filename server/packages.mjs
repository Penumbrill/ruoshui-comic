import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicJson} from './service.mjs';
const exec=promisify(execFile);
export const packageAllowList=['torch','torchvision','transformers','safetensors','ultralytics','opencv-python','numpy','pillow','sentencepiece','torchsde'];
export async function packages(service){const {stdout}=await exec(path.join(service.runtime,'python/python.exe'),['-I','-m','pip','list','--format=json'],{timeout:30000,windowsHide:true,maxBuffer:3*1024*1024});return JSON.parse(stdout);}
export async function versions(name){if(!packageAllowList.includes(name))throw Error('请选择列表中的库');const r=await fetch(`https://pypi.org/pypi/${name}/json`,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('版本查询失败，请检查网络');const d=await r.json();return Object.keys(d.releases).filter(v=>/^\d+(\.\d+)+$/.test(v)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).slice(0,30);}
export async function installPackage(service,{name,version,mirror}){
 if(!packageAllowList.includes(name)||version&&!/^\d+(\.\d+)+$/.test(version))throw Error('库名称或版本不正确');
 if(service.engine.state==='ready'||service.engine.state==='starting')throw Error('请先停止生图引擎再安装库');if(service.install.state==='running')throw Error('已经有安装任务');
 const args=['-I','-m','pip','install',name+(version?'=='+version:''),'--no-warn-script-location'];
 if(name==='torch'||name==='torchvision')args.push('--index-url',service.config.memoryMode==='cpu'?'https://download.pytorch.org/whl/cpu':'https://download.pytorch.org/whl/cu130');else if(mirror==='tsinghua')args.push('--index-url','https://pypi.tuna.tsinghua.edu.cn/simple');
 service.install={state:'running',percent:0,message:'安装 '+name};service.emit('install',service.install);
 const child=spawn(path.join(service.runtime,'python/python.exe'),args,{windowsHide:true});service.installChild=child;
 for(const stream of [child.stdout,child.stderr])stream.on('data',b=>service.log(b.toString()));
 child.on('error',e=>{service.install={state:'error',message:e.message};service.emit('install',service.install);});child.on('exit',code=>{service.installChild=null;service.install={state:code===0?'done':'error',percent:code===0?100:0,message:code===0?'安装完成，请重新检测环境':'安装失败，请查看日志'};service.emit('install',service.install);});return true;
}
export async function backup(service){const list=await packages(service);const file=path.join(service.data,'logs',`environment-${Date.now()}.json`);await atomicJson(file,{created:new Date().toISOString(),packages:list});return {file};}
export async function installVc(service){
 if(service.install.state==='running')throw Error('已经有安装任务');
 const dir=path.join(service.runtime,'downloads');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'vc_redist.x64.exe');const response=await fetch(service.links.vc,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Visual C++ 下载失败');await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));
 const script="$s=Get-AuthenticodeSignature -LiteralPath $args[0]; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Microsoft Corporation'){throw 'Microsoft signature verification failed'}; $p=Start-Process -FilePath $args[0] -ArgumentList '/install','/passive','/norestart' -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode";
 const {stdout}=await exec('powershell.exe',['-NoProfile','-Command',script,file],{windowsHide:true,timeout:600000});return {message:stdout||'安装程序已运行，请重新检测环境'};
}
