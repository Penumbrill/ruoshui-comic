import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

export class OfflineTranslator{
 constructor(python,script,folder,direction="en-zh"){this.direction=direction;this.python=python;this.script=script;this.folder=folder;this.pending=new Map();}
 async start(){
  if(!this.ready)this.ready=new Promise((resolve,reject)=>{
   const child=spawn(this.python,['-I',this.script,this.folder,this.direction],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1'}});this.child=child;
   const timeout=setTimeout(()=>{this.close();reject(Error('离线翻译模型加载超时'));},30000);let buffer='';
   child.stdout.on('data',data=>{buffer+=data.toString();const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){let item;try{item=JSON.parse(line);}catch{continue;}if(item.ready){clearTimeout(timeout);resolve();}else if(item.id){const request=this.pending.get(item.id);if(request){clearTimeout(request.timeout);this.pending.delete(item.id);item.error?request.reject(Error(item.error)):request.resolve(item.text);}}else if(item.error){clearTimeout(timeout);reject(Error(item.error));}}});
   child.stderr.on('data',()=>{});
   const stopped=error=>{clearTimeout(timeout);this.ready=null;reject(error);for(const request of this.pending.values()){clearTimeout(request.timeout);request.reject(error);}this.pending.clear();};
   child.once('error',stopped);child.once('exit',()=>stopped(Error('本地标签翻译进程已停止')));
  });
  return this.ready;
 }
 async translate(text){await this.start();const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{this.pending.delete(id);reject(Error('标签翻译超时'));},120000);this.pending.set(id,{resolve,reject,timeout});this.child.stdin.write(JSON.stringify({id,text})+'\n');});}
 close(){this.child?.kill();this.ready=null;}
}
