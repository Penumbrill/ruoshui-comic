import {networkFetch} from './network.mjs';
import {githubRelease,resolveAssetSize} from './github-release.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {ResumableTransfer} from './transfers.mjs';
export async function installLlama(service){
 if(service.llmInstallPromise)return service.llmInstallPromise;
 if(service.install.state==='running')throw Error('已有下载任务进行中');
 service.llmInstallPromise=run(service).finally(()=>{service.llmInstallPromise=null;service.networkTransfer=null;});return service.llmInstallPromise;
}
async function run(service){
 const update=data=>{service.install={...service.install,...data};service.emit('install',service.install);};update({state:'running',profile:'llm_runtime',percent:0,overallPercent:0,message:'正在查询官方独立语言推理程序…'});
 try{
  let release=await githubRelease('ggml-org/llama.cpp');if(!release)throw Error('官方尚未提供语言运行时');
  if(!release.assets.some(a=>/bin-win-(vulkan|cpu)-x64\.zip$/.test(a.name))){const pointer=release.assets.find(a=>a.name==='nightly-tag.txt');if(pointer){const response=await networkFetch(pointer.browser_download_url,{signal:AbortSignal.timeout(30000)});const tag=(await response.text()).trim();if(!/^b\d+$/.test(tag))throw Error('官方二进制版本指向无效');release=await githubRelease('ggml-org/llama.cpp',{tag});}}
  let asset=release.assets.find(a=>/bin-win-vulkan-x64\.zip$/.test(a.name))||release.assets.find(a=>/bin-win-cpu-x64\.zip$/.test(a.name));if(!asset||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('官方发行文件没有完整校验信息，请稍后重试');asset=await resolveAssetSize(asset);
  const file=path.join(service.data,'downloads',path.basename(asset.name));service.networkTransfer=new ResumableTransfer({onProgress:p=>update({...p,state:p.state==='done'?'running':p.state,name:asset.name,overallPercent:p.percent,message:'下载独立语言推理程序（不依赖其他软件）…'})});
  await service.networkTransfer.download({url:asset.browser_download_url,file,size:asset.size,sha256:asset.digest.slice(7)});update({message:'校验通过，正在安装独立推理引擎…',percent:100});
  const target=path.join(service.runtime,'llama-official');await fs.mkdir(target,{recursive:true});
  await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(service.bundle.replace('app.asar','app.asar.unpacked'),'assets/install-llama.ps1'),'-Archive',file,'-Target',target],{windowsHide:true});let error='';child.stderr.on('data',b=>error+=b);child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(error||'运行时解压失败')));});
  await fs.writeFile(path.join(target,'release.json'),JSON.stringify({version:release.tag_name,url:asset.browser_download_url,sha256:asset.digest}));await fs.unlink(file).catch(()=>{});update({state:'done',percent:100,overallPercent:100,message:'独立 LLM 运行时已安装'});return{installed:true,version:release.tag_name};
 }catch(e){update({state:service.networkTransfer?.state==='cancelled'?'cancelled':'error',message:e.message});throw e;}
}
