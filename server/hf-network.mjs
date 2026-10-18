import {network,networkFetch} from './network.mjs';

export const hfConnectionHelp='无法连接模型官网及镜像。提示词助手的模型下载时需连接网络加速器，请连接后重试；也可导入已下载的本地模型。';
export async function hfJson(url,{fetcher=networkFetch,source=network.config().downloadSource||'auto',validate=()=>true,timeoutMs=10000}={}){
 const canonical=new URL(url,'https://huggingface.co');
 if(canonical.origin!=='https://huggingface.co'||!canonical.pathname.startsWith('/api/models'))throw Error('模型查询地址无效');
 const hosts=source==='mirror'?['https://hf-mirror.com','https://huggingface.co']:['https://huggingface.co','https://hf-mirror.com'];
 const statuses=[];
 for(const host of hosts){
  try{
   const response=await fetcher(host+canonical.pathname+canonical.search,{signal:AbortSignal.timeout(timeoutMs)});
   if(!response.ok){statuses.push(response.status);await response.body?.cancel();continue;}
   const data=await response.json();if(!validate(data))continue;
   return{data,headers:response.headers,source:host};
  }catch{}
 }
 if(statuses.length===2&&statuses.every(s=>s===401||s===403))throw Error('模型仓库需要登录或访问许可，请在官网获取权限后导入本地模型。');
 if(statuses.length===2&&statuses.every(s=>s===404))throw Error('模型仓库或文件不存在，请检查地址后重新查询。');
 throw Error(hfConnectionHelp);
}
