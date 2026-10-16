// Compatibility for saved desktop thumbnail URLs. Browser functionality is
// provided exclusively by the unmodified upstream Python routes.
import {networkFetch} from './network.mjs';
const posts=new Map();
export async function getPost(id){
 id=String(id);if(!/^\d+$/.test(id))throw Error('图片编号无效');if(posts.has(id))return posts.get(id);
 const response=await networkFetch('https://danbooru.donmai.us/posts/'+id+'.json',{headers:{'User-Agent':'DanbooruAnimaPrompt/1.0 (Anime tag classifier)','Accept':'application/json'},signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error(`无法读取原帖（${response.status}）`);
 const post=await response.json();posts.set(id,post);while(posts.size>500)posts.delete(posts.keys().next().value);return post;
}
