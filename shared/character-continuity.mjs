// Small verified identity anchors. Unknown characters are handled by the model's
// character sheet; uncertain wardrobe details must be omitted rather than invented.
export const characterAnchors=[
 {id:'klee',name:'可莉',aliases:['可莉','klee'],appearance:'blonde hair, red eyes, pointed ears',outfit:'her red clover beret with white feathers, red coat with white trim, white shorts, brown boots and a small brown backpack',source:'https://wiki.hoyolab.com/pc/genshin/entry/12?lang=zh-cn'},
 {id:'qiqi',name:'七七',aliases:['七七','qiqi'],appearance:'light purple hair, pinkish red eyes',outfit:'her purple Chinese-style outfit, dark purple round hat, paper talisman on her forehead, large white prayer beads and white socks',source:'https://genshin.hoyoverse.com/en/character/liyue',conflicts:['green eyes','green and white alchemist outfit','green and white outfit','goggles','short light blue hair']}
];
const mentions=(text,character)=>character.aliases.some(alias=>new RegExp(/[a-z]/i.test(alias)?'\\b'+alias+'\\b':alias,'i').test(text));
export function characterPlan(text){
 const known=characterAnchors.filter(character=>mentions(String(text),character));const changed=new Set();let previous=[];
 for(const clause of String(text).split(/[，,。；;\n]/)){
  const named=known.filter(character=>mentions(clause,character));if(named.length)previous=named;
  const change=/(穿(?:着|上)?|换装|换衣|改穿|服饰|衣服|服装|校服|泳装|运动服|衬衫|外套|连衣裙|长裙|短裙|制服|wear|dressed|outfit|clothes|costume|uniform)/i.test(clause);
  const preserve=/(默认|经典|原版|原装|原本|保持|照旧|default|canonical|original)/i.test(clause)&&!/(换|改|不要默认|不要原|instead|change|replace)/i.test(clause);
  if(change&&!preserve){const targets=named.length?named:/(两人|两位|她们|他们|都|both|all|they)/i.test(clause)?known:previous.length?previous:known.length===1?known:[];targets.forEach(c=>changed.add(c.id));}
 }
 return known.map(character=>({...character,customOutfit:changed.has(character.id)}));
}
export function characterInstruction(text){
 const plan=characterPlan(text);
 return '\nCharacter consistency: create a fixed character sheet before writing panels. Repeat each visible character\'s same verified hair, headwear and clothing in each panel, tied explicitly to their name. Keep colors and accessories consistent. If the user specifies an outfit or a change of clothes, use that requested outfit and do not append the canonical costume or headwear. Do not mix accessories from another character. For characters you cannot identify reliably, use their exact name and series, omit uncertain facts, and never invent an alchemist costume or a different uniform.\n'+plan.map(c=>`${c.name} (${c.id}, Genshin Impact): ${c.appearance}. ${c.customOutfit?'USER OUTFIT OVERRIDE: do not add canonical clothing or hat; follow the user\'s clothing instructions.':'Canonical outfit: '+c.outfit+'. Use this outfit consistently.'}`).join('\n');
}
export function anchorCharacterStory(story,text){
 const plan=characterPlan(text);if(!plan.length)return story;
 return{...story,characters:story.characters?.map(character=>{const known=plan.find(c=>mentions(character.name||'',c));return known&&!known.customOutfit?{...character,appearance:known.appearance+', '+known.outfit}:character;}),panels:story.panels.map(panel=>{
  let positive=panel.positive;const present=plan.filter(c=>mentions(positive+' '+panel.description,c));
  for(const c of present){const start=(c.id==='klee'?'Klee':'Qiqi')+' has '+c.appearance;positive=positive.replace(start+', and wears '+c.outfit+'.','').replace(start+'.','');if(!c.customOutfit)for(const conflict of c.conflicts||[])positive=positive.replace(new RegExp('(?:^|,\\s*)'+conflict+'(?=,|$)','gi'),'');}
  const notes=present.map(c=>`${c.name==='可莉'?'Klee':'Qiqi'} has ${c.appearance}${c.customOutfit?'':', and wears '+c.outfit}.`).join(' ');
  positive=positive.replace(/^[,\s]+/,'').replace(/,\s*,/g,',').trimEnd();return{...panel,positive:positive+(notes?(/[.!?]$/.test(positive)?' ':'. ')+notes:'')};
 })};
}
