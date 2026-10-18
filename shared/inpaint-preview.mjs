// A generated result never becomes the painting source implicitly.
export function inpaintSource(item,gallery,current=null){
 if(!item)return null;
 if(current&&(item.id===current.id||item.sourceImageId===current.id))return current;
 return gallery.find(image=>image.id===item.sourceImageId)||item;
}
export function inpaintResult(item,source){
 return item&&source&&item.id!==source.id&&item.sourceImageId===source.id?item:null;
}
export function matchesGenerationWorkspace(job,mode,target){
 if(!!job.imageId!==(mode==='inpaint'))return false;
 return target?job.target?.projectId===target.projectId&&job.target?.pageId===target.pageId&&job.target?.panelId===target.panelId:!job.target;
}
