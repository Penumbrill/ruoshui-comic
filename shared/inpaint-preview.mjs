// A generated result never becomes the painting source implicitly.
export function inpaintSource(item,gallery,current=null,rememberedSourceId=null){
 if(!item)return null;
 if(current&&(item.id===current.id||item.sourceImageId===current.id))return current;
 // Explicitly importing a previous result makes that image the new original.
 // Retain that choice after closing the editor or restarting the application.
 if(item.id===rememberedSourceId||item.cutout||item.imported&&item.generationMode!=='inpaint'&&rememberedSourceId!==item.sourceImageId)return item;
 return gallery.find(image=>image.id===item.sourceImageId)||item;
}
export function inpaintResult(item,source){
 return item&&source&&item.id!==source.id&&item.sourceImageId===source.id?item:null;
}
export function matchesGenerationWorkspace(job,mode,target){
 if(!!job.imageId!==(mode==='inpaint'))return false;
 return target?job.target?.projectId===target.projectId&&job.target?.pageId===target.pageId&&job.target?.panelId===target.panelId:!job.target;
}
