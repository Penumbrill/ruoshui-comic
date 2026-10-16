import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson,readJson} from './service.mjs';
import {getPost} from './danbooru.mjs';
import {DanbooruImages} from './danbooru-images.mjs';
import {contentRatingPreference} from '../assets/danbooru-browser/content-controls.js';

export async function pluginRequest(service,route,body,url){
 const folder=path.join(service.data,'danbooru');await fs.mkdir(folder,{recursive:true});
 if(route==='GET /api/danbooru/preferences'){const settings=await readJson(path.join(folder,'ui.json'),{});return{...settings,rating_filter:contentRatingPreference(settings.rating_filter,service.config.adultContentEnabled===true),__allowAdultFilters:service.config.adultContentEnabled===true};}
 if(route==='POST /api/danbooru/preferences'){const {__allowAdultFilters,...settings}=body;settings.rating_filter=contentRatingPreference(settings.rating_filter,service.config.adultContentEnabled===true);await atomicJson(path.join(folder,'ui.json'),settings);return{success:true};}
 return service.danbooruUpstream.request(route.split(' ')[0],url,body);
}
export function imageLoader(service){return service.danbooruImages||=new DanbooruImages(path.join(service.data,'cache/danbooru-cdn'));}
export async function pluginImage(service,raw){
 const local=String(raw).match(/^\/api\/danbooru\/image\/(\d+)$/);
 if(local){const post=await getPost(local[1]);raw=post.preview_file_url||post.large_file_url||post.file_url;}
 return imageLoader(service).load(raw);
}
