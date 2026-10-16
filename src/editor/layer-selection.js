export function chooseLayerIds(current,id,{toggle=false,group=[id]}={}){
 if(toggle)return current.includes(id)?current.filter(value=>value!==id):[...current,id];
 if(current.length===group.length&&group.every(value=>current.includes(value)))return[];
 return [...group];
}
export function contextLayerIds(current,id,group=[id]){return !id||current.includes(id)?[...current]:[...group];}
