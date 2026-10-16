const digits={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12};
const number=value=>Number(value)||digits[value]||0;
export function storyIntent(text,{panelCount=4,pageCount=0}={}){
 text=String(text||'');const pages=text.match(/([一二两三四五六七八九十\d]{1,3})\s*页/),per=text.match(/每页\s*([一二两三四五六七八九十\d]{1,3})\s*[格幅个]/),total=text.match(/(?:共|总共|一共|总计)\s*([一二两三四五六七八九十\d]{1,3})\s*[格幅个]/)||text.match(/[一二两三四五六七八九十\d]{1,3}\s*页\s*([一二两三四五六七八九十\d]{1,3})\s*格/);
 const requestedPages=number(pages?.[1])||Number(pageCount)||1;const requestedTotal=number(total?.[1])||(per?requestedPages*number(per[1]):Number(panelCount)||4);
 const count=Math.max(1,Math.min(12,Math.round(requestedTotal))),pageTotal=Math.max(1,Math.min(count,12,Math.round(requestedPages)));
 return{panelCount:count,pageCount:pageTotal};
}
export function planStoryPages(story,{pageCount=story.pageCount||1}={}){
 const total=story.panels.length,pages=Math.max(1,Math.min(total,Number(pageCount)||1)),each=Math.floor(total/pages),extra=total%pages;let index=0;
 const panels=[];for(let page=1;page<=pages;page++)for(let position=1;position<=each+(page<=extra?1:0);position++)panels.push({...story.panels[index++],page,position});
 return{...story,pageCount:pages,panels};
}
export function storyboardPageGroups(story){const planned=planStoryPages(story);return Array.from({length:planned.pageCount},(_,i)=>({page:i+1,panels:planned.panels.filter(p=>p.page===i+1)}));}
