import {searchPredicate} from './search.mjs';
export function flattenTagLibrary(library){
 return library.groups.flatMap(category=>category.groups.flatMap(group=>group.tags.map(tag=>({id:tag.t_uuid||String(tag.id_index),en:tag.text??'',zh:tag.desc??'',category:category.name,categoryId:category.p_uuid,group:group.name,groupId:group.g_uuid,color:tag.color}))));
}
export function validateTagLibrary(library){
 if(library?.version!==1||!Array.isArray(library.groups))throw Error('标签词库格式无效');
 let groups=0,tags=0;const categories=new Set(),subgroups=new Set(),entries=new Set();
 for(const category of library.groups){if(typeof category.name!=='string'||!category.p_uuid||categories.has(category.p_uuid)||!Array.isArray(category.groups))throw Error('标签分类格式无效');categories.add(category.p_uuid);
  for(const group of category.groups){if(typeof group.name!=='string'||!group.g_uuid||subgroups.has(group.g_uuid)||!Array.isArray(group.tags))throw Error('标签分组格式无效');subgroups.add(group.g_uuid);groups++;
   for(const tag of group.tags){const id=tag.t_uuid||String(tag.id_index);if(entries.has(id)||typeof tag.text!=='string'||(tag.desc!==null&&typeof tag.desc!=='string'))throw Error('标签记录格式无效');entries.add(id);tags++;}
  }
 }
 if(library.counts?.categories!==categories.size||library.counts.groups!==groups||library.counts.tags!==tags)throw Error('词库数量不一致，同步未完成');
 if(tags>100000||groups>5000||categories.size>1000)throw Error('词库过大，请分批导入');
 return library;
}
export function libraryFromGroups(groups){const library={version:1,groups,counts:{categories:groups.length,groups:groups.reduce((n,c)=>n+c.groups.length,0),tags:groups.reduce((n,c)=>n+c.groups.reduce((sum,g)=>sum+g.tags.length,0),0)}};return validateTagLibrary(library);}
export function mergeTagLibraries(existing,incoming){
 const groups=structuredClone(existing.groups);
 for(const category of incoming.groups){let target=groups.find(g=>g.p_uuid===category.p_uuid);if(!target){groups.push(structuredClone(category));continue;}const children=target.groups;Object.assign(target,structuredClone(category),{groups:children});
  for(const group of category.groups){let child=children.find(g=>g.g_uuid===group.g_uuid);if(!child){children.push(structuredClone(group));continue;}const tags=child.tags;Object.assign(child,structuredClone(group),{tags});for(const tag of group.tags){const index=tags.findIndex(t=>t.t_uuid===tag.t_uuid);if(index<0)tags.push(structuredClone(tag));else tags[index]=structuredClone(tag);}}
 }
 return libraryFromGroups(groups);
}
const sqlText=value=>value===null||value===undefined?'NULL':typeof value==='number'&&Number.isFinite(value)?String(value):"'"+String(value).replaceAll("'","''")+"'";
export function tagLibrarySQL(library){
 const rows=['-- Complete tag library: categories, groups and every tag.'];
 const insert=(table,columns,record)=>rows.push(`INSERT OR REPLACE INTO "${table}" (${columns.map(c=>'"'+c+'"').join(',')}) VALUES (${columns.map(c=>sqlText(record[c])).join(',')});`);
 for(const category of library.groups){insert('tag_groups',['name','color','create_time','p_uuid'],category);for(const group of category.groups){insert('tag_subgroups',['name','color','create_time','p_uuid','g_uuid'],{...group,p_uuid:category.p_uuid});for(const tag of group.tags)insert('tag_tags',['text','desc','color','create_time','g_uuid','t_uuid'],{...tag,g_uuid:group.g_uuid});}}
 return rows.join('\n')+'\n';
}
export function filterLibraryTags(tags,{category='all',group='all',search='',favorites=[]}={}){
 const match=searchPredicate(search),starred=new Set(favorites);
 return tags.filter(tag=>(category==='all'||(category==='favorites'?starred.has(tag.en):tag.categoryId===category))&&(group==='all'||tag.groupId===group)&&match(tag.en,tag.zh,tag.category,tag.group));
}
