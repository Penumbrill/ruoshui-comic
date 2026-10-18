import {migrateHandDefaults} from '../shared/hand-defaults.mjs';
import {preserveInpaintBackground} from './inpaint-background.mjs';
import {network,networkFetch} from './network.mjs';
import {completeLlmDownload} from './llm-downloads.mjs';
import {TranslationRouter,validTranslation} from './translation-router.mjs';
import {stripProjectImageMetadata,stripConfigImageMetadata} from '../shared/image-metadata.mjs';
import {setPanelImage} from '../shared/panel-generation.mjs';
import {comicExportPath} from './comic-exports.mjs';
import {comicClarity} from './comic-clarity.mjs';
import {gpuMemory,imageMemoryPlan} from './memory.mjs';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import WebSocket from 'ws';
import {prepareWeilinData} from './weilin-data.mjs';
import {OfflineTranslator} from './offline-translator.mjs';
import {defaults,mergeConfig} from './profiles.mjs';
import {migratePromptExamples} from '../shared/prompt-examples.mjs';
import {buildWorkflow,validateParams} from './workflow.mjs';
import {inspectEnvironment,links} from './environment.mjs';
import {extractGeneration,pngMetadata} from './metadata.mjs';
import {loadGalleryTrash,changeGalleryTrash} from './gallery-trash.mjs';
import {projectRelatedImages,relatedFileMoves,moveRelatedFiles,takeProjectScopes,restoreProjectScopes} from './project-related.mjs';
import {purgeTrash} from './trash-purge.mjs';
import {TagLibrary} from './tag-library.mjs';
import {rebaseInstallationPaths} from './portable-paths.mjs';
import {isolateModelPaths} from './runtime-isolation.mjs';
const bundle=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const externalBundle=bundle.includes('app.asar')?bundle.replace('app.asar','app.asar.unpacked'):bundle;
const categories=['diffusion_models','text_encoders','vae','loras','controlnet','upscale_models','detectors','llm'];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
const fileQueues=new Map();
export function atomicJson(file,value){
 const contents=JSON.stringify(value,null,2);
 const pending=(fileQueues.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
  await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';const handle=await fs.open(tmp,'w');
  try{await handle.writeFile(contents,'utf8');await handle.sync();}finally{await handle.close();}
  if(existsSync(file))await fs.copyFile(file,file+'.bak');await fs.rename(tmp,file);
 });fileQueues.set(file,pending);pending.finally(()=>{if(fileQueues.get(file)===pending)fileQueues.delete(file);}).catch(()=>{});return pending;
}
export async function readJson(file,fallback){
 const candidates=[];for(const name of [file,file+'.tmp'])try{const stat=await fs.stat(name);candidates.push({name,time:stat.mtimeMs});}catch{}
 candidates.sort((a,b)=>b.time-a.time);
 if(existsSync(file+'.bak'))candidates.push({name:file+'.bak',time:0});
 for(const candidate of candidates)try{const value=JSON.parse((await fs.readFile(candidate.name,'utf8')).replace(/^\uFEFF/,''));if(candidate.name!==file){if(existsSync(file))await fs.copyFile(file,file+`.broken-${Date.now()}`);await fs.copyFile(candidate.name,file);}return value;}catch{}
 return structuredClone(fallback);
}
export class StudioService{
 constructor(root){this.root=path.resolve(root);this.bundle=bundle;this.downloaderPath=path.join(externalBundle,'assets/download_models.py');this.defaultManifestPath=path.join(externalBundle,'assets/model-manifest.json');this.data=path.join(this.root,'works');this.runtime=path.join(this.root,'runtime');this.links=links;this.listeners=new Set();this.jobs=[];this.gallery=[];this.projects=[];this.schemas={};this.engine={state:'stopped',progress:0,message:'生图引擎尚未启动',logs:[]};this.install={state:'idle',percent:0,message:''};this.clientId=crypto.randomUUID();this.closed=false;this.writeChain=Promise.resolve();}
 async init(){
  const oldData=path.join(this.root,'data');if(existsSync(path.join(oldData,'gallery.json'))&&!existsSync(path.join(this.data,'gallery.json')))await fs.cp(oldData,this.data,{recursive:true,force:false});
  for(const folder of ['output','imports','projects','exports','logs','comfy-user','autosave'])await fs.mkdir(path.join(this.data,folder),{recursive:true});
  for(const category of categories) await fs.mkdir(this.folder(category),{recursive:true});
  const stored=await readJson(path.join(this.data,'settings.json'),{});this.config=migrateHandDefaults(migratePromptExamples(rebaseInstallationPaths(mergeConfig(defaults(),stored),this.root)));
  for(const type of ['original','expanded']){const p=this.config.profiles[type];if(stored.schemaVersion!==2){Object.assign(p.inpaint,{steps:30,cfg:4,sampler:'er_sde',scheduler:'simple',denoise:0.8,maskBlur:4,invertMask:false,onlyMasked:false,padding:32,positive:'',negative:'',controlnet:type==='original'?'anima-lllite-inpainting-v2.safetensors':''});}if(p.upscale.upscale_model==='RealESRGAN_x4plus_anime_6B.pth'&&!existsSync(path.join(this.folder('upscale_models'),p.upscale.upscale_model)))p.upscale.upscale_model='RealESRGAN_x4plus.safetensors';}
  this.config.schemaVersion=2;this.config.liveTagTranslation??=true;this.tagTranslations=await readJson(path.join(this.data,'autosave/tag-translations.json'),{});
  if(existsSync(path.join(this.data,'model-manifest.json')))this.modelManifestPath=path.join(this.data,'model-manifest.json');
  this.jobs=await readJson(path.join(this.data,'jobs.json'),[]);this.gallery=await readJson(path.join(this.data,'gallery.json'),[]);this.projects=await readJson(path.join(this.data,'project-index.json'),[]);
  await loadGalleryTrash(this);
  this.projectTrash=await readJson(path.join(this.data,'trash/projects/index.json'),[]);this.deletedProjectIds=new Set([...this.projectTrash.map(p=>p.id),...await readJson(path.join(this.data,'trash/projects/purged.json'),[])]);this.projects=this.projects.filter(p=>!this.deletedProjectIds.has(p.id));
  this.install=await readJson(path.join(this.data,'autosave/download-task.json'),this.install);if(this.install.state==='running')this.install={...this.install,state:'paused',speed:0,message:'上次下载未完成，点击继续可断点续传'};
  for(const j of this.jobs)if(['queued','running','cancelling'].includes(j.status)){j.status='interrupted';j.error='软件上次退出时任务未完成，可重新加入队列';}
  return this;
 }
 folder(kind){if(kind==='models')return path.join(this.runtime,'ComfyUI/models');if(kind==='runtime')return this.runtime;if(kind==='output'||kind==='projects'||kind==='assistant')return path.join(this.data,kind);if(!categories.includes(kind))throw Error('未知目录');return path.join(this.runtime,'ComfyUI/models',kind==='detectors'?'ultralytics/bbox':kind);}
 snapshot(){return {workspaceKey:crypto.createHash('sha256').update(this.root).digest('hex').slice(0,16),config:this.config,engine:{...this.engine,logs:this.engine.logs.slice(-120)},install:this.install,jobs:this.jobs.slice(-100),gallery:this.gallery,projects:this.projects};}
 emit(type,data){if(type==='install'&&data.profile)this.installWrite=atomicJson(path.join(this.data,'autosave/download-task.json'),data).catch(e=>this.log('下载进度保存失败：'+e.message));for(const listener of this.listeners)listener({type,data});}
 log(message){this.engine.logs.push(String(message));if(this.engine.logs.length>400)this.engine.logs.splice(0,this.engine.logs.length-400);this.emit('log',String(message));}
 persist(){this.writeChain=this.writeChain.catch(()=>{}).then(async()=>{await atomicJson(path.join(this.data,'jobs.json'),this.jobs);await atomicJson(path.join(this.data,'gallery.json'),this.gallery);});return this.writeChain;}
 findImage(id){return this.gallery.find(item=>item.id===id)||this.galleryTrash?.find(item=>item.id===id);}
 tagLibrary(refresh=false){this.tagCatalog||=new TagLibrary(this);return this.tagCatalog.load(refresh);}
 deleteImages(ids){return changeGalleryTrash(this,ids);}
 restoreImages(ids){return changeGalleryTrash(this,ids,true);}
 purgeRecycleBin(options){const pending=(this.galleryMutationChain||Promise.resolve()).catch(()=>{}).then(async()=>{this.trashPurging=true;try{return await purgeTrash(this,options);}finally{this.trashPurging=false;}});this.galleryMutationChain=pending;return pending;}
 async saveConfig(patch){this.config=mergeConfig(this.config,patch);const deleted=this.galleryTrash?.filter(item=>!item.restoredAt)||[];stripConfigImageMetadata(this.config,new Set(deleted.map(item=>item.id)),deleted.flatMap(item=>item.metadata?.scopes||[]));this.config.updatedAt=new Date().toISOString();await atomicJson(path.join(this.data,'settings.json'),this.config);return this.config;}
 async prepareModels({params,inpaint=false,translate=false}){
  const p=validateParams(params);const manifest=JSON.parse(await fs.readFile(path.join(bundle,'assets/model-manifest.json'),'utf8'));
  const custom=await readJson(path.join(this.data,'custom-models.json'),[]);const entries=[...Object.values(manifest.downloads).flat(),...custom];
  const needed=[`diffusion_models/${p.model}`,`text_encoders/${p.textEncoder}`,`vae/${p.vae}`];
  for(const l of p.loras)if(l.enabled!==false&&l.name)needed.push('loras/'+l.name);
  if(inpaint&&p.inpaint.controlnet)needed.push('controlnet/'+p.inpaint.controlnet);
  if(inpaint&&p.inpaint.preserveBackground)needed.push('segmentation/isnetis.onnx');
  for(const kind of ['face','hand'])if(p[kind].enabled)needed.push('ultralytics/'+p[kind].detector);
  if(p.upscale.enabled)needed.push('upscale_models/'+p.upscale.upscale_model);
  const items=[];for(const name of needed){
   const normalized=name.replaceAll('\\','/');const item=entries.find(e=>e.target===normalized);
   const local=path.resolve(this.folder('models'),normalized);if(!local.startsWith(this.folder('models')+path.sep))throw Error('模型路径无效');
   if(!item){if(!existsSync(local))throw Error(`缺少 ${normalized}。请先在下载中心登记下载地址，或导入已有模型。`);continue;}
   let verified=false;try{const stat=await fs.stat(local),receipt=await readJson(local+'.verified.json',{});verified=stat.size===item.size&&receipt.sha256===item.sha256&&String(receipt.mtime_ns).slice(0,-6)===String(Math.trunc(stat.mtimeMs));if(!verified&&stat.size===item.size&&receipt.sha256===item.sha256)verified=Math.abs(Number(receipt.mtime_ns)/1e6-stat.mtimeMs)<1;}catch{}
   if(!verified)items.push(item);
  }
  if(translate&&!existsSync(path.join(this.folder('models'),'translation/pytorch_model.bin')))items.push(...(manifest.downloads.translation||[]));
  if(!items.length)return {ready:true};
  if(this.install.state==='running')throw Error('模型正在下载，请等待当前下载完成后再生成');
  manifest.downloads.custom=custom;manifest.downloads.requested=[...new Map(items.map(i=>[i.target,i])).values()];
  await atomicJson(path.join(this.data,'model-manifest.json'),manifest);this.modelManifestPath=path.join(this.data,'model-manifest.json');
  await this.downloadModels('requested');const child=this.installChild;
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(this.install.message||'模型准备失败，可再次点击重试')));});
  this.schemas=this.engine.state==='ready'?await this.json('/object_info'):this.schemas;return {ready:true};
 }
 async models(){
  const result={};
  async function walk(dir,base){let list=[];for(const ent of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){const full=path.join(dir,ent.name);if(ent.isDirectory())list.push(...await walk(full,base));else if(/\.(safetensors|ckpt|pt|pth|gguf)$/i.test(ent.name))list.push(path.relative(base,full).replaceAll('\\','/'));}return list.sort();}
  for(const category of categories){const folder=this.folder(category);result[category]=(await walk(folder,folder)).map(name=>category==='detectors'?'bbox/'+name:name);}
  result.samplers=this.schemas.KSampler?.input?.required?.sampler_name?.[0]||['euler_ancestral','euler','er_sde','dpmpp_2m_sde_gpu','dpmpp_2m'];
  result.schedulers=this.schemas.KSampler?.input?.required?.scheduler?.[0]||['simple','sgm_uniform','normal','karras','beta','linear_quadratic'];return result;
 }
 async environment(){if(!this.environmentCheck)this.environmentCheck=inspectEnvironment(this.root,{runtime:this.runtime}).finally(()=>{this.environmentCheck=null;});return this.environmentCheck;}
 request(url,options={}){if(!this.baseUrl)throw Error('请先启动生图引擎');return fetch(this.baseUrl+url,{...options,signal:options.signal||AbortSignal.timeout(30000)});}
 async json(url,body){const r=await this.request(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const text=await r.text(),data=text?JSON.parse(text):{};if(!r.ok)throw Error(data.error?.message||JSON.stringify(data.node_errors||data.error||data));return data;}
 async startEngine(){
  if(this.releasing)await this.releasing;
  if(this.engine.state==='ready')return this.engine;
  if(this.starting)return this.starting;
  this.starting=this._startEngine().finally(()=>{this.starting=null;});return this.starting;
 }
 async _startEngine(){
  if(this.assistant?.busy&&this.config.llm?.provider==='local')throw Error('提示词助手正在使用本地模型，请完成或停止后再生图');if(this.assistant?.child)await this.assistant.stop();
  const python=path.join(this.runtime,'python/python.exe'),comfy=path.join(this.runtime,'ComfyUI');
  await isolateModelPaths(this);
  if(!existsSync(python)||!existsSync(path.join(comfy,'main.py')))throw Error('运行环境尚未安装。请到设置点击「安装 / 修复运行环境」。');
  await fs.mkdir(path.join(comfy,'custom_nodes/moge-nodes'),{recursive:true});await fs.copyFile(path.join(bundle,'assets/moge-nodes/__init__.py'),path.join(comfy,'custom_nodes/moge-nodes/__init__.py'));
  this.engine={...this.engine,state:'starting',message:'正在启动独立 ComfyUI…'};this.emit('engine',this.engine);
  await prepareWeilinData(this);
  const port=await freePort();this.baseUrl=`http://127.0.0.1:${port}`;
  const args=['-s',path.join(comfy,'main.py'),'--listen','127.0.0.1','--port',String(port),'--disable-auto-launch','--preview-method','auto','--output-directory',path.join(this.data,'output'),'--input-directory',path.join(this.data,'imports'),'--user-directory',path.join(this.data,'comfy-user')];
  const largest=Math.max(...(await Promise.all(['original','expanded'].map(async type=>{try{return(await fs.stat(path.join(this.folder('diffusion_models'),this.config.profiles[type].model))).size;}catch{return 0;}}))),0);this.memoryPlan=imageMemoryPlan(await gpuMemory(),largest,this.config.memoryMode);args.push(...this.memoryPlan.args);this.log('显存优化：'+this.memoryPlan.label);this.engine.memoryPlan=this.memoryPlan;
  this.comfyProcess=spawn(python,args,{cwd:comfy,windowsHide:true,env:{...process.env,PYTHONNOUSERSITE:'1',PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HOME:path.join(this.runtime,'cache/huggingface'),TORCH_HOME:path.join(this.runtime,'cache/torch'),YOLO_CONFIG_DIR:path.join(this.runtime,'cache/ultralytics')}});
  for(const stream of [this.comfyProcess.stdout,this.comfyProcess.stderr])stream.on('data',b=>b.toString().split('\n').filter(Boolean).forEach(line=>this.log(line)));
  this.comfyProcess.on('error',e=>{this.log(e.message);this.engine.state='error';this.engine.message=e.message;this.emit('engine',this.engine);});
  this.comfyProcess.on('exit',code=>{this.socket?.close();this.comfyProcess=null;if(!this.closed){this.engine.state='stopped';this.engine.message=`引擎已停止（${code}）`;this.emit('engine',this.engine);}});
  for(let i=0;i<180;i++){
   if(!this.comfyProcess)throw Error('ComfyUI 启动失败，请查看设置中的日志');
   try{this.schemas=await this.json('/object_info');this.engine={...this.engine,state:'ready',message:'本地生图引擎已就绪'};this.connectSocket();this.emit('engine',this.engine);this.emit('models',await this.models());void this.pump();return this.engine;}catch{}await pause(1000);
  }
  this.comfyProcess?.kill();throw Error('引擎启动超时，请查看设置中的日志');
 }
 connectSocket(){
  this.socket=new WebSocket(this.baseUrl.replace('http:','ws:')+'/ws?clientId='+this.clientId);
  this.socket.on('message',(data,isBinary)=>{
   if(isBinary){const b=Buffer.from(data);if(b.length>8&&b.length<8*1024*1024)this.emit('preview','data:image/'+(b.readUInt32BE(4)===2?'png':'jpeg')+';base64,'+b.subarray(8).toString('base64'));return;}
   let event;try{event=JSON.parse(data.toString());}catch{return;}
   const job=this.jobs.find(j=>j.status==='running'||j.status==='cancelling');
   if(job&&(!event.data?.prompt_id||event.data.prompt_id===job.promptId)){
    if(event.type==='progress'){job.progress=Math.round(event.data.value/event.data.max*100);this.emit('jobs',this.jobs);}
    if(event.type==='executing'&&event.data.node){job.stage=this.activeGraph?.[event.data.node]?._meta?.title||'处理图像';this.emit('jobs',this.jobs);}
    if(event.type==='execution_error'){job.runtimeError=event.data.exception_message||'生成失败';}
   }
  });
  this.socket.on('error',e=>this.log('进度连接：'+e.message));
 }
 async stopEngine(){if(this.jobs.some(j=>j.status==='running'))throw Error('请先停止生成任务再关闭引擎');this.comfyProcess?.kill();return this.engine;}
 async enqueue(body){
  const p=validateParams(body.target?comicClarity(body.params,this.config.comicClarity!==false):body.params);if(!Number.isInteger(body.count)||body.count<1||body.count>50)throw Error('每次生成张数应为 1–50');
  const models=await this.models();
  for(const [field,category] of [['model','diffusion_models'],['textEncoder','text_encoders'],['vae','vae']])if(!models[category].includes(p[field].replaceAll('\\','/')))throw Error(`缺少 ${p[field]}，请在设置里下载模型或导入文件`);
  for(const l of p.loras)if(l.enabled!==false&&!models.loras.includes(l.name))throw Error(`找不到 LoRA：${l.name}`);
  if(body.imageId&&!this.findImage(body.imageId))throw Error('原始图像不存在');
  let maskFile;if(body.imageId){if(!body.mask?.startsWith('data:image/png;base64,'))throw Error('请先绘制重绘遮罩');maskFile=`mask-${crypto.randomUUID()}.png`;await fs.writeFile(path.join(this.data,'imports',maskFile),Buffer.from(body.mask.split(',')[1],'base64'));}
  const groupId=crypto.randomUUID();
  for(let i=0;i<body.count;i++){
   const seed=p.seed===''||p.seed===null?crypto.randomBytes(6).readUIntBE(0,6):Number(p.seed)+i;
   if(!Number.isSafeInteger(seed))throw Error('连续生成的种子超出范围');
   this.jobs.push({id:crypto.randomUUID(),groupId,status:'queued',progress:0,stage:'等待生成',created:new Date().toISOString(),params:{...structuredClone(p),seed:String(seed)},target:body.target||null,imageId:body.imageId||null,maskFile,attempt:0});
  }
  await this.persist();this.emit('jobs',this.jobs);if(this.engine.state==='ready')void this.pump();return {groupId};
 }
 async cancel(groupId){
  let running=false;
  for(const job of this.jobs)if(!groupId||job.groupId===groupId){if(job.status==='queued')job.status='cancelled';if(job.status==='running'){job.status='cancelling';running=true;}}
  if(running){this.inpaintBackgroundChild?.kill();await this.json('/interrupt',{});}this.emit('jobs',this.jobs);await this.persist();return true;
 }
 async retryJob(id){const job=this.jobs.find(j=>j.id===id);if(!job||!['error','interrupted','cancelled'].includes(job.status))throw Error('此任务无需恢复');const body={params:job.params,count:1,target:job.target,imageId:job.imageId};if(job.maskFile)body.mask='data:image/png;base64,'+(await fs.readFile(path.join(this.data,'imports',path.basename(job.maskFile)))).toString('base64');return this.enqueue(body);}
 async pump(){
  if(this.pumping||this.engine.state!=='ready'||this.closed)return;this.pumping=true;let processed=false;
  try{let job;while((job=this.jobs.find(j=>j.status==='queued'))&&!this.closed&&this.engine.state==='ready'){
   processed=true;job.status='running';job.progress=0;this.emit('jobs',this.jobs);
   try{await this.runJob(job);job.status=job.status==='cancelling'?'cancelled':'complete';job.progress=100;job.stage='已完成';}
   catch(e){job.status=job.status==='cancelling'?'cancelled':'error';job.error=e.message;this.log(e.message);if(/out of memory|显存|CUDA.*memory/i.test(e.message))await this.json('/free',{unload_models:true,free_memory:true}).catch(()=>{});}
   if(this.config.autoUnloadModels!==false&&(this.comfyProcess||this.externalTest)){job.stage='正在卸载模型、释放显存';this.emit('jobs',this.jobs);await this.json('/free',{unload_models:true,free_memory:true}).then(()=>{job.resourcesReleased=true;}).catch(e=>this.log('资源清理：'+e.message));if(job.status==='complete')job.stage='已完成 · 已卸载模型';}
   this.activeGraph=null;this.emit('preview','');await this.persist();this.emit('jobs',this.jobs);
  }
  if(processed&&this.config.autoUnloadModels!==false&&!this.jobs.some(j=>j.status==='queued'))await this.releaseIdleEngine();
  }finally{this.pumping=false;if(this.engine.state==='ready'&&this.jobs.some(j=>j.status==='queued'))void this.pump();}
 }
 async releaseIdleEngine(){
  const child=this.comfyProcess;if(!child)return;
  this.engine={...this.engine,state:'releasing',message:'正在关闭空闲引擎，释放显存与内存'};this.emit('engine',this.engine);
  this.releasing=new Promise(resolve=>{const timer=setTimeout(()=>{this.log('等待空闲引擎退出超时');resolve();},15000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();});
  try{await this.releasing;if(!this.translatorPending?.size)this.translator?.kill();if(!this.tagTranslator?.pending?.size)this.tagTranslator?.close();this.zhTranslator?.close();this.engine={...this.engine,state:'stopped',message:'生成完成，生图引擎内存与显存已释放'};this.emit('engine',this.engine);}finally{this.releasing=null;}
 }
 async runJob(job){
  const original=job.imageId?this.findImage(job.imageId):null;let imageFile;
  if(original){imageFile=`source-${job.id}${path.extname(original.file)}`;await fs.copyFile(this.filePath(original.file),path.join(this.data,'imports',imageFile));}
  const workflow=buildWorkflow(job.params,this.schemas,{image:imageFile,mask:job.maskFile});this.activeGraph=workflow.graph;
  const submitted=await this.json('/prompt',{prompt:workflow.graph,client_id:this.clientId});job.promptId=submitted.prompt_id;this.emit('jobs',this.jobs);
  for(let t=0;t<7200&&!this.closed;t++){
   if(!this.comfyProcess&& !this.externalTest)throw Error('生图引擎已经退出');
   const history=await this.json('/history/'+job.promptId);const record=history[job.promptId];
   if(record){
    if(record.status?.status_str==='error')throw Error(job.runtimeError||record.status.messages?.find(m=>m[0]==='execution_error')?.[1]?.exception_message||'工作流执行失败');
    const images=record.outputs?.[workflow.saveNode]?.images||[];
    if(!images.length&&job.status==='cancelling')return;
    if(images.length){for(const image of images){
     const r=await this.request('/view?'+new URLSearchParams(image));if(!r.ok)throw Error('无法读取生成结果');
     const id=crypto.randomUUID();const filename=`${id}.png`;await fs.writeFile(path.join(this.data,'output',filename),Buffer.from(await r.arrayBuffer()));
     let background;try{background=original&&job.params.inpaint.preserveBackground?await preserveInpaintBackground(this,job,original,path.join(this.data,'output',filename)):null;}catch(error){await fs.unlink(path.join(this.data,'output',filename)).catch(()=>{});throw error;}
     if(this.closed||job.status==='cancelling'){await fs.unlink(path.join(this.data,'output',filename)).catch(()=>{});return;}
     const info=pngMetadata(await fs.readFile(path.join(this.data,'output',filename)));
     const item={id,file:'output/'+filename,url:'/api/files/'+id,title:`${job.params.type==='expanded'?'Anima 2.9B':'Anima'} · ${job.params.seed}`,created:new Date().toISOString(),params:{...job.params,width:info.width||job.params.width,height:info.height||job.params.height,...(job.imageId?{steps:job.params.inpaint.steps,cfg:job.params.inpaint.cfg,sampler:job.params.inpaint.sampler,scheduler:job.params.inpaint.scheduler}:{})},target:job.target,jobId:job.id,generationMode:job.imageId?'inpaint':'generate',sourceImageId:job.imageId,...(background?{backgroundProtection:background}:{})};
     this.gallery.unshift(item);job.resultId=id;await atomicJson(path.join(this.data,'output',`${id}.json`),item);await this.placeGenerated(item);this.emit('generated',item);
    }this.emit('gallery',this.gallery);return;}
    if(record.status?.completed)throw Error('工作流没有输出图像');
   }
   if(job.runtimeError)throw Error(job.runtimeError);
   if(job.status==='cancelling'&&t>3)return;
   await pause(800);
  }
  throw Error('任务超时或软件关闭');
 }
 filePath(relative){const p=path.resolve(this.data,relative);if(!p.startsWith(this.data+path.sep))throw Error('路径超出工作区');return p;}
 async importImageFile(file){const b=await fs.readFile(file);return this.importImage({name:path.basename(file),base64:b.toString('base64')});}
 async importImage({name,base64,projectMetadata}){
  const ext=path.extname(String(name)).toLowerCase();if(!['.png','.jpg','.jpeg','.webp'].includes(ext))throw Error('请选择 PNG、JPG 或 WebP 图片');
  const buffer=Buffer.from(base64,'base64');if(buffer.length>40*1024*1024)throw Error('图片不能大于 40MB');
  const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpg=buffer[0]===255&&buffer[1]===216;const webp=buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WEBP';
  if(!png&&!jpg&&!webp)throw Error('无法识别图片内容');
  const saved=projectMetadata&&['generate','inpaint'].includes(projectMetadata.mode)?validateParams(projectMetadata.params):null;
  const id=crypto.randomUUID(),filename=id+ext;await fs.writeFile(path.join(this.data,'imports',filename),buffer);
  const item={id,file:'imports/'+filename,url:'/api/files/'+id,title:path.basename(name),created:new Date().toISOString(),imported:!saved,params:saved||extractGeneration(buffer),...(saved?{generationMode:projectMetadata.mode}:{})};this.gallery.unshift(item);await this.persist();this.emit('gallery',this.gallery);return item;
 }
 async importModels(files,category){
  const folder=this.folder(category);const result=[];for(const file of files){const base=path.basename(file);if(!/\.(safetensors|ckpt|pth|pt|gguf)$/i.test(base))throw Error('不支持的模型格式');const dest=path.join(folder,base);if(existsSync(dest))throw Error(`已存在 ${base}，请先更名再导入`);await fs.copyFile(file,dest);result.push(base);}this.emit('models',await this.models());return result;
 }
 async placeGenerated(item){const target=item.target;if(!target?.projectId)return;const project=await this.readProject(target.projectId).catch(()=>null);const panel=project?.pages.find(p=>p.id===target.pageId)?.objects.find(o=>o.id===target.panelId&&o.kind==='panel');if(!panel)return;setPanelImage(panel,item,{replaceDraft:false});await this.saveProject(project);}
 async saveProject(project){
  if(this.deletedProjectIds?.has(project?.id))throw Error('此项目已移入回收区，请先恢复后再编辑');
  if(!project||typeof project.name!=='string'||!Array.isArray(project.pages)||project.pages.length>100)throw Error('项目格式不正确');
  if(!project.pages.length)throw Error('项目至少需要一页');stripProjectImageMetadata(project,new Set((this.galleryTrash||[]).filter(item=>!item.restoredAt).map(item=>item.id)));
  for(const page of project.pages){if(!Number.isFinite(page.width)||!Number.isFinite(page.height)||page.width<128||page.height<128||page.width>8192||page.height>8192||!Array.isArray(page.objects)||page.objects.length>500)throw Error('画布数据无效');for(const obj of page.objects){if(!['panel','text','bubble','sticker','stroke'].includes(obj.kind))throw Error('未知图层类型');if(obj.image&&!obj.image.startsWith('/api/files/')&&!/^data:image\/(png|jpeg|webp);base64,/.test(obj.image))throw Error('图片引用无效');}}
  if(!/^[0-9a-f-]{36}$/.test(project.id||''))project.id=crypto.randomUUID();project.updated=new Date().toISOString();
  await atomicJson(path.join(this.data,'projects',project.id+'.json'),project);
  const entry={id:project.id,name:project.name,updated:project.updated,pages:project.pages.length};const i=this.projects.findIndex(p=>p.id===project.id);if(i>=0)this.projects[i]=entry;else this.projects.unshift(entry);
  await atomicJson(path.join(this.data,'project-index.json'),this.projects);this.emit('projects',this.projects);return project;
 }
 async exportFile({name,base64,kind,projectName}){
  const filename=path.basename(String(name||'漫画.png')).replace(/[<>:"|?*\x00-\x1f]/g,'_');
  if(!/\.(png|json|txt|sql)$/i.test(filename)||typeof base64!=='string')throw Error('导出文件格式不正确');
  const content=Buffer.from(base64,'base64');if(!content.length||content.length>64*1024*1024)throw Error('导出内容为空或超过 64MB');
  const base=path.join(this.data,'exports'),target=kind==='comic'?comicExportPath(base,projectName,filename).path:path.join(base,filename),temporary=target+'.tmp';await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(temporary,content);await fs.rename(temporary,target);
  if(kind==='comic')await this.saveConfig({lastComicExportFolder:path.dirname(target),comicExportFolders:{[encodeURIComponent(projectName||'')]:path.dirname(target)}});
  return {file:path.relative(this.data,target).replaceAll('\\','/'),path:target};
 }
 async readProject(id){if(!/^[0-9a-f-]{36}$/.test(id))throw Error('无效项目');if(this.deletedProjectIds?.has(id))throw Error('此项目已移入回收区');const project=await readJson(path.join(this.data,'projects',id+'.json'),null);if(!project)throw Error('没有找到此项目或有效备份');return project;}
 async deleteProject(id,{deleteRelated=false}={}){
  if(this.trashPurging)throw Error('正在清空回收区，请稍后重试');
  if(this.jobs.some(j=>['running','queued','cancelling'].includes(j.status)&&j.target?.projectId===id))throw Error('此项目仍有生图任务，请先停止任务再删除');
  const project=await this.readProject(id),file=path.join(this.data,'projects',id+'.json'),folder=path.join(this.data,'trash/projects');
  const related=deleteRelated?await projectRelatedImages(this,project):{ids:[],retained:[]};
  this.deletedProjectIds.add(id);
  try{
   await fileQueues.get(file);await fs.mkdir(folder,{recursive:true});const entry={id,name:project.name,pages:project.pages.length,deletedAt:new Date().toISOString(),file:id+'-'+Date.now()+'.json'};
   const latest=await readJson(file,project);await atomicJson(path.join(folder,entry.file),latest);
   entry.deleteRelated=deleteRelated;entry.imageIds=related.ids;entry.retainedImageIds=related.retained;
   entry.fileMoves=deleteRelated?relatedFileMoves(this,id,related.ids,entry.file.slice(0,-5)):[];
   entry.scopes=takeProjectScopes(this.config,id);
   this.projectTrash.push(entry);await atomicJson(path.join(folder,'index.json'),this.projectTrash);
   for(const suffix of ['','.bak','.tmp'])await fs.unlink(file+suffix).catch(e=>{if(e.code!=='ENOENT')throw e;});
   this.projects=this.projects.filter(p=>p.id!==id);await atomicJson(path.join(this.data,'project-index.json'),this.projects);
   for(let i=0;i<related.ids.length;i+=1000)await this.deleteImages(related.ids.slice(i,i+1000));
   await moveRelatedFiles(this,entry.fileMoves);
   this.config.openProjectIds=(this.config.openProjectIds||[]).filter(p=>p!==id);if(this.config.lastProjectId===id)this.config.lastProjectId=null;await this.saveConfig({});this.emit('projects',this.projects);return{projects:this.projects,trash:this.projectTrash,config:this.config};
  }catch(e){if(!this.projectTrash.some(p=>p.id===id))this.deletedProjectIds.delete(id);throw e;}
 }
 async restoreProject(id){
  if(this.trashPurging)throw Error('正在清空回收区，请稍后重试');
  const entry=this.projectTrash.find(p=>p.id===id);if(!entry||!/^[0-9a-f-]{36}-\d+\.json$/.test(entry.file))throw Error('没有找到此项目的回收记录');
  const project=await readJson(path.join(this.data,'trash/projects',entry.file),null);if(!project)throw Error('回收文件不可用');
  await moveRelatedFiles(this,entry.fileMoves,true);
  const imageIds=(entry.imageIds||[]).filter(imageId=>this.galleryTrash.some(image=>image.id===imageId&&!image.restoredAt));
  for(let i=0;i<imageIds.length;i+=1000)await this.restoreImages(imageIds.slice(i,i+1000));
  restoreProjectScopes(this.config,entry.scopes);await this.saveConfig({});
  this.deletedProjectIds.delete(id);try{await this.saveProject(project);}catch(e){this.deletedProjectIds.add(id);throw e;}
  this.projectTrash=this.projectTrash.filter(p=>p.id!==id);await atomicJson(path.join(this.data,'trash/projects/index.json'),this.projectTrash);return{project,projects:this.projects,trash:this.projectTrash,config:this.config};
 }
 async downloadModels(profile){
  if(!['original','expanded','inpaint','finishing','translation','tag_translation','translation_setup','cutout','cutout_general','selection','all','requested'].includes(profile))throw Error('未知模型类型');if(this.install.state==='running')throw Error('已经有安装任务进行中');
  const python=path.join(this.runtime,'python/python.exe');if(!existsSync(python))throw Error('请先安装 Python 运行环境');
  const run=this.installRun=crypto.randomUUID(),previous=this.install.profile===profile?this.install:{};
  this.install={...previous,state:'running',phase:'connecting',profile,percent:previous.percent||0,message:'连接模型下载源…'};this.emit('install',this.install);
  let env;try{env=await network.environment();}catch(e){this.install={...this.install,state:'error',message:'网络检测失败，请点击刷新重试'};this.emit('install',this.install);throw e;}
  const child=spawn(python,['-I',this.downloaderPath,profile==='requested'&&this.modelManifestPath?this.modelManifestPath:this.defaultManifestPath,this.folder('models'),profile,this.config.downloadSource||'auto'],{windowsHide:true,env:{...env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});this.installChild=child;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  let pending='';child.stdout.on('data',b=>{if(this.installRun!==run)return;pending+=b.toString();const lines=pending.split('\n');pending=lines.pop();for(const line of lines){try{const e=JSON.parse(line);this.install={...this.install,...e,state:e.type==='error'?'error':'running',percent:e.type==='done'?100:e.percent??this.install.percent??0,overallPercent:e.type==='done'?100:e.overallPercent??this.install.overallPercent??0,message:e.message||e.name||'下载完成'};this.emit('install',this.install);}catch{this.log(line);}}});child.stderr.on('data',b=>{if(this.installRun===run)this.log(b.toString());});
  child.on('error',e=>{if(this.installRun!==run)return;this.install={...this.install,state:'error',message:e.message};this.emit('install',this.install);});
  child.on('exit',async code=>{if(this.installChild===child)this.installChild=null;if(this.installRun!==run)return;if(code!==0&&this.install.state!=='error')this.install={...this.install,state:'error',message:'下载中断，再次点击可以继续'};if(code===0&&this.install.state!=='error'){try{if(profile==='requested')await completeLlmDownload(this);this.install={...this.install,state:'done',percent:100,overallPercent:100};}catch(error){this.install={...this.install,state:'error',message:error.message};}}this.emit('install',this.install);this.emit('models',await this.models());});return true;
 }
 async controlDownload(action){
  if(!['pause','resume','retry','cancel'].includes(action))throw Error('未知下载操作');if(this.downloadControlBusy)throw Error('正在切换下载状态，请稍候');
  if(this.install.profile==='llm_runtime'){if(this.networkTransfer&&['running','paused'].includes(this.networkTransfer.state)){this.networkTransfer.control(action==='retry'?'resume':action);this.install={...this.install,state:this.networkTransfer.state,speed:0};this.emit('install',this.install);return this.install;}if(['resume','retry'].includes(action)){void this.assistant.installRuntime().catch(e=>this.log(e.message));return this.install;}throw Error('没有可控制的语言运行时下载');}
  if(!this.install.profile||this.install.profile==='runtime')throw Error('当前任务不支持此下载操作');this.downloadControlBusy=true;
  try{
   const profile=this.install.profile;
   if(action==='resume'){if(this.install.state==='running')return this.install;await this.downloadModels(profile);return this.install;}
   this.installRun=null;const child=this.installChild;
   if(child){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('下载进程尚未停止，请稍后重试')),7000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.once('error',e=>{clearTimeout(timer);reject(e);});child.kill();});if(this.installChild===child)this.installChild=null;}
   this.install={...this.install,state:action==='cancel'?'cancelled':'paused',speed:0,eta:null,message:action==='cancel'?'已取消下载，已下载部分保留，可重新开始续传':'已暂停，继续时从已下载位置续传'};this.emit('install',this.install);
   if(action==='retry')await this.downloadModels(profile);return this.install;
  }finally{this.downloadControlBusy=false;}
 }
 async bootstrap(){
  if(this.install.state==='running')throw Error('安装任务已在进行');if(process.platform!=='win32')throw Error('自动安装目前支持 Windows');
  const script=path.join(externalBundle,'scripts/bootstrap.ps1');this.install={state:'running',profile:'runtime',percent:0,message:'正在准备独立运行环境…'};this.emit('install',this.install);
  const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Target',this.root],{windowsHide:true});this.installChild=child;
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{this.log(b.toString());this.install.message=b.toString().trim().slice(-220);this.emit('install',this.install);});
  child.on('error',e=>{this.install={state:'error',message:e.message};this.emit('install',this.install);});child.on('exit',code=>{this.installChild=null;this.install={state:code===0?'done':'error',percent:code===0?100:0,message:code===0?'运行环境安装完成，可以启动引擎':'安装未完成，请查看日志并重试'};this.emit('install',this.install);});return true;
 }
 async prepareTranslationModels(){
  if(this.translationSetup)return this.translationSetup;
  this.translationSetup=(async()=>{
   const entries=JSON.parse(await fs.readFile(this.defaultManifestPath,'utf8')).downloads.translation_setup;
   if(!entries?.length)throw Error('翻译模型清单缺失');
   const complete=async()=>{for(const entry of entries)try{if((await fs.stat(path.join(this.folder('models'),entry.target))).size!==entry.size)return false;}catch{return false;}return true;};
   if(!await complete()){
    while(this.install.state==='running'&&!this.closed)await pause(500);if(this.closed)return;
    await this.downloadModels('translation_setup');const child=this.installChild;
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('翻译模型下载中断，可在下载窗口继续')));});
    if(!await complete())throw Error('翻译模型尚未完整下载');
   }
   if(!this.config.translationSetupCompleted)await this.saveConfig({translationSetupCompleted:true});
   this.translationRouter?.failures.clear();this.emit('models',await this.models());
  })().finally(()=>{this.translationSetup=null;});return this.translationSetup;
 }
 async translationProviders(target){
  this.translationRouter||=new TranslationRouter();const providers=[],cloud=this.config.translationCloud!==false&&await this.assistant?.hasKey();
  if(cloud)providers.push({id:'deepseek',name:'DeepSeek',timeout:10000,run:(texts,signal)=>this.assistant.translateTexts(texts,target,signal)});
  const folder=path.join(this.folder('models'),target==='en'?'translation':'tag_translation');
  if(existsSync(path.join(folder,'pytorch_model.bin'))){const key=target==='en'?'zhTranslator':'tagTranslator';providers.push({id:'offline-'+target,name:'离线翻译模型（CPU）',timeout:25000,cancel:()=>this[key]?.close(),run:texts=>{this[key]||=new OfflineTranslator(path.join(this.runtime,'python/python.exe'),path.join(externalBundle,'assets/translate_worker.py'),folder,target==='en'?'zh-en':'en-zh');return this[key].translate(texts);}});}
  const urls=[this.config.translatorUrl,...(this.config.translatorBackups||[])].filter((v,i,a)=>v&&a.indexOf(v)===i).slice(0,4);
  for(const [i,address] of urls.entries()){let url;try{url=new URL(address);}catch{continue;}if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol))continue;
   providers.push({id:'local-'+url.href,name:i?'本地备用翻译服务 '+i:'本地翻译服务',timeout:2000,run:async(texts,signal)=>{const result=[];for(const text of texts){const response=await networkFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:text,source:target==='en'?'zh':'en',target,format:'text'}),signal});if(!response.ok)throw Error('翻译服务暂不可用');result.push((await response.json()).translatedText);}return result;}});
  }
  const preferred=this.config.translationPreferred||'auto';if(preferred!=='auto')providers.sort((a,b)=>Number(b.id.startsWith(preferred))-Number(a.id.startsWith(preferred)));
  return providers;
 }
 async translate(text){
  if(typeof text!=='string'||text.length>8000)throw Error('翻译文本过长');
  const tags=[...(await this.tagLibrary()).tags,...(this.config.customTags||[])],dictionary=new Map(tags.filter(t=>t.zh&&t.en).map(t=>[t.zh.trim(),t.en]));
  // Translate complete tag entries locally. Replacing every short Chinese word
  // inside a sentence would corrupt natural language with a larger dictionary.
  const result=text.split(/([,，\n])/).map(part=>dictionary.get(part.trim())||part).join('');
  if(!/[\u4e00-\u9fff]/.test(result))return{text:result,source:'本地词库'};
  const routed=await this.translationRouterRun([text],'en');
  if(routed.values.has(text))return{text:routed.values.get(text),source:routed.sources.get(text),fallback:routed.failures.length>0};
  return{text:result,source:'本地词库',partial:true,message:'可用翻译服务均未完成，已保留未翻译内容。请检查翻译设置中的模型或备用服务。'};
 }
 async translationRouterRun(texts,target){const providers=await this.translationProviders(target),data=await this.translationRouter.run(texts,target,providers);this.translationStatus={at:new Date().toISOString(),source:[...new Set(data.sources.values())].join('、')||'无可用服务',fallback:data.failures.length>0,unresolved:texts.filter(t=>!data.values.has(t)).length};return data;}
 async translateTags(tags){
  if(!Array.isArray(tags)||tags.length>120||tags.some(t=>typeof t!=='string'||t.length>2000)||tags.join('').length>16000)throw Error('标签过多或过长');
  const dictionary=[...(await this.tagLibrary()).tags,...(this.config.customTags||[])];
  const normalize=t=>t.replace(/^\(+|\)+$/g,'').replace(/:[\d.]+$/,'').replaceAll('_',' ').trim().toLowerCase();
  const tagged=await readJson(path.join(bundle,'assets/tag-dictionary.json'),{}),known=new Map([...Object.entries(tagged),...dictionary.filter(t=>t.en&&t.zh).map(t=>[normalize(t.en),t.zh])]),keys=tags.map(normalize);
  const missing=[...new Set(keys.filter(k=>k&&!known.has(k)&&!validTranslation(k,this.tagTranslations[k],'zh')&&!/[\u4e00-\u9fff]/.test(k)))];
  let routed;
  if(missing.length){routed=await this.translationRouterRun(missing,'zh');for(const [key,value] of routed.values)this.tagTranslations[key]=value;if(routed.values.size)await atomicJson(path.join(this.data,'autosave/tag-translations.json'),this.tagTranslations);}
  const unresolved=missing.filter(k=>!routed?.values.has(k));
  return{translations:Object.fromEntries(tags.map((tag,i)=>[tag,known.get(keys[i])||this.tagTranslations[keys[i]]||tag])),sources:[...new Set([...(keys.some(k=>known.has(k))?['本地词库']:[]),...(routed?[...routed.sources.values()]:[]),...(keys.some(k=>validTranslation(k,this.tagTranslations[k],'zh'))?['翻译缓存']:[])])],partial:!!unresolved.length,unresolved:tags.filter((_,i)=>unresolved.includes(keys[i])),message:unresolved.length?'部分标签暂未译出，已尝试备用服务，可稍后刷新重试。':''};
 }
 async translateOffline(text){this.zhTranslator||=new OfflineTranslator(path.join(this.runtime,'python/python.exe'),path.join(externalBundle,'assets/translate_worker.py'),path.join(this.folder('models'),'translation'),'zh-en');return this.zhTranslator.translate(text);}
 shutdown(){this.closed=true;this.updates?.close();this.networkTransfer?.control('cancel');this.cacheMaintenance?.close();void this.danbooruUpstream?.close();void this.assistant?.stop();this.cutoutChild?.kill();this.inpaintBackgroundChild?.kill();this.socket?.close();this.comfyProcess?.kill();this.installChild?.kill();this.translator?.kill();this.tagTranslator?.close();this.zhTranslator?.close();void this.persist();}
}
