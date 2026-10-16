const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}_]+/gu,' ').replace(/\s+/g,' ').trim();
const families=[['爱心','心形','心心','heart'],['汗滴','汗珠','流汗','sweat'],['摩擦','轻蹭','抚摸','蹭蹭','rubbing'],['拥抱','抱紧','抱住','hug'],['亲吻','轻吻','接吻','kiss'],['闪光','闪亮','sparkle'],['钓鱼','垂钓','fishing'],['生气','愤怒','angry'],['高兴','开心','快乐','happy']];
function near(a,b){
 const limit=Math.min(2,Math.max(1,Math.floor(a.length/5)));if(a.length<3||Math.abs(a.length-b.length)>limit)return false;
 let previous=Array.from({length:b.length+1},(_,i)=>i),before;
 for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++){row[j]=Math.min(row[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])row[j]=Math.min(row[j],before[j-2]+1);}before=previous;previous=row;}return previous[b.length]<=limit;
}
function termMatches(term,text){
 const words=text.split(/\s+/);
 if(text.includes(term)&&(!/^[a-z]{2,3}$/.test(term)||words.some(word=>word.startsWith(term)||new RegExp('^[0-9]+'+term).test(word))))return true;
 if(/^[a-z]{2,3}$/.test(term))return words.some(word=>word.length===term.length&&near(term,word));
 if(term.length>=2){let from=text.indexOf(term[0]);while(from>=0){let at=from+1,n=1;while(n<term.length){at=text.indexOf(term[n],at);if(at<0)break;at++;n++;}if(n===term.length&&at-from<=term.length*2+1)return true;from=text.indexOf(term[0],from+1);}}
 return text.split(/\s+/).some(word=>near(term,word));
}
export function searchPredicate(query){
 const terms=normalize(query).split(' ').filter(Boolean).slice(0,20).map(term=>families.find(group=>group.includes(term))||[term]);
 return(...values)=>{if(!terms.length)return true;const text=normalize(values.flat(Infinity).filter(v=>v!==null&&v!==undefined).join(' '));return terms.every(variants=>variants.some(term=>termMatches(term,text)));};
}
export function fuzzyMatch(query,...values){return searchPredicate(query)(...values);}
