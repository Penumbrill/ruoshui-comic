import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {DanbooruUpstream,upstreamAddress} from '../server/danbooru-upstream.mjs';
import {DanbooruImages,imageAddress,imageMime} from '../server/danbooru-images.mjs';
import {pluginSelectionPost} from '../shared/danbooru-selection.mjs';
import {classifyPost} from '../shared/anima-tags.mjs';

const root=path.resolve(import.meta.dirname,'..'),assets=path.join(root,'assets/danbooru-browser');
test('existing prompt UI uses finished upstream outputs and preserves original count and multi-image boundaries',()=>{
 const outputs={all:'no_humans, landscape\n=== 图2 ===\nlandscape, cloud',count:'no_humans',general:'landscape, cloud'};
 const selected=pluginSelectionPost({id:1,tags:['unfiltered_tag']},outputs,{multiple:true});assert.equal(selected.pluginOutputs.all,outputs.all);assert.equal(selected.pluginMultiple,true);assert(!selected.tag_string.includes('unfiltered_tag'));assert.deepEqual(classifyPost(selected,selected.pluginCategories).count,['no_humans']);assert(!selected.tag_string.includes('图2'));
});
async function fixture(t){const folder=await fs.mkdtemp(path.join(root,'works/tests/danbooru-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));return folder;}

test('missing independent Python reports browser startup failure without crashing the host',async t=>{const folder=await fixture(t),data=path.join(folder,'works');await fs.mkdir(path.join(data,'logs'),{recursive:true});const browser=new DanbooruUpstream({data,runtime:path.join(folder,'missing-runtime')},'http://127.0.0.1:1/api/internal/danbooru-transport');await assert.rejects(browser.request('GET',new URL('http://localhost/danbooru_anima/favorites'),{}),/ENOENT/);assert.equal(browser.pending.size,0);});
test('browser and backend retain upstream source byte for byte, with only host imports replaced',async()=>{
 const original=await fs.readFile(path.join(assets,'danbooru_browser.original.js'),'utf8');
 assert.equal(await fs.readFile(path.join(assets,'danbooru_browser.js'),'utf8'),original.replace('"/scripts/app.js"','"./host.js"').replace('"/scripts/ui.js"','"./ui.js"'));
 const metadata=JSON.parse(await fs.readFile(path.join(assets,'UPSTREAM.json'),'utf8'));
 for(const [file,sha]of Object.entries(metadata.backendHashes))assert.equal(createHash('sha256').update(await fs.readFile(path.join(assets,'upstream',file))).digest('hex'),sha,file);
});
test('image transport validates real bytes and keeps origin permission failures visible',async t=>{
 const folder=await fixture(t),image=Buffer.from([255,216,255,224,1,2,255,217]);let calls=0;
 const loader=new DanbooruImages(folder,{fetcher:async()=>{calls++;return new Response(image,{headers:{'Content-Type':'application/octet-stream'}});}});
 const url='https://cdn.donmai.us/test.jpg';assert.equal((await loader.load(url)).mime,'image/jpeg');await loader.load(url);assert.equal(calls,1);
 assert.throws(()=>imageAddress('http://127.0.0.1/private'),/来源/);assert.throws(()=>imageAddress(''),/没有公开/);
 assert.throws(()=>upstreamAddress('https://example.com'),/不受支持/);
 assert.throws(()=>imageMime(Buffer.from('<html>verification</html>'),'text/html'),/验证网页/);
 let forbidden=0;const denied=new DanbooruImages(folder,{fetcher:async()=>{forbidden++;return new Response('',{status:403});}});
 await assert.rejects(()=>denied.load('https://cdn.donmai.us/denied.jpg'),/403/);assert.equal(forbidden,1);assert.match(denied.failures.get('https://cdn.donmai.us/denied.jpg').message,/403/);
});
test('CDN concurrency covers body reading and duplicate images share one request',async t=>{
 const folder=await fixture(t),bytes=new Uint8Array([255,216,255,224,255,217]);let active=0,peak=0,calls=0;
 const loader=new DanbooruImages(folder,{fetcher:async()=>{calls++;active++;peak=Math.max(peak,active);return new Response(new ReadableStream({start(controller){setTimeout(()=>{controller.enqueue(bytes);controller.close();active--;},15);}}));}});
 await Promise.all([...Array.from({length:9},(_,i)=>loader.load('https://cdn.donmai.us/'+i+'.jpg')),loader.load('https://cdn.donmai.us/0.jpg')]);assert.equal(calls,9);assert(peak<=3);assert.equal(loader.active,0);
});
test('transient image failures retry but HTML responses never enter the disk cache',async t=>{
 const folder=await fixture(t);let calls=0;const loader=new DanbooruImages(folder,{fetcher:async()=>++calls===1?new Response('',{status:503}):new Response(Buffer.from([255,216,255,224]))});await loader.load('https://cdn.donmai.us/retry.jpg');assert.equal(calls,2);
 const html=new DanbooruImages(folder,{fetcher:async()=>new Response('<html>bad</html>',{headers:{'Content-Type':'text/html'}})});await assert.rejects(()=>html.load('https://cdn.donmai.us/html.jpg'),/验证网页/);assert.equal((await fs.readdir(folder)).filter(f=>f.endsWith('.image')).length,1);
});
test('real upstream routes preserve all rating subsets, search operators, image URLs and favorites behavior',{timeout:90000},async t=>{
 const folder=await fs.mkdtemp(path.join(root,'works/tests/danbooru-'));await fs.mkdir(path.join(folder,'logs'));let requested=[];
 const post={id:123,width:100,image_width:100,image_height:200,tag_string:'1girl solo highres blue_hair landscape',preview_file_url:'https://cdn.donmai.us/preview.jpg',large_file_url:'https://cdn.donmai.us/sample.jpg',file_url:'https://cdn.donmai.us/original.jpg',file_ext:'jpg',rating:'g',score:2};
 const transport=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks)),url=new URL(body.url);requested.push(url);const data=url.pathname==='/posts.json'?[post]:url.pathname.includes('/posts/')?post:[];res.end(JSON.stringify({status:200,headers:{'Content-Type':'application/json'},body:Buffer.from(JSON.stringify(data)).toString('base64')}));});
 await new Promise(resolve=>transport.listen(0,'127.0.0.1',resolve));
 const upstream=new DanbooruUpstream({data:folder,runtime:path.join(root,'runtime')},'http://127.0.0.1:'+transport.address().port);
 t.after(async()=>{await upstream.close();transport.closeAllConnections();await new Promise(resolve=>transport.close(resolve));await fs.rm(folder,{recursive:true,force:true});});
 const request=async(method,route,body={})=>{const response=await upstream.request(method,new URL(route,'http://127.0.0.1'),body);return JSON.parse(response.buffer);};
 const ratings=['general','sensitive','questionable','explicit'];
 for(let mask=0;mask<16;mask++){
  const selected=ratings.filter((_,i)=>mask&(1<<i)),tags='landscape -monochrome order:score';
  const result=await request('POST','/danbooru_anima/search',{tags,page:mask+1,limit:48,rating:selected});assert.equal(result.success,true);
  const params=requested.filter(u=>u.pathname==='/posts.json').at(-1).searchParams;
  const suffix=selected.length===1?' rating:'+selected[0]:selected.length>1?' '+ratings.filter(r=>!selected.includes(r)).map(r=>'-rating:'+r).join(' '):'';
  assert.equal(params.get('tags'),tags+suffix);assert.equal(params.get('limit'),'48');assert.equal(params.get('page'),String(mask+1));
  assert.equal(result.posts[0].preview_url,post.preview_file_url);assert.equal(result.posts[0].large_url,post.large_file_url);assert.equal(result.posts[0].tags,post.tag_string);
  assert.deepEqual(result.posts[0].classified.count,['1girl','solo']);
  const stringResult=await request('POST','/danbooru_anima/search',{tags:'order:rank landscape',page:mask+101,limit:60,rating:selected.join(','),order:'score'});assert.equal(stringResult.success,true);
  const stringParams=requested.filter(u=>u.pathname==='/posts.json').at(-1).searchParams,stringSuffix=selected.length===1?' rating:'+selected[0]:selected.length>1&&selected.length<4?' '+ratings.filter(r=>!selected.includes(r)).map(r=>'-rating:'+r).join(' '):'';
  assert.equal(stringParams.get('tags'),'order:score order:rank landscape'+stringSuffix);assert.equal(stringParams.get('limit'),'60');
 }
 const cn=await request('POST','/danbooru_anima/local_tags',{query:'hatsune_miku'});assert(cn.tags.some(t=>t.tag==='hatsune_miku'&&t.cn&&t.src==='本地'));
 const searchBody={tags:'landscape refresh-verification',page:1,limit:12,rating:'general'};
 await request('POST','/danbooru_anima/search',searchBody);const beforeRefresh=requested.filter(u=>u.pathname==='/posts.json').length;await request('POST','/danbooru_anima/search',searchBody);assert.equal(requested.filter(u=>u.pathname==='/posts.json').length,beforeRefresh);assert.equal((await request('POST','/__desktop_refresh')).success,true);await request('POST','/danbooru_anima/search',searchBody);assert.equal(requested.filter(u=>u.pathname==='/posts.json').length,beforeRefresh+1);
 const chinese=await request('POST','/danbooru_anima/local_tags',{query:'初音'});assert(chinese.tags.length>0&&chinese.tags.every(t=>t.cn.includes('初音')),JSON.stringify(chinese));
 await request('POST','/danbooru_anima/favorites/add',{tag:'landscape',category:'general',thumb_url:post.preview_file_url,cn:'风景'});
 let favorites=(await request('GET','/danbooru_anima/favorites')).favorites;assert.equal(favorites.general.landscape.thumb,post.preview_file_url);assert.equal(favorites.general.landscape.cn,'风景');
 const created=await request('POST','/danbooru_anima/favorites/folder',{action:'create',category:'general',name:'风景组'});assert.equal(created.success,true);
 const moved=await request('POST','/danbooru_anima/favorites/folder',{action:'move',category:'general',item_keys:['landscape'],target_folder:'风景组'});assert.equal(moved.success,true);
 favorites=(await request('GET','/danbooru_anima/favorites')).favorites;assert.deepEqual(favorites._folders.general['风景组'],['landscape']);
 const single=await request('POST','/__desktop_outputs',{selection_data:JSON.stringify({post_id:123,image_connected:false})});assert.equal(single.outputs.all,'1girl, solo, highres, blue_hair, landscape');assert.equal(single.outputs.count,'1girl, solo');
 const multi=await request('POST','/__desktop_outputs',{selection_data:JSON.stringify({selections:[{post_id:123},{post_id:124}],image_connected:false,merge:{all:true,count:false}})});assert.equal(multi.outputs.all,'1girl, blue_hair, highres, landscape, solo');assert.equal(multi.outputs.count,'1girl, solo\n=== 图2 ===\n1girl, solo');
 const fusion=await request('POST','/__desktop_outputs',{selection_data:JSON.stringify({image_connected:false}),_tag_fusion:JSON.stringify({'1':[123],'2':[124]})});assert.equal(fusion.success,true);assert.equal(fusion.outputs.count,'1girl, solo');assert(fusion.outputs.general.includes('blue_hair'));
 assert.equal((await request('GET','/danbooru_anima/settings')).success,true);
 assert(upstream.routeCount>=30);
});
