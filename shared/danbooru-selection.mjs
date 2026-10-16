// Map the original node's finished outputs into the existing prompt UI.
// Filtering, multi-selection and fusion have already run inside upstream browse.
const tags=text=>String(text||'').replace(/=== 图\d+ ===/g,'').split(/, |\n/).map(t=>t.trim()).filter(Boolean);
export function pluginSelectionPost(post,outputs,{id=post.id,multiple=false}={}){
 const categories={};for(const [key,section]of Object.entries({quality_meta:'quality',count:'count',character:'character',series:'series',artist:'artist'}))for(const tag of tags(outputs[key]))categories[tag]=section;
 return{...post,id,tag_string:[...new Set(tags(outputs.all))].join(' '),tag_string_artist:tags(outputs.artist).join(' '),tag_string_character:tags(outputs.character).join(' '),tag_string_copyright:tags(outputs.series).join(' '),tag_string_meta:tags(outputs.quality_meta).join(' '),pluginCategories:categories,pluginOutputs:outputs,pluginMultiple:multiple};
}
