import fs from 'node:fs/promises';import {createReadStream} from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
async function readyModels(service,profile){
 const entries=JSON.parse(await fs.readFile(service.defaultManifestPath,'utf8')).downloads[profile];service.cutoutChecks||=new Map();
 async function valid(item){const file=path.join(service.folder('models'),item.target);try{const stat=await fs.stat(file),stamp=`${stat.size}:${stat.mtimeMs}`;if(stat.size!==item.size)return false;if(service.cutoutChecks.get(file)===stamp)return true;const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);if(hash.digest('hex')!==item.sha256)return false;service.cutoutChecks.set(file,stamp);return true;}catch{return false;}}
 if((await Promise.all(entries.map(valid))).every(Boolean))return;
 if(service.install.state==='running')throw Error('另一个模型正在下载，完成后即可继续抠图');
 await service.downloadModels(profile);const child=service.installChild;
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('抠图模型下载未完成，重试可续传')));});
 if(!(await Promise.all(entries.map(valid))).every(Boolean))throw Error('抠图模型完整性校验失败，请重新下载');
}
export async function cutout(service,{imageId,points,mode='auto',settings={}}){
 if(service.cutoutBusy)throw Error('正在抠图，请等待当前任务完成');
 const original=service.findImage(imageId);if(!original)throw Error('原图不存在，请重新导入图片');
 if(!['auto','anime','object'].includes(mode))throw Error('未知识别模式');const options={threshold:Math.max(.05,Math.min(.95,Number(settings.threshold)||.5)),feather:Math.max(0,Math.min(4,Number.isFinite(settings.feather)?settings.feather:.5)),grow:Math.max(-12,Math.min(12,Math.round(Number(settings.grow)||0)))};
 const prompted=Array.isArray(points)&&points.length>0;if(points!==undefined&&(!Array.isArray(points)||points.length>96||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1||![0,1].includes(p.label))))throw Error('涂抹选区数据无效');if(prompted&&!points.some(p=>p.label===1))throw Error('请先在要保留的人物或物品上涂抹');
 const general=!prompted&&mode!=='anime',model=path.join(service.folder('models'),prompted?'segmentation/sam_vit_b_01ec64.encoder.quant.onnx':general?'segmentation/birefnet-general.onnx':'segmentation/isnetis.onnx');
 service.cutoutBusy=true;
 const id=crypto.randomUUID(),file=`imports/${id}.png`,output=service.filePath(file),bundle=service.bundle.replace('app.asar','app.asar.unpacked');
 try{await readyModels(service,prompted?'selection':general?'cutout_general':'cutout');const details=await new Promise((resolve,reject)=>{const child=spawn(path.join(service.runtime,'python/python.exe'),prompted?['-I',path.join(bundle,'assets/select_subject.py'),path.dirname(model),service.filePath(original.file),output,path.join(service.data,'autosave/cutout-cache')]:['-I',path.join(bundle,general?'assets/cutout_general.py':'assets/cutout.py'),model,service.filePath(original.file),output],{windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});service.cutoutChild=child;child.stdin.end(JSON.stringify(prompted?{points,...options}:options));let stdout='',stderr='';const timeout=setTimeout(()=>{child.kill();reject(Error('抠图超时，请缩小图片后重试'));},180000);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',e=>{clearTimeout(timeout);reject(e);});child.on('exit',code=>{clearTimeout(timeout);service.cutoutChild=null;if(code!==0)return reject(Error(stderr.includes('onnxruntime')?'抠图运行库缺失，请到设置修复独立环境':stderr.slice(-700)||'抠图失败'));try{resolve(JSON.parse(stdout.trim().split('\n').at(-1)));}catch{reject(Error('抠图结果无法读取'));}});});
 const item={id,file,url:'/api/files/'+id,title:original.title+' · 主体抠图',created:new Date().toISOString(),imported:true,cutout:true,sourceImageId:original.id,params:{...original.params,width:details.width,height:details.height}};service.gallery.unshift(item);await service.persist();service.emit('gallery',service.gallery);return {...item,details};
 }finally{service.cutoutBusy=false;}
}
