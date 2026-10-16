import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {networkFetch} from './network.mjs';

export function imageAddress(raw){
 if(!raw)throw Error('此帖子没有公开的预览图片地址，可能已删除或需要登录权限');
 const url=new URL(raw);
 if(url.protocol!=='https:'||url.username||url.password||url.port||!/(^|\.)donmai\.us$/.test(url.hostname))throw Error('图片来源不受支持');
 return url.href;
}
export function imageMime(buffer,reported=''){
 let mime='';
 if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)mime='image/jpeg';
 else if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
 else if(/^GIF8[79]a/.test(buffer.subarray(0,6).toString()))mime='image/gif';
 else if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')mime='image/webp';
 else if(buffer.toString('ascii',4,8)==='ftyp'&&/avif|avis/.test(buffer.toString('ascii',8,32)))mime='image/avif';
 if(!mime)throw Error(/text\/html/i.test(reported)?'图片服务器返回了验证网页，当前网络出口尚不能读取此图片':'图片服务器返回的内容不是可显示的图片');
 return mime;
}
const maxBytes=64*1024*1024;
export class DanbooruImages {
 constructor(folder,{fetcher=networkFetch,concurrency=3}={}){this.folder=folder;this.fetcher=fetcher;this.concurrency=concurrency;this.active=0;this.waiters=[];this.pending=new Map();this.failures=new Map();}
 async acquire(){if(this.active>=this.concurrency)await new Promise(resolve=>this.waiters.push(resolve));else this.active++;}
 release(){const next=this.waiters.shift();if(next)next();else this.active--;}
 async load(raw){let url;try{url=imageAddress(raw);}catch(error){this.failures.set(String(raw||''),{message:error.message,at:new Date().toISOString()});throw error;}if(this.pending.has(url))return this.pending.get(url);const pending=this.read(url).then(result=>{this.failures.delete(url);return result;}).catch(error=>{this.failures.set(url,{message:error.message,at:new Date().toISOString()});while(this.failures.size>200)this.failures.delete(this.failures.keys().next().value);throw error;}).finally(()=>this.pending.delete(url));this.pending.set(url,pending);return pending;}
 async read(url){
  const file=path.join(this.folder,createHash('sha256').update(url).digest('hex')+'.image');
  try{const stat=await fs.stat(file);if(Date.now()-stat.mtimeMs<(stat.size>512*1024?3600000:86400000)){const buffer=await fs.readFile(file);return{buffer,mime:imageMime(buffer)};}}catch{}
  await this.acquire();
  try{
   let result;
   for(let attempt=0;attempt<2;attempt++){
    try{
     const response=await this.fetcher(url,{headers:{'User-Agent':'Danbooru-Gallery/1.0','Accept':'image/avif,image/webp,image/*;q=0.9,*/*;q=0.5','Referer':'https://danbooru.donmai.us/'},signal:AbortSignal.timeout(25000)});
     if(!response.ok){await response.body?.cancel();const error=Error(response.status===403?'图片服务器拒绝访问（403），请检查网络出口或帖子访问权限':response.status===404?'原站图片不存在（404），帖子可能已删除':response.status===429?'图片请求过于频繁（429），请稍后重试':`图片服务器暂不可用（${response.status}）`);error.retryable=[502,503,504].includes(response.status);throw error;}
     if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error('图片超过 64 MB，请在原站查看');}
     const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>maxBytes)throw Error('图片超过 64 MB，请在原站查看');chunks.push(chunk);}
     const buffer=Buffer.concat(chunks),mime=imageMime(buffer,response.headers.get('content-type')||'');result={buffer,mime};break;
    }catch(error){if(attempt===1||error.retryable===false||(!error.retryable&&!/fetch|network|timeout|abort|socket|connection|terminated|ECONN|ETIMEDOUT/i.test(error.message)))throw error;}
   }
   await fs.mkdir(this.folder,{recursive:true});const temp=file+'.tmp';await fs.writeFile(temp,result.buffer);await fs.rename(temp,file);return result;
  }finally{this.release();}
 }
}
