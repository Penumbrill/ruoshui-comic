export function comicClarity(params,enabled=true){
 if(!enabled)return params;
 const sentence='Keep foreground characters and objects sharply focused with clean readable edges.';
 const positive=params.positive.replaceAll(sentence,'').split(/,|deep focus\./i).map(s=>s.trim()).filter(s=>s&&! /^(?:bokeh|shallow depth of field|depth of field|blurred foreground|blurry foreground|soft focus|soft focus foreground)$/i.test(s));
 const unique=items=>[...new Map(items.map(item=>[item.toLowerCase(),item])).values()];
 return{...params,positive:unique([...positive,'crisp lineart','deep focus']).join(', ')+'. '+sentence,negative:unique([...(params.negative||'').split(',').map(s=>s.trim()).filter(Boolean),'blurry foreground','out of focus subject','low detail']).join(', '),comicClarity:true};
}
