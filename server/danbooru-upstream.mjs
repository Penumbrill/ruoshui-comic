import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {networkFetch} from './network.mjs';
import {externalResource} from './runtime-resources.mjs';

const bundle=externalResource(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
export function upstreamAddress(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname==='danbooru.donmai.us'||u.hostname==='cdn.donmai.us'||u.hostname==='raw.githubusercontent.com'||u.hostname==='sakizuki-danboorusearch.hf.space'||u.hostname==='ghproxy.com'))throw Error('标签浏览器请求了不受支持的网络地址');
 return u;
}
export class DanbooruUpstream {
 constructor(service,endpoint){this.service=service;this.endpoint=endpoint;this.token=randomUUID();this.pending=new Map();}
 async init(){
  const folder=path.join(this.service.data,'danbooru/upstream'),source=path.join(bundle,'assets/danbooru-browser/upstream');
  await fs.mkdir(folder,{recursive:true});
  // Refresh code byte-for-byte; preserve mutable upstream resources and models.
  const copy=async(src,dest)=>{for(const entry of await fs.readdir(src,{withFileTypes:true})){const a=path.join(src,entry.name),b=path.join(dest,entry.name);if(entry.isDirectory()){await fs.mkdir(b,{recursive:true});await copy(a,b);}else if(entry.name.endsWith('.py'))await fs.copyFile(a,b);else{try{await fs.copyFile(a,b,1);}catch(e){if(e.code!=='EEXIST')throw e;}}}};
  await copy(source,folder);
  try{await fs.copyFile(path.join(bundle,'assets/danbooru-browser/tags_enhanced.csv'),path.join(folder,'tags_enhanced.csv'),1);}catch(e){if(e.code!=='EEXIST')throw e;}
  // Existing desktop settings/favorites retain their location and are never
  // replaced with another ComfyUI installation's private files.
  for(const name of ['settings.json','favorites.json']){const dest=path.join(folder,name);try{await fs.copyFile(path.join(this.service.data,'danbooru',name),dest,1);}catch(e){if(!['ENOENT','EEXIST'].includes(e.code))throw e;}}
  const python=path.join(this.service.runtime,'python/python.exe');
  const child=spawn(python,['-I',path.join(bundle,'assets/danbooru_host.py'),folder,this.endpoint,this.token],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',PYTHONNOUSERSITE:'1',HF_HOME:path.join(this.service.runtime,'cache/huggingface')}});
  this.child=child;
  const log=await fs.open(path.join(this.service.data,'logs/danbooru-plugin.log'),'a');child.stderr.on('data',b=>{void log.write(b).catch(()=>{});});
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{reject(Error('标签浏览器启动超时，请刷新重试'));child.kill();},60000);
   createInterface({input:child.stdout}).on('line',line=>{let result;try{result=JSON.parse(line);}catch{return;}if(result.ready){clearTimeout(timer);this.routeCount=result.routes;resolve(this);return;}const pending=this.pending.get(result.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(result.id);result.error?pending.reject(Error(result.error)):pending.resolve({...result,buffer:Buffer.from(result.body,'base64')});});
   const failed=error=>{clearTimeout(timer);reject(error);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.ready=null;void log.close().catch(()=>{});};
   child.once('error',failed);child.once('exit',()=>failed(Error('标签浏览器进程已停止，请刷新重试')));
  });
 }
 async request(method,url,body){
  this.ready||=this.init();try{await this.ready;}catch(error){this.ready=null;throw error;}
  const id=randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('标签浏览器请求超时，请稍后重试'));},90000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,path:url.pathname,query:Object.fromEntries(url.searchParams),body})+'\n');});
 }
 async transport(body){
  const url=upstreamAddress(body.url),method=String(body.method).toUpperCase();if(!['GET','POST','HEAD'].includes(method))throw Error('请求方法不受支持');
  const headers={};for(const [key,value] of Object.entries(body.headers||{}))if(!['host','connection','content-length','accept-encoding'].includes(key.toLowerCase()))headers[key]=value;
  const freshJSON=url.hostname==='danbooru.donmai.us'&&url.pathname.endsWith('.json');
  const response=await networkFetch(url,{method,headers:{...headers,...(freshJSON?{'Cache-Control':'no-cache'}:{})},...(freshJSON?{cache:'no-store'}:{}),...(method==='POST'?{body:Buffer.from(body.body||'','base64')}:{}),signal:AbortSignal.timeout(55000)});
  const buffer=Buffer.from(await response.arrayBuffer());if(buffer.length>64*1024*1024)throw Error('插件响应超过大小限制');
  return{status:response.status,headers:Object.fromEntries([...response.headers].filter(([k])=>!['content-encoding','transfer-encoding','content-length'].includes(k))),body:buffer.toString('base64')};
 }
 close(){const child=this.child;if(!child||child.exitCode!==null)return Promise.resolve();return new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
}
