import {networkFetch} from './network.mjs';
const decode=text=>text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
export function assetsFromHtml(html,repo,tag){
 const assets=[];
 for(const item of html.split('</li>')){
  const match=item.match(/href="([^"\s]+\/releases\/download\/[^"\s]+)"/),digest=item.match(/sha256:([a-f0-9]{64})/);
  if(!match||!match[1].startsWith('/'+repo+'/releases/download/'+encodeURIComponent(tag)+'/')&&!match[1].startsWith('/'+repo+'/releases/download/'+tag+'/'))continue;
  const name=decodeURIComponent(match[1].split('/').at(-1));if(name.includes('/')||name.includes('\\'))continue;
  assets.push({name,browser_download_url:'https://github.com'+decode(match[1]),digest:digest?'sha256:'+digest[1]:null});
 }return assets;
}
export async function githubRelease(repo,{tag='latest',fetcher=networkFetch}={}){
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo)||!/^[\w.+-]+$/.test(tag))throw Error('发布源无效');
 const api=await fetcher('https://api.github.com/repos/'+repo+'/releases/'+(tag==='latest'?'latest':'tags/'+tag),{headers:{'User-Agent':'RuoshuiComic',Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
 if(api.ok)return api.json();
 if(![403,429,404].includes(api.status))throw Error('发布源暂不可用（'+api.status+'）');
 const page=await fetcher('https://github.com/'+repo+'/releases/'+(tag==='latest'?'latest':'tag/'+tag),{signal:AbortSignal.timeout(30000)});
 if(page.status===404)return null;if(!page.ok)throw Error('发布页面暂不可用（'+page.status+'）');
 const actual=decodeURIComponent(new URL(page.url).pathname.split('/').at(-1));if(!/^[\w.+-]+$/.test(actual)||actual==='latest')throw Error('发布版本无法确认');
 const html=await page.text(),assetPage=await fetcher('https://github.com/'+repo+'/releases/expanded_assets/'+encodeURIComponent(actual),{signal:AbortSignal.timeout(30000)});if(!assetPage.ok)throw Error('无法读取发布文件');
 const body=html.match(/<div[^>]*data-test-selector="body-content"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
 return{tag_name:actual,name:actual,html_url:page.url,body:decode(body.replace(/<\/(p|li|h\d)>/g,'\n').replace(/<[^>]+>/g,'')).trim(),assets:assetsFromHtml(await assetPage.text(),repo,actual),source:'official-page'};
}
export async function resolveAssetSize(asset,fetcher=networkFetch){if(Number.isSafeInteger(asset.size)&&asset.size>0)return asset;const r=await fetcher(asset.browser_download_url,{method:'HEAD',signal:AbortSignal.timeout(30000)});const size=Number(r.headers.get('content-length'));if(!r.ok||!Number.isSafeInteger(size)||size<=0)throw Error('无法确认发布文件大小');return{...asset,size};}
