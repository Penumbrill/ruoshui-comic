export function releaseSources(url,{proxy=false,sha256}={}){
 const value=new URL(url);
 if(value.protocol!=='https:'||value.hostname!=='github.com'||value.username||value.password||!/^\/[\w.-]+\/[\w.-]+\/releases\/download\/[\w.+-]+\/[^/]+$/.test(value.pathname)||value.search||value.hash)return [url];
 const pinned=/^[a-f0-9]{64}$/i.test(sha256||'')?url+'?ruoshui_sha256='+sha256:url;
 const domestic=['https://gh-proxy.org/'+pinned,'https://ghfast.top/'+pinned];
 return proxy?[pinned,...domestic]:[...domestic,pinned];
}
