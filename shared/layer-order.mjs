export const layerGroup=object=>object.cutout?'cutout':object.kind;
export function moveLayerSelection(objects,ids,direction,scope='group'){
 const result=[...objects],selected=new Set(ids),step=direction>0?1:-1;
 const order=step>0?[...objects].reverse():objects;
 for(const object of order){
  if(!selected.has(object.id))continue;const index=result.indexOf(object);let next=index+step;
  while(next>=0&&next<result.length&&(selected.has(result[next].id)||(scope==='group'&&layerGroup(result[next])!==layerGroup(object))))next+=step;
  if(next>=0&&next<result.length){if(scope==='group')[result[index],result[next]]=[result[next],result[index]];else{result.splice(index,1);result.splice(next,0,object);}}
 }
 return result;
}
export function canMoveLayerSelection(objects,ids,direction,scope='group'){const next=moveLayerSelection(objects,ids,direction,scope);return objects.some((object,index)=>next[index]!==object);}
