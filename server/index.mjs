import {network,networkFetch} from './network.mjs';
import {pluginRequest,pluginImage,imageLoader} from './danbooru-plugin.mjs';
import {DanbooruUpstream} from './danbooru-upstream.mjs';
import {CacheMaintenance} from './cache-maintenance.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AssistantManager} from './assistant.mjs';
import {cutout} from './cutout.mjs';
import {StudioService} from './service.mjs';
import {packages,versions,installPackage,backup,installVc} from './packages.mjs';
import {inspectModels,hfFiles,addHfModel} from './model-catalog.mjs';
import {managedFiles} from './portable-paths.mjs';
import {UpdateManager} from './updates.mjs';
import {dependencyDownload} from './dependency-downloads.mjs';
import {searchLlmModels} from './llm-models.mjs';
import {FontCatalog} from './fonts.mjs';
const bundle=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
export async function startServer({port=4319,service:given,vault,resolveProxy,nativeFetch}={}){
 const service=given||await new StudioService(process.env.MANHUA_HOME||bundle).init();
 network.config=()=>service.config;network.resolveProxy=resolveProxy;network.nativeFetch=nativeFetch;
 service.assistant=await new AssistantManager(service,vault).init();
 service.updates=await new UpdateManager(service).init();
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   const host=req.headers.host?.split(':')[0];if(!['127.0.0.1','localhost'].includes(host))return send({error:'只允许本机访问'},403);
   if(req.headers.origin&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(req.headers.origin))return send({error:'拒绝外部页面请求'},403);
   if(req.headers['sec-fetch-site']==='cross-site'&&url.pathname.startsWith('/api/'))return send({error:'跨站请求已拒绝'},403);
   if(url.pathname==='/api/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('data: '+JSON.stringify({type:'snapshot',data:service.snapshot()})+'\n\n');
    const listener=e=>res.write('data: '+JSON.stringify(e)+'\n\n');service.listeners.add(listener);const keep=setInterval(()=>res.write(': ping\n\n'),20000);req.on('close',()=>{clearInterval(keep);service.listeners.delete(listener);});return;
   }
   if(url.pathname.startsWith('/plugin/danbooru/')){const rel=url.pathname.slice('/plugin/danbooru/'.length)||'index.html';if(!/^[a-zA-Z0-9_.-]+$/.test(rel))return send({error:'无效路径'},400);const b=await fs.readFile(path.join(bundle,'assets/danbooru-browser',rel));res.writeHead(200,{'Content-Type':mime[path.extname(rel)]||'text/plain','Cache-Control':'no-store'});return res.end(b);}
   if(url.pathname==='/api/internal/danbooru-transport'){if(req.headers['x-plugin-token']!==service.danbooruUpstream?.token)return send({error:'禁止访问'},403);const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>2*1024*1024)return send({error:'请求过大'},413);chunks.push(chunk);}try{return send(await service.danbooruUpstream.transport(JSON.parse(Buffer.concat(chunks).toString())));}catch(error){return send({error:error.message});}}
   if(url.pathname==='/api/danbooru/image-status')return send(imageLoader(service).failures.get(url.searchParams.get('url'))||{message:'图片加载失败，可点击重试'});
   if(url.pathname==='/danbooru_anima/image_proxy'){try{const image=await pluginImage(service,url.searchParams.get('url'));res.writeHead(200,{'Content-Type':image.mime,'Cache-Control':'private, max-age=86400'});return res.end(image.buffer);}catch(error){return send({error:error.message},502);}}
   if(url.pathname.startsWith('/api/danbooru/image/')){const image=await pluginImage(service,url.pathname);res.writeHead(200,{'Content-Type':image.mime,'Cache-Control':'private, max-age=86400'});return res.end(image.buffer);}
   if(url.pathname.startsWith('/api/fonts/file/')){const font=await (service.fontCatalog||(service.fontCatalog=new FontCatalog(service))).file(url.pathname.split('/').at(-1));res.writeHead(200,{'Content-Type':font.type,'Cache-Control':'private, max-age=86400'});return res.end(font.bytes);}
   if(url.pathname.startsWith('/api/files/')&&url.pathname!=='/api/files/inventory'){
    const id=url.pathname.split('/').at(-1);const item=service.findImage(id);if(!item)return send({error:'图像不存在'},404);
    const b=await fs.readFile(service.filePath(item.file));res.writeHead(200,{'Content-Type':mime[path.extname(item.file)]||'image/png','Cache-Control':'private, max-age=86400'});return res.end(b);
   }
   let body={};if(req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))return send({error:'需要 JSON 请求'},415);
    let size=0;const buffers=[];for await(const b of req){size+=b.length;if(size>70*1024*1024)return send({error:'请求内容过大'},413);buffers.push(b);}body=JSON.parse(Buffer.concat(buffers).toString()||'{}');
   }
   if(url.pathname.startsWith('/danbooru_anima/')||url.pathname==='/api/danbooru/preferences'||url.pathname==='/api/danbooru/outputs'){const result=url.pathname==='/api/danbooru/outputs'?await service.danbooruUpstream.request(req.method,new URL('/__desktop_outputs',url),body):await pluginRequest(service,req.method+' '+url.pathname,body,url);if(result.buffer){res.writeHead(result.status,{'Content-Type':result.headers['Content-Type']||'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(result.buffer);}return send(result);}
   if(url.pathname.startsWith('/api/')){
    const route=req.method+' '+url.pathname;let result;
    switch(route){
     case 'GET /api/state':result=service.snapshot();break;
     case 'GET /api/fonts':result=await (service.fontCatalog||(service.fontCatalog=new FontCatalog(service))).list();break;
     case 'POST /api/fonts/import':result=await (service.fontCatalog||(service.fontCatalog=new FontCatalog(service))).import(body);break;
     case 'GET /api/updates/status':result=service.updates.state;break;
     case 'POST /api/updates/check':result=await service.updates.check();break;
     case 'POST /api/updates/download':result=await service.updates.download();break;
     case 'POST /api/updates/control':result=await service.updates.control(body.action);break;
     case 'POST /api/danbooru/refresh':{const refreshed=await service.danbooruUpstream.request('POST',new URL('/__desktop_refresh',url),{});result=JSON.parse(refreshed.buffer.toString());break;}
     case 'POST /api/gallery/delete':result=await service.deleteImages(body.ids);break;
     case 'GET /api/gallery/trash':result=service.galleryTrash.filter(item=>!item.restoredAt);break;
     case 'POST /api/gallery/restore':result=await service.restoreImages(body.ids);break;
     case 'GET /api/cache/status':result=await service.cacheMaintenance.status();break;
     case 'POST /api/cache/clean':result=await service.cacheMaintenance.clean(true);break;
     case 'GET /api/network/status':result=await network.status();break;
     case 'POST /api/network/check':{const response=await networkFetch('https://danbooru.donmai.us/tags.json?limit=1',{headers:{Accept:'application/json','User-Agent':'RuoshuiComic/0.1'}});await response.body?.cancel();if(!response.ok)throw Error(response.status===403?'Danbooru 要求验证当前网络出口，请在官网完成验证或更换可正常访问的网络后刷新。':'Danbooru 连接未完成（'+response.status+'）');result=await network.status();break;}
     case 'GET /api/models':result=await service.models();break;
     case 'GET /api/files/inventory':result=await managedFiles(service);break;
     case 'GET /api/schemas':result=service.schemas;break;
     case 'GET /api/environment':result=await service.environment();break;
     case 'POST /api/environment/download':result=await dependencyDownload(service,body.id);break;
     case 'GET /api/tags':result=(await service.tagLibrary()).tags;break;
     case 'GET /api/tag-library':result=await service.tagLibrary();break;
     case 'POST /api/tag-library/refresh':result=await service.tagLibrary(true);break;
     case 'POST /api/tag-library/export':await service.tagLibrary();result=await service.tagCatalog.export(body.format);break;
     case 'POST /api/tag-library/import/preview':await service.tagLibrary();result=await service.tagCatalog.previewImport(body);break;
     case 'POST /api/tag-library/import':await service.tagLibrary();result=await service.tagCatalog.import(body);break;
     case 'POST /api/tag-library/manage':await service.tagLibrary();result=await service.tagCatalog.mutate(body);break;
     case 'POST /api/tag-library/share':await service.tagLibrary();result=await service.tagCatalog.share(body);break;
     case 'GET /api/tag-library/backups':await service.tagLibrary();result=await service.tagCatalog.backups();break;
     case 'POST /api/tag-library/backups/preview':await service.tagLibrary();result=await service.tagCatalog.previewBackup(body.id);break;
     case 'GET /api/assistant/models':result=await service.assistant.models();break;
     case 'POST /api/assistant/test':result=await service.assistant.testKey();break;
     case 'POST /api/assistant/key':result=await service.assistant.saveKey(body.key);break;
     case 'POST /api/assistant/install':result=await service.assistant.installRuntime();break;
     case 'POST /api/assistant/submit':result=await service.assistant.submit(body);break;
     case 'POST /api/assistant/stop':await service.assistant.stop();result={stopped:true};break;
     case 'POST /api/assistant/chats/delete':result=await service.assistant.deleteChats(body);break;
     case 'GET /api/translate/status':result={last:service.translationStatus||null,providers:(await service.translationProviders('en')).map(p=>({id:p.id,name:p.name,coolingDown:(service.translationRouter.failures.get(p.id)||0)>Date.now()}))};break;
     case 'POST /api/assistant/hf/search':result=await searchLlmModels(body.query);break;
     case 'POST /api/settings':result=await service.saveConfig(body);break;
     case 'POST /api/engine/start':result=await service.startEngine();break;
     case 'POST /api/engine/stop':result=await service.stopEngine();break;
     case 'POST /api/jobs':result=await service.enqueue(body);break;
     case 'POST /api/jobs/cancel':result=await service.cancel(body.groupId);break;
     case 'POST /api/jobs/retry':result=await service.retryJob(body.id);break;
     case 'POST /api/images/cutout':result=await cutout(service,body);break;
     case 'POST /api/images/import':result=await service.importImage(body);break;
     case 'POST /api/exports':result=await service.exportFile(body);break;
     case 'POST /api/projects/save':result=await service.saveProject(body);break;
     case 'POST /api/projects/open':result=await service.readProject(body.id);break;
     case 'POST /api/projects/delete':result=await service.deleteProject(body.id);break;
     case 'GET /api/projects/trash':result=service.projectTrash;break;
     case 'POST /api/projects/restore':result=await service.restoreProject(body.id);break;
     case 'POST /api/models/download':result=await service.downloadModels(body.profile);break;
     case 'POST /api/models/download/control':result=await service.controlDownload(body.action);break;
     case 'POST /api/runtime/install':result=await service.bootstrap();break;
     case 'GET /api/runtime/packages':result=await packages(service);break;
     case 'POST /api/runtime/versions':result=await versions(body.name);break;
     case 'POST /api/runtime/package/install':result=await installPackage(service,body);break;
     case 'POST /api/runtime/backup':result=await backup(service);break;
     case 'POST /api/runtime/vc/install':result=await installVc(service);break;
     case 'POST /api/models/check':result=await inspectModels(service,body.full);break;
     case 'POST /api/models/prepare':result=await service.prepareModels(body);break;
     case 'POST /api/models/hf/files':result=await hfFiles(body.url);break;
     case 'POST /api/models/hf/download':result=await addHfModel(service,body);break;
     case 'POST /api/translate/tags':result=await service.translateTags(body.tags);break;
     case 'POST /api/translate':result=await service.translate(body.text);break;
     default:return send({error:'接口不存在'},404);
    }
    return send(result??{ok:true});
   }
   const dist=path.join(bundle,'dist');let file=path.resolve(dist,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(dist+path.sep)&&file!==dist)return send({error:'无效路径'},403);
   if(url.pathname==='/'||!path.extname(file))file=path.join(dist,'index.html');
   const b=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':path.extname(file)==='.html'?'no-store':'public, max-age=31536000, immutable'});res.end(b);
  }catch(e){send({error:e.message},400);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 const url=`http://127.0.0.1:${server.address().port}`;service.danbooruUpstream=new DanbooruUpstream(service,url+'/api/internal/danbooru-transport');service.cacheMaintenance=new CacheMaintenance(service).start();return {service,server,url,close:()=>{service.cacheMaintenance.close();void service.danbooruUpstream.close();server.close();}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const server=await startServer({port:Number(process.env.PORT)||4319});console.log('若水漫画 '+server.url);process.on('SIGINT',()=>{server.service.shutdown();server.close();process.exit();});}
