import path from 'node:path';
import {spawn} from 'node:child_process';
import {readyModels} from './cutout.mjs';

export async function preserveInpaintBackground(service,job,original,output){
 await readyModels(service,'cutout');
 if(service.closed||job.status==='cancelling')throw Error('任务已取消');
 job.stage='正在保护原背景';service.emit('jobs',service.jobs);
 const bundle=service.bundle.replace('app.asar','app.asar.unpacked');
 return new Promise((resolve,reject)=>{
  const child=spawn(path.join(service.runtime,'python/python.exe'),['-I',path.join(bundle,'assets/inpaint_background.py'),path.join(service.folder('models'),'segmentation/isnetis.onnx'),service.filePath(original.file),output,path.join(service.data,'imports',path.basename(job.maskFile))],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
  service.inpaintBackgroundChild=child;child.stdin.end(JSON.stringify(job.params.inpaint));let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill();reject(Error('背景保护超时，请重试'));},240000);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.once('error',error=>{clearTimeout(timer);service.inpaintBackgroundChild=null;reject(error);});
  child.once('exit',code=>{clearTimeout(timer);service.inpaintBackgroundChild=null;if(code!==0)return reject(Error(stderr.slice(-700)||'背景保护未完成'));try{resolve(JSON.parse(stdout.trim().split('\n').at(-1)));}catch{reject(Error('背景保护结果无法读取'));}});
 });
}
