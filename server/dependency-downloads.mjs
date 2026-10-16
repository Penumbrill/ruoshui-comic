import {networkFetch} from './network.mjs';import {links} from './environment.mjs';
const vendors={nvidia:{page:'https://www.nvidia.com/en-us/software/nvidia-app/',host:'download.nvidia.com',name:'NVIDIA 驱动自动匹配助手'},amd:{page:'https://www.amd.com/en/support/download/drivers.html',host:'drivers.amd.com',name:'AMD 驱动自动检测助手'},intel:{page:'https://www.intel.com/content/www/us/en/support/detect.html',host:'downloadmirror.intel.com',name:'Intel 驱动与支持助手'}};
export function officialExecutable(html,host){for(const candidate of html.match(/https:\/\/[^\s"'<>]+\.exe(?:\?[^\s"'<>]*)?/gi)||[]){try{const url=new URL(candidate.replaceAll('&amp;','&'));if(url.hostname===host||url.hostname.endsWith('.'+host))return url.href;}catch{}}return null;}
export async function dependencyDownload(service,id,{fetcher=networkFetch}={}){
 if(id==='vc'){service.links.vc=links.vc;return{id,url:links.vc,name:'微软 x64 Visual C++ 运行库',direct:true};}
 if(id!=='driver')throw Error('请选择缺少的软件');
 const env=await service.environment(),names=(env.gpus||[]).map(g=>g.name).join(' ')+' '+(env.videoControllers||[]).join(' ');const vendor=/NVIDIA|GeForce|Quadro/i.test(names)?vendors.nvidia:/AMD|Radeon/i.test(names)?vendors.amd:/Intel/i.test(names)?vendors.intel:null;
 if(!vendor)throw Error('未能识别显卡厂商，请先重新检测电脑；软件可使用 CPU 模式。');
 const response=await fetcher(vendor.page,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('厂商下载页暂时不可用，请稍后重试');const direct=officialExecutable(await response.text(),vendor.host);const url=direct||vendor.page;service.links.driver=url;return{id,url,name:vendor.name,direct:!!direct};
}
