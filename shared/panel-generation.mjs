import {makeProfile,mergeConfig} from '../server/profiles.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
export function layerSourcePanel(layer,page){return layer?.kind==='panel'?layer:(page?.objects||[]).find(o=>o.kind==='panel'&&(o.id===layer?.sourcePanelId||layer?.sourceImageId&&o.imageId===layer.sourceImageId))||null;}
export function cutoutSourceImage(layer,page,gallery=[]){
 const item=gallery.find(i=>i.id===layer?.sourceImageId);if(item)return item;
 const panel=layerSourcePanel(layer,page);if(panel?.image&&(!layer.sourceImageId||panel.imageId===layer.sourceImageId))return{id:panel.imageId,url:panel.image,title:panel.name,params:panel.imageMetadataDeleted?null:panel.lastGeneratedParams||panel.generation?.params};
 return layer?.sourceImage&&/^(?:data:image\/(?:png|jpeg|webp);base64,|\/api\/files\/)/.test(layer.sourceImage)?{id:layer.sourceImageId,url:layer.sourceImage,title:layer.name}:null;
}
export function imageEditingMode(item){
 if(!item||item.imported||item.cutout)return null;
 if(item.generationMode==='inpaint'||item.sourceImageId&&item.jobId)return 'inpaint';
 if(item.generationMode==='generate'||item.jobId)return 'generate';
 return null;
}
export function panelEditingMode(panel,gallery=[]){
 if(panel.imageMetadataDeleted)return null;const item=panelImage(panel,gallery);return item?imageEditingMode(item):panel.imageOrigin?.mode||null;
}
export function panelImage(panel,gallery=[]){
 return gallery.find(item=>panel.imageId?item.id===panel.imageId:item.url===panel.image)||null;
}
export function panelCandidates(panel,target,gallery=[]){
 const items=gallery.filter(item=>item.id===panel.imageId||item.url===panel.image||(item.target?.projectId===target.projectId&&item.target?.pageId===target.pageId&&item.target?.panelId===target.panelId));
 if(panel.image&&!panel.imageMetadataDeleted&&!items.some(item=>item.url===panel.image||panel.imageId&&item.id===panel.imageId))items.push({id:panel.imageId||null,url:panel.image,title:panel.name,params:panel.lastGeneratedParams||panel.generation?.params});
 return items;
}
export function ensurePanelGeneration(panel,gallery=[],fallbackType='original'){
 const associated=panelImage(panel,gallery);if(associated&&!panel.imageOrigin)panel.imageOrigin={mode:imageEditingMode(associated),sourceImageId:associated.sourceImageId||null};
 if(panel.generation?.params)return panel.generation;
 const image=panelImage(panel,gallery),saved=image?.params||panel.lastGeneratedParams,type=saved?.type==='expanded'?'expanded':saved?.type==='original'?'original':fallbackType;
 const params=mergeConfig(makeProfile(type),copy(saved||{}));
 // A blank panel starts with its own story, never the single-image workspace prompt.
 params.positive=saved?.positive??panel.positive??'';params.negative=saved?.negative??panel.negative??'';
 if(panelEditingMode(panel,gallery)==='inpaint')params.inpaint={...params.inpaint,positive:params.positive,negative:params.negative,sourceImageId:image?.id||panel.imageId,maskDraft:null};
 if(!image&&!saved?.width){const points=panel.points||[],xs=points.map(p=>p.x),ys=points.map(p=>p.y),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);if(w>0&&h>0){const scale=1024/Math.sqrt(w*h);params.width=Math.max(256,Math.min(4096,Math.round(w*scale/16)*16));params.height=Math.max(256,Math.min(4096,Math.round(h*scale/16)*16));}}
 panel.generation={params,profiles:{}};return panel.generation;
}
export function setPanelImage(panel,item,{replaceDraft=true}={}){
 panel.image=item.url;panel.imageId=item.id;delete panel.imageMetadataDeleted;
 panel.imageOrigin={mode:imageEditingMode(item),sourceImageId:item.sourceImageId||null};
 if(item.params?.type){panel.lastGeneratedParams=copy(item.params);if(replaceDraft||!panel.generation?.params){const params=mergeConfig(makeProfile(item.params.type),copy(item.params));if(imageEditingMode(item)==='inpaint')params.inpaint={...params.inpaint,positive:item.params.positive||'',negative:item.params.negative||'',sourceImageId:item.id,maskDraft:null};panel.generation={params,profiles:{}};panel.positive=item.params.positive||'';panel.negative=item.params.negative||'';}}
}
