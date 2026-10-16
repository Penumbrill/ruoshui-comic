import fs from 'node:fs/promises';
import path from 'node:path';

const MB=1024**2,day=86400000;
const inside=(parent,file)=>file===parent||file.startsWith(parent+path.sep);
export function cachePlan(freeBytes,settings={}){
 const automatic=Math.min(2048,Math.max(512,Math.floor((freeBytes||400*1024**3)*.005/MB)));
 return{enabled:settings.enabled!==false,maxBytes:(Number(settings.maxMB)>0?Math.max(128,Math.min(8192,Number(settings.maxMB))):automatic)*MB,days:Math.max(1,Math.min(30,Number(settings.days)||7)),automatic:!Number(settings.maxMB)};
}
export class CacheMaintenance{
 constructor(service,{now=()=>Date.now()}={}){this.service=service;this.now=now;this.last=null;}
 async roots(){
  const s=this.service,desktop=path.join(s.data,'autosave/desktop'),roots=[
   [path.join(s.data,'cache'),'图片与网络缓存'],[path.join(s.data,'autosave/cutout-cache'),'抠图计算缓存'],
   [path.join(s.data,'danbooru/upstream/py/cdn_cache'),'标签浏览器图片缓存'],
   [path.join(s.runtime,'ComfyUI/temp'),'生图临时预览'],[path.join(s.runtime,'cache/pip'),'安装包缓存'],
   ...['Cache','Code Cache','GPUCache','DawnCache','DawnGraphiteCache','DawnWebGPUCache'].map(name=>[path.join(desktop,name),'客户端显示缓存'])];
  try{for(const entry of await fs.readdir(path.join(desktop,'Partitions'),{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink())for(const name of ['Cache','Code Cache','GPUCache'])roots.push([path.join(desktop,'Partitions',entry.name,name),'远程图片显示缓存']);}catch{}
  return roots;
 }
 async inventory(){
  const workspace=await fs.realpath(this.service.root),files=[];let partial=false;
  for(const [root,label]of await this.roots()){
   try{if((await fs.lstat(root)).isSymbolicLink())continue;const resolved=await fs.realpath(root);if(!inside(workspace,resolved))continue;
    const walk=async folder=>{for(const entry of await fs.readdir(folder,{withFileTypes:true})){if(files.length>=50000){partial=true;return;}if(entry.isSymbolicLink())continue;const file=path.join(folder,entry.name);if(entry.isDirectory())await walk(file);else if(entry.isFile()){
     // Model weights, active transfers and synchronization locks are never cache
     // candidates, even if a future installer puts one in a cache directory.
     if(/\.(?:safetensors|gguf|onnx|ckpt|pth|pt|bin|part|tmp|lock)$/i.test(entry.name)||entry.name==='Cookies'||entry.name==='Preferences')continue;
     const stat=await fs.stat(file);files.push({file,root:resolved,label,size:stat.size,mtime:stat.mtimeMs});
    }}};await walk(resolved);
   }catch{}
  }
  return{workspace,files,partial};
 }
 async plan(){let free;try{const disk=await fs.statfs(this.service.data);free=Number(disk.bavail)*Number(disk.bsize);}catch{}return cachePlan(free,this.service.config.cacheMaintenance);}
 async status(){const [inventory,plan]=await Promise.all([this.inventory(),this.plan()]);return{bytes:inventory.files.reduce((sum,f)=>sum+f.size,0),files:inventory.files.length,partial:inventory.partial,...plan,last:this.last,nextCheck:this.nextCheck,protected:'作品、模型、聊天、自动保存、登录状态和下载进度'};}
 busy(){const s=this.service;return s.cutoutBusy||s.install.state==='running'||s.jobs.some(j=>['running','queued','cancelling'].includes(j.status));}
 async clean(manual=false){
  if(this.cleaning)return this.cleaning;
  this.cleaning=this.sweep(manual).finally(()=>this.cleaning=null);return this.cleaning;
 }
 async sweep(manual){
  const plan=await this.plan();if(!plan.enabled&&!manual)return{skipped:'自动清理已关闭'};if(this.busy())return{skipped:'任务进行中，空闲时自动清理'};
  const {workspace,files,partial}=await this.inventory(),now=this.now();let remaining=files.reduce((sum,f)=>sum+f.size,0),removedBytes=0,removedFiles=0;
  for(const file of files.sort((a,b)=>a.mtime-b.mtime)){
   if(this.busy())break;if(now-file.mtime<30*60000)continue;
   const expired=now-file.mtime>plan.days*day;if(!expired&&remaining<=plan.maxBytes)continue;
   try{const stat=await fs.lstat(file.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.mtimeMs!==file.mtime)continue;
    const resolved=await fs.realpath(file.file);if(!inside(workspace,resolved)||!inside(file.root,resolved))continue;
    await fs.unlink(resolved);remaining-=file.size;removedBytes+=file.size;removedFiles++;
   }catch{} // Open browser cache files may be locked on Windows; retry next time.
  }
  this.last={at:new Date(now).toISOString(),removedBytes,removedFiles,remainingBytes:remaining,partial};
  return this.last;
 }
 start(){this.nextCheck=new Date(this.now()+15000).toISOString();this.startup=setTimeout(()=>{void this.clean().catch(()=>{});},15000);this.startup.unref();this.interval=setInterval(()=>{this.nextCheck=new Date(this.now()+30*60000).toISOString();void this.clean().catch(()=>{});},30*60000);this.interval.unref();return this;}
 close(){clearTimeout(this.startup);clearInterval(this.interval);}
}
