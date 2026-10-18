import {ProxyAgent} from 'undici';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
export function localAddress(value){const u=new URL(value),h=u.hostname.toLowerCase();return h==='localhost'||h==='[::1]'||h==='::1'||/^127\./.test(h)||h==='0.0.0.0'||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h);}
export function parseProxy(value,scheme='https'){
 if(typeof value!=='string'||!value.trim())return null;let raw=value.trim();
 if(/^DIRECT$/i.test(raw))return null;
 if(/^(PROXY|HTTPS?|SOCKS)/i.test(raw)&&/\s/.test(raw)){const match=raw.match(/(?:^|;)\s*(?:PROXY|HTTPS?)\s+([^;]+)/i);if(!match)return null;raw=match[1].trim();}
 if(/(?:^|;)(?:http|https)=/.test(raw)){const map=Object.fromEntries(raw.split(';').map(s=>s.trim().split('=')));raw=map[scheme]||map.http||map.https||'';}
 try{const u=new URL(raw.includes('://')?raw:'http://'+raw);if(!['http:','https:'].includes(u.protocol)||!u.hostname)return null;return u.href.replace(/\/$/,'');}catch{return null;}
}
let registryCache,registryAt=0,registryPending;
async function systemProxy(){
 if(process.platform!=='win32')return null;if(Date.now()-registryAt<10000)return registryCache;
 if(!registryPending)registryPending=(async()=>{try{const code="$p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; @{enabled=$p.ProxyEnable;server=$p.ProxyServer}|ConvertTo-Json -Compress",args=['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')];const{stdout}=await exec('powershell.exe',args,{windowsHide:true,timeout:5000,maxBuffer:8192});const p=JSON.parse(stdout);registryCache=p.enabled?parseProxy(p.server):null;}catch{registryCache=null;}registryAt=Date.now();return registryCache;})().finally(()=>registryPending=null);
 return registryPending;
}
export class NetworkManager{
 constructor({detect=systemProxy,fetcher=(...args)=>fetch(...args),config=()=>({}),resolveProxy,connectTimeoutMs=15000}={}){this.detect=detect;this.fetcher=fetcher;this.config=config;this.resolveProxy=resolveProxy;this.connectTimeoutMs=connectTimeoutMs;this.agents=new Map();this.last={route:'尚未连接外网',local:'本机服务直连'};this.cooldown=new Map();}
 async proxy(url){const config=this.config();if(config.networkMode==='direct')return null;if(config.networkMode==='proxy')return parseProxy(config.networkProxy);const env=parseProxy(process.env.HTTPS_PROXY||process.env.https_proxy||process.env.HTTP_PROXY||process.env.http_proxy);if(env)return env;if(this.resolveProxy){try{return parseProxy(await this.resolveProxy(url));}catch{}}return this.detect();}
 agent(proxy){if(!this.agents.has(proxy)){const u=new URL(proxy),credentials=u.username?{token:'Basic '+Buffer.from(decodeURIComponent(u.username)+':'+decodeURIComponent(u.password)).toString('base64')}:{},uri=u.origin;this.agents.set(proxy,new ProxyAgent({uri,...credentials}));}return this.agents.get(proxy);}
 async fetch(url,options={}){
  const address=String(url);if(localAddress(address))return this.fetcher(url,options);
  const proxy=await this.proxy(address),auto=this.config().networkMode!=='proxy';let routes=proxy?[proxy,...(auto?[null]:[])]:[null];if(proxy&&(this.cooldown.get(proxy)||0)>Date.now())routes.reverse();let lastError;
  if(this.config().networkMode==='proxy'&&!proxy)throw Error('手动代理地址无效，请在网络设置中检查');
  for(const route of routes){if(options.signal?.aborted)throw options.signal.reason;const connecting=new AbortController(),timer=setTimeout(()=>connecting.abort(new DOMException('Connection timed out','TimeoutError')),this.connectTimeoutMs);try{
   const signal=AbortSignal.any([...(options.signal?[options.signal]:[]),connecting.signal]),response=this.nativeFetch?await this.nativeFetch(url,{...options,signal},route):await this.fetcher(url,{...options,signal,...(route?{dispatcher:this.agent(route)}:{})});clearTimeout(timer);
   if([502,503,504].includes(response.status)&&routes.length>1&&route===routes[0]){await response.body?.cancel();throw Error('网关暂不可用');}
   this.last={route:route?'系统代理':'直接连接',proxy:proxy?new URL(proxy).host:null,local:'本机服务直连',fallback:route!==routes[0],checkedAt:new Date().toISOString()};if(route)this.cooldown.delete(route);return response;
  }catch(error){lastError=error;if(route)this.cooldown.set(route,Date.now()+30000);}finally{clearTimeout(timer);}}
  this.last={...this.last,error:'外网连接暂不可用，请检查代理或网络线路',checkedAt:new Date().toISOString()};throw lastError;
 }
 async status(){const proxy=await this.proxy('https://danbooru.donmai.us');return{...this.last,mode:this.config().networkMode||'auto',detectedProxy:proxy?new URL(proxy).host:null,local:'本机服务直连'};}
 async environment(){const proxy=await this.proxy('https://huggingface.co');if(this.config().networkMode==='proxy'&&!proxy)throw Error('手动代理地址无效，请在网络设置中检查');return{...process.env,...(proxy?{HTTP_PROXY:proxy,HTTPS_PROXY:proxy,http_proxy:proxy,https_proxy:proxy}:{}),RUOSHUI_PROXY_MODE:this.config().networkMode||'auto',RUOSHUI_PROXY_ENV:'1',NO_PROXY:[process.env.NO_PROXY,'localhost','127.0.0.1','::1'].filter(Boolean).join(','),no_proxy:'localhost,127.0.0.1,::1'};}
}
export const network=new NetworkManager();
export const networkFetch=(url,options)=>network.fetch(url,options);
