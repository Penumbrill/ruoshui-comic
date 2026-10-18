import {networkFetch} from './network.mjs';
import {hfJson} from './hf-network.mjs';
import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicJson} from './service.mjs';
import {llmDownloadSelection,ggufShardFiles} from '../shared/llm-recommendation.mjs';
import {registerLlmDownload} from './llm-downloads.mjs';
const exec=promisify(execFile);
export async function inspectModels(service,full=false){
 const manifest=service.modelManifestPath||service.defaultManifestPath;
 const {stdout}=await exec(path.join(service.runtime,'python/python.exe'),['-I',service.downloaderPath,manifest,service.folder('models'),'all',full?'check-full':'check'],{windowsHide:true,timeout:600000,maxBuffer:4*1024*1024});
 const data=stdout.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(d=>d?.type==='integrity');return data?.items||[];
}
export async function hfFiles(url,{fetcher=networkFetch}={}){
 let repo;if(/^https:\/\/(?:huggingface\.co|hf-mirror\.com)\//.test(url)){const parts=new URL(url).pathname.split('/').filter(Boolean);repo=parts.slice(0,2).join('/');}else repo=url;
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('请输入 Hugging Face 模型主页地址或 owner/repo');
 const {data:info}=await hfJson(`https://huggingface.co/api/models/${repo}`,{fetcher,validate:data=>/^[a-f0-9]{40,64}$/i.test(data?.sha||'')});
 const prefix=`https://huggingface.co/api/models/${repo}/tree/${info.sha}`,files=[],seen=new Set();let next=prefix+'?recursive=true&expand=true';
 while(next){if(!next.startsWith(prefix+'?')||seen.has(next)||seen.size>=100)throw Error('模型文件分页地址无效');seen.add(next);const {data:page,headers}=await hfJson(next,{fetcher,validate:Array.isArray});files.push(...page);const link=headers.get('link')?.match(/<([^>]+)>;\s*rel="?next"?/i);next=link?new URL(link[1],next).href.replace(/^https:\/\/hf-mirror\.com\//,'https://huggingface.co/'):null;}
 return {repo,revision:info.sha,files:files.filter(f=>/\.(safetensors|pth|pt|ckpt|gguf)$/i.test(f.path)&&/^[a-f0-9]{64}$/i.test(f.lfs?.oid||'')).map(f=>({name:f.path,size:f.size??f.lfs.size,sha256:f.lfs.oid}))};
}
export async function addHfModel(service,{repo,revision,name,category,projectorName},{lookup=hfFiles}={}){
 if(!['diffusion_models','text_encoders','vae','loras','controlnet','upscale_models','detectors','llm'].includes(category))throw Error('请选择模型目录');
 if(service.install.state==='running'||service.modelCatalogBusy)throw Error('已经有安装任务进行中');service.modelCatalogBusy=true;
 try{
  const info=await lookup(repo);if(info.revision!==revision)throw Error('仓库已有更新，请重新查询文件列表');const file=info.files.find(f=>f.name===name);if(!file)throw Error('模型文件不存在');
  const selection=category==='llm'?llmDownloadSelection(info.files,name,projectorName):null;
  const selected=selection?.files||ggufShardFiles(info.files,file.name),items=selected.map(f=>{if(/[:\x00-\x1f]/.test(f.name)||f.name.includes('\\')||f.name.split('/').some(p=>!p||p==='.'||p==='..')||!Number.isSafeInteger(f.size)||f.size<=0||!/^[a-f0-9]{64}$/i.test(f.sha256))throw Error('模型文件或校验信息无效');return{repo,revision,url:`https://huggingface.co/${repo}/resolve/${revision}/${f.name.split('/').map(encodeURIComponent).join('/')}`,target:(category==='detectors'?'ultralytics/bbox':category)+'/'+path.basename(f.name),size:f.size,sha256:f.sha256};});
  const builtins=JSON.parse(await fs.readFile(path.join(service.bundle,'assets/model-manifest.json'),'utf8'));const managed=JSON.parse(await fs.readFile(path.join(service.data,'custom-models.json'),'utf8').catch(()=>'[]'));
  for(const item of items){const existing=managed.find(m=>m.target===item.target);if(existing&&existing.sha256!==item.sha256)throw Error('同名模型已登记，请先在源仓库或本地更名');if(!existing)managed.push(item);}
  await atomicJson(path.join(service.data,'custom-models.json'),managed);builtins.downloads.custom=managed;builtins.downloads.requested=items;await atomicJson(path.join(service.data,'model-manifest.json'),builtins);service.modelManifestPath=path.join(service.data,'model-manifest.json');
  if(selection)await registerLlmDownload(service,selection,items);
  await service.downloadModels('requested');return{started:true,modelName:selection?.model?.name||null,projectorName:selection?.projector?.name||null,files:items.map(i=>({name:path.basename(i.target),size:i.size}))};
 }finally{service.modelCatalogBusy=false;}
}
