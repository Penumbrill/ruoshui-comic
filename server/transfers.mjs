import fs from 'node:fs/promises';import {createReadStream} from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {networkFetch} from './network.mjs';

export class ResumableTransfer{
 constructor({fetcher=networkFetch,onProgress=()=>{}}={}){this.fetcher=fetcher;this.onProgress=onProgress;this.state='idle';}
 control(action){
  if(action==='pause'){this.state='paused';this.controller?.abort();}
  else if(action==='resume'){this.state='running';this.wake?.();}
  else if(action==='cancel'){this.state='cancelled';this.controller?.abort();this.wake?.();}
  else throw Error('未知下载操作');
  return {state:this.state};
 }
 async download({url,file,size,sha256}){
  if(!Number.isSafeInteger(size)||size<=0||!/^[a-f0-9]{64}$/i.test(sha256))throw Error('下载文件缺少大小或 SHA256');
  await fs.mkdir(path.dirname(file),{recursive:true});const part=file+'.part';this.state='running';
  for(;;){
   if(this.state==='cancelled')throw Error('已取消下载');
   if(this.state==='paused'){await new Promise(resolve=>this.wake=resolve);this.wake=null;continue;}
   let bytes=(await fs.stat(part).catch(()=>({size:0}))).size;if(bytes>size){await fs.truncate(part,0);bytes=0;}
   if(bytes===size)break;
   const startBytes=bytes,start=Date.now();this.controller=new AbortController();
   try{
    const response=await this.fetcher(url,{headers:bytes?{Range:`bytes=${bytes}-`}:{},signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(600000)])});
    if(!response.ok)throw Error('下载失败（'+response.status+'）');
    if(bytes&&response.status!==206){bytes=0;await fs.truncate(part,0);}
    if(response.status===206&&!response.headers.get('content-range')?.startsWith('bytes '+bytes+'-'))throw Error('下载源返回的续传位置不正确');
    const handle=await fs.open(part,bytes?'a':'w');
    try{for await(const chunk of response.body){if(bytes+chunk.length>size)throw Error('下载文件超过声明大小');await handle.write(chunk);bytes+=chunk.length;this.onProgress({state:this.state,bytes,total:size,percent:Math.floor(bytes/size*100),speed:Math.max(0,bytes-startBytes)/Math.max(.1,(Date.now()-start)/1000)});}}finally{await handle.close();}
    if(this.state!=='running')continue;
    if(bytes!==size)throw Error('下载中断，点击重试可继续');break;
   }catch(error){if(this.state==='paused'||this.state==='cancelled')continue;this.state='error';throw error;}
  }
  if(this.state!=='running')return this.download({url,file,size,sha256});
  const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(part))hash.update(chunk);
  if(hash.digest('hex')!==sha256.toLowerCase()){this.state='error';await fs.rename(part,part+'.invalid-'+Date.now());throw Error('文件 SHA256 校验不匹配，请重试');}
  await fs.rename(part,file);this.state='done';this.onProgress({state:'done',bytes:size,total:size,percent:100,speed:0});return file;
 }
}
