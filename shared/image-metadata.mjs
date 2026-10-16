const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const fields=['generation','lastGeneratedParams','imageOrigin','positive','negative'];
export function stripProjectImageMetadata(project,ids){
 const removed=[];for(const page of project.pages||[])for(const panel of page.objects||[]){if(!ids.has(panel.imageId))continue;const values={};for(const key of fields)if(Object.hasOwn(panel,key)){values[key]=copy(panel[key]);delete panel[key];}panel.imageMetadataDeleted=true;if(Object.keys(values).length)removed.push({pageId:page.id,panelId:panel.id,imageId:panel.imageId,values});}return removed;
}
export function restoreProjectImageMetadata(project,entries){
 for(const entry of entries||[]){const panel=project.pages?.find(p=>p.id===entry.pageId)?.objects.find(p=>p.id===entry.panelId);if(!panel||panel.imageId!==entry.imageId||!panel.imageMetadataDeleted||panel.generation||panel.positive||panel.negative)continue;Object.assign(panel,copy(entry.values));delete panel.imageMetadataDeleted;}
}
export function stripConfigImageMetadata(config,ids,scopes=[]){
 const removed={cutoutDrafts:{},profiles:{},scopes:{}};
 for(const [id,value] of Object.entries(config.cutoutDrafts||{}))if(ids.has(id)){removed.cutoutDrafts[id]=copy(value);delete config.cutoutDrafts[id];}
 for(const [type,profile] of Object.entries(config.profiles||{})){const value=profile.inpaint;if(value&&(ids.has(value.sourceImageId)||ids.has(value.maskDraft?.imageId))){removed.profiles[type]=copy(value);profile.inpaint={...value,sourceImageId:null,positive:'',negative:'',maskDraft:null};}}
 if(ids.has(config.lastImageId)){removed.lastImageId=config.lastImageId;config.lastImageId=null;}
 for(const key of Object.keys(config.previewSizes||{}))if([...ids].some(id=>key.includes(id)))delete config.previewSizes[key];
 for(const field of ['quickPromptDrafts','promptHistory','disabledPromptTags','previewSizes'])for(const key of Object.keys(config[field]||{}))if(scopes.some(scope=>key.includes(scope))){(removed.scopes[field]||={})[key]=copy(config[field][key]);delete config[field][key];}
 return removed;
}
export function restoreConfigImageMetadata(config,removed={}){
 for(const [id,value] of Object.entries(removed.cutoutDrafts||{})){config.cutoutDrafts||={};if(!config.cutoutDrafts[id])config.cutoutDrafts[id]=copy(value);}
 for(const [type,value] of Object.entries(removed.profiles||{})){const current=config.profiles?.[type]?.inpaint;if(current&&!current.sourceImageId&&!current.positive&&!current.negative)config.profiles[type].inpaint=copy(value);}
 if(!config.lastImageId&&removed.lastImageId)config.lastImageId=removed.lastImageId;
 for(const [field,values] of Object.entries(removed.scopes||{}))for(const [key,value] of Object.entries(values)){config[field]||={};if(config[field][key]===undefined)config[field][key]=copy(value);}
}
