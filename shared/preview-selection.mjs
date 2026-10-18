// Each workspace owns its selection, even while its view is cached.
export function previewMode(image){return image?.generationMode==='inpaint'||(!image?.generationMode&&image?.sourceImageId)?'inpaint':'generate';}
export function previewSelections(config,gallery){
 const ids=config.previewImageIds;
 const result={generate:null,inpaint:null};
 if(ids){for(const mode of Object.keys(result))result[mode]=gallery.find(i=>i.id===ids[mode])||null;}
 else {const legacy=gallery.find(i=>i.id===config.lastImageId);if(legacy)result[previewMode(legacy)]=legacy;}
 return result;
}
