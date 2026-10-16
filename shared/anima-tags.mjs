export const tagSections={quality:'质量 / 元标签',count:'人物数量',character:'人物名称',series:'作品 / 系列',appearance:'人物特征',clothing:'服饰 / 配件',action:'动作 / 姿势',expression:'表情',environment:'环境 / 光线',artist:'画师',other:'其他标签'};
export function animaTag(tag){const text=String(tag||'').trim().toLowerCase();return /^score_\d+$/.test(text)?text:text.replaceAll('_',' ');}
export function classifyPost(post,overrides={}){
 const sections=Object.fromEntries(Object.keys(tagSections).map(k=>[k,[]]));
 const known=new Map();for(const [field,section] of [['artist','artist'],['character','character'],['copyright','series'],['meta','quality']])for(const tag of String(post['tag_string_'+field]||'').split(/\s+/).filter(Boolean))known.set(tag,section);
 const raw=String(post.tag_string||post.rawTags||'');const tags=(post.rawTags&&/[,，]/.test(raw)?raw.split(/[,，\n]/).map(t=>t.trim().replaceAll(' ','_')):raw.split(/[,\s]+/)).filter(Boolean);
 for(const tag of [...new Set(tags)]){let section=overrides[tag]||known.get(tag);if(!section){if(/^(\d+(girl|boy|other)s?|solo|multiple_(girls|boys|others))$/.test(tag))section='count';else if(/quality|^score_\d+$|^year_\d+|^(masterpiece|safe|sensitive|nsfw|explicit|highres|absurdres|newest|recent|old)$/.test(tag))section='quality';else if(/hair|eyes?|bangs|ponytail|twintails|skin|freckles|ears?|horns?|wings?|tail$/.test(tag))section='appearance';else if(/dress|coat|shirt|skirt|uniform|gloves?|socks?|shoes?|boots?|hat$|scarf|ribbon|jacket|pants|shorts|sleeves|necklace|glasses|accessor/.test(tag))section='clothing';else if(/smil|frown|blush|angry|crying|tears|surpris|open_mouth|closed_eyes|happy|sad$/.test(tag))section='expression';else if(/standing|sitting|lying|kneeling|running|walking|holding|hugging|jumping|leaning|looking|hand|arms?|legs?|pose|pointing|waving|turning|reaching/.test(tag))section='action';else if(/background|outdoors|indoors|sky|cloud|sun|moon|night|forest|tree|flower|street|room|city|river|water|light|shadow|rain|snow|beach|mountain|landscape|window|building/.test(tag))section='environment';else section='other';}if(sections[section])sections[section].push(tag);else sections.other.push(tag);}
 return sections;
}
export function combineTags(sections,{quality='masterpiece, best quality, score_7, safe',excludeArtists=true,natural=''}={}){
 const output=[],seen=new Set();const append=t=>{const text=animaTag(t);if(text&&!seen.has(text)){seen.add(text);output.push(text);}};
 String(quality).split(/[,，\n]/).forEach(append);
 for(const section of ['quality','count','character','series','artist','appearance','clothing','action','expression','environment','other']){if(section==='artist'&&excludeArtists)continue;for(const tag of sections[section]||[])append(section==='artist'?'@'+tag.replace(/^@/,''):tag);}
 return output.join(', ')+(output.length?', ':'')+(natural.trim()?'\n'+natural.trim():'');
}
