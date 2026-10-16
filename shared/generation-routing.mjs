import {setPanelImage} from './panel-generation.mjs';
export function generationRequest(params,request={}){
 const target=request.target;if(target&&!['projectId','pageId','panelId'].every(key=>typeof target[key]==='string'&&target[key]))throw Error('分镜关联信息不完整');
 return {...request,params,count:params.batch,target:target?{projectId:target.projectId,pageId:target.pageId,panelId:target.panelId}:null};
}
export function applyGeneratedToProject(project,image){const target=image.target;if(!target||project?.id!==target.projectId)return false;const page=project.pages.find(page=>page.id===target.pageId),panel=page?.objects.find(object=>object.id===target.panelId&&object.kind==='panel');if(!panel)return false;setPanelImage(panel,image,{replaceDraft:false});return true;}
