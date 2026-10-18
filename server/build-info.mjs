import fs from 'node:fs/promises';import path from 'node:path';
export async function installedBuild(root,version){
 try{const value=JSON.parse(await fs.readFile(path.join(root,'ruoshui-build.json'),'utf8'));if(value.appId==='com.guangyingruoshui.comic'&&value.version===version&&/^[a-f0-9]{40}$/i.test(value.commit)&&Number.isFinite(Date.parse(value.builtAt)))return value;}catch{}
 return null;
}
export function assetBuild(asset){return asset?.label?.match(/\bbuild\s+([a-f0-9]{7,40})\b/i)?.[1]?.toLowerCase()||'';}
export function newerBuild(local,commit,updatedAt){
 if(!commit||local?.commit?.startsWith(commit))return false;
 const remoteTime=Date.parse(updatedAt),localTime=Date.parse(local?.builtAt);
 return !Number.isFinite(localTime)||!Number.isFinite(remoteTime)||remoteTime>localTime;
}
