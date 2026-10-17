export const defaultLlmRepository='HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF';
export const isVisionProjector=name=>/\.gguf$/i.test(name)&&/mmproj|projector/i.test(name);
const directory=name=>name.includes('/')?name.slice(0,name.lastIndexOf('/')):'';
const stem=name=>name.split('/').at(-1).replace(/\.gguf$/i,'').replace(/-\d{5}-of-\d{5}$/i,'').replace(/^(?:mmproj|projector|vision)[-_.]*/i,'').replace(/(?:^|[-_.])(?:[IQ]\d[\w]*|BF16|FP?16|FP?32)$/i,'').replace(/[-_.](?:mmproj|projector)$/i,'').toLowerCase();
const projectorStem=name=>stem(name)==='model'?'':stem(name);
export function matchingProjectors(files=[],name=''){
 const candidates=files.filter(f=>isVisionProjector(f.name));
 const exact=candidates.filter(f=>projectorStem(f.name)===stem(name));
 const familyCount=folder=>new Set(files.filter(f=>directory(f.name)===folder&&/\.gguf$/i.test(f.name)&&!isVisionProjector(f.name)&&!/fastmtp/i.test(f.name)).map(f=>stem(f.name))).size;
 let matches=exact.length?exact:candidates.filter(f=>!projectorStem(f.name)&&directory(f.name)===directory(name)&&familyCount(directory(name))===1);
 if(!matches.length&&new Set(files.filter(f=>/\.gguf$/i.test(f.name)&&!isVisionProjector(f.name)&&!/fastmtp/i.test(f.name)).map(f=>stem(f.name))).size===1)matches=candidates.filter(f=>!projectorStem(f.name));
 const rank=f=>/[-_.]F16\.gguf$/i.test(f.name)?0:/[-_.]BF16\.gguf$/i.test(f.name)?1:/[-_.]F32\.gguf$/i.test(f.name)?2:3;
 return matches.sort((a,b)=>Number(directory(b.name)===directory(name))-Number(directory(a.name)===directory(name))||rank(a)-rank(b)||a.name.localeCompare(b.name));
}
export function ggufShardFiles(files,name){
 const file=files.find(f=>f.name===name);if(!file)throw Error('模型文件不存在');
 const shard=file.name.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
 const selected=shard?files.filter(f=>{const m=f.name.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);return m&&m[1]===shard[1]&&m[3]===shard[3];}).sort((a,b)=>a.name.localeCompare(b.name)):[file];
 if(shard&&(selected.length!==Number(shard[3])||selected.some((f,i)=>!f.name.toLowerCase().endsWith('-'+String(i+1).padStart(5,'0')+'-of-'+shard[3]+'.gguf'))))throw Error('分片不完整，请选择其他量化版本');
 return selected;
}
export function llmDownloadSelection(files,name,projectorName){
 const file=files.find(f=>f.name===name);if(!file)throw Error('模型文件不存在');
 const selected=ggufShardFiles(files,file.name);
 if(isVisionProjector(file.name))return{model:null,projector:file,files:selected};
 if(!/\.gguf$/i.test(file.name)||/fastmtp/i.test(file.name))throw Error('请选择主 GGUF 模型');
 const candidates=files.filter(f=>isVisionProjector(f.name));
 const projector=projectorName?candidates.find(f=>f.name===projectorName):matchingProjectors(files,name)[0];
 if(projectorName&&!projector)throw Error('配套视觉模型不存在，请重新选择');
 if(!projector&&candidates.length)throw Error('发现多个或不同系列的视觉模型，请选择与主模型配套的 mmproj');
 return{model:selected[0],projector:projector||null,files:[...selected,...(projector?[projector]:[])]};
}
export function recommendedLlmFile(files=[]){
 const main=files.filter(f=>/\.gguf$/i.test(f.name)&&!/mmproj|projector|fastmtp/i.test(f.name));
 return main.find(f=>/Q4_K_P\.gguf$/i.test(f.name))||main.find(f=>/Q4_K_M\.gguf$/i.test(f.name))||main.find(f=>/IQ4_XS\.gguf$/i.test(f.name))||null;
}
