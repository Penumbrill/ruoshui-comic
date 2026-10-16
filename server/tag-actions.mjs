import crypto from 'node:crypto';
import {libraryFromGroups} from '../shared/tag-library.mjs';
const name=value=>{if(typeof value!=='string'||!value.trim()||value.length>200)throw Error('请输入不超过 200 字的名称');return value.trim();};
const color=value=>{if(typeof value!=='string'||value.length>100||!/^#[a-f\d]{3,8}$|^rgba?\([\d.,\s%]+\)$/i.test(value))throw Error('颜色格式无效');return value;};
export function applyTagAction(library,request){
 const groups=structuredClone(library.groups),[kind,operation]=String(request.action).split('.'),findCategory=id=>groups.find(c=>c.p_uuid===id),allGroups=()=>groups.flatMap(c=>c.groups),findGroup=id=>allGroups().find(g=>g.g_uuid===id);
 const locate=id=>{for(const category of groups)for(const group of category.groups){const index=group.tags.findIndex(t=>t.t_uuid===id);if(index>=0)return{category,group,index,tag:group.tags[index]};}};
 const category=findCategory(request.categoryId),group=findGroup(request.groupId),now=Date.now();
 if(kind==='category'){
  const target=findCategory(request.id);
  if(operation==='add')groups.push({name:name(request.name),color:color(request.color),p_uuid:crypto.randomUUID(),create_time:now,groups:[]});
  else{if(!target)throw Error('分类已变动，请刷新后重试');if(operation==='edit')Object.assign(target,{name:name(request.name),color:color(request.color)});else if(operation==='delete')groups.splice(groups.indexOf(target),1);else if(operation==='move'){const offset=Number(request.offset);if(![-1,1].includes(offset))throw Error('排序方向无效');const index=groups.indexOf(target),to=index+offset;if(to<0||to>=groups.length)throw Error('已经在分类边界');[groups[index],groups[to]]=[groups[to],groups[index]];}else throw Error('未知分类操作');}
 }else if(kind==='group'){
  const target=findGroup(request.id),parent=target&&groups.find(c=>c.groups.includes(target));
  if(operation==='add'){if(!category)throw Error('请先选择分类');category.groups.push({name:name(request.name),color:color(request.color),g_uuid:crypto.randomUUID(),p_uuid:category.p_uuid,create_time:now,tags:[]});}
  else{if(!target)throw Error('分组已变动，请刷新后重试');if(operation==='edit')Object.assign(target,{name:name(request.name),color:color(request.color)});else if(operation==='delete')parent.groups.splice(parent.groups.indexOf(target),1);else if(operation==='move'){const offset=Number(request.offset);if(![-1,1].includes(offset))throw Error('排序方向无效');const index=parent.groups.indexOf(target),to=index+offset;if(to<0||to>=parent.groups.length)throw Error('已经在分组边界');[parent.groups[index],parent.groups[to]]=[parent.groups[to],parent.groups[index]];}else throw Error('未知分组操作');}
 }else if(kind==='tag'){
  if(operation==='deleteMany'){
   if(!Array.isArray(request.ids)||!request.ids.length||request.ids.length>10000||request.ids.some(id=>typeof id!=='string'||!locate(id)))throw Error('所选标签已变动，请刷新后重试');
   const ids=new Set(request.ids);for(const child of allGroups())child.tags=child.tags.filter(t=>!ids.has(t.t_uuid));
  }else if(operation==='add'){
   if(!group)throw Error('请先选择标签分组');if(typeof request.text!=='string'||!request.text.trim()||request.text.length>2000||typeof request.desc!=='string'||request.desc.length>2000)throw Error('请输入有效的标签和中文说明');group.tags.unshift({text:request.text.trim(),desc:request.desc,color:color(request.color),t_uuid:crypto.randomUUID(),g_uuid:group.g_uuid,create_time:now});
  }else{
   const found=locate(request.id);if(!found)throw Error('标签已变动，请刷新后重试');
   if(operation==='delete')found.group.tags.splice(found.index,1);
   else if(operation==='edit'){if(typeof request.text!=='string'||!request.text.trim()||request.text.length>2000||typeof request.desc!=='string'||request.desc.length>2000)throw Error('请输入有效的标签和中文说明');Object.assign(found.tag,{text:request.text.trim(),desc:request.desc,color:color(request.color)});}
   else if(operation==='move'){
    const destination=group||found.group;if(request.groupId&&!group)throw Error('目标分组不存在');if(!['before','after','start','end'].includes(request.position))throw Error('移动位置无效');
    let reference;if(['before','after'].includes(request.position)){reference=destination.tags.find(t=>t.t_uuid===request.referenceId);if(!reference||reference===found.tag)throw Error('请选择其他参考标签');}
    found.group.tags.splice(found.index,1);let index=request.position==='start'?0:destination.tags.length;if(reference)index=destination.tags.indexOf(reference)+(request.position==='after'?1:0);found.tag.g_uuid=destination.g_uuid;destination.tags.splice(index,0,found.tag);
   }else throw Error('未知标签操作');
  }
 }else throw Error('未知词库操作');
 // Weilin uses create_time as the sort key. Reindexing records the explicit
 // user order without relying on clocks or changing identifiers.
 groups.forEach((category,i)=>{category.create_time=i+1;category.groups.forEach((group,j)=>{group.create_time=j+1;group.p_uuid=category.p_uuid;group.tags.forEach((tag,k)=>{tag.create_time=group.tags.length-k;tag.g_uuid=group.g_uuid;});});});
 return libraryFromGroups(groups);
}
export function selectTagSubset(library,ids){
 if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(id=>typeof id!=='string'))throw Error('请选择需要分享的标签');const requested=new Set(ids),found=new Set();
 const groups=library.groups.map(category=>({...category,groups:category.groups.map(group=>({...group,tags:group.tags.filter(tag=>{if(!requested.has(tag.t_uuid))return false;found.add(tag.t_uuid);return true;})})).filter(group=>group.tags.length)})).filter(category=>category.groups.length);
 if(found.size!==requested.size)throw Error('部分标签已变动，请刷新后重新选择');return libraryFromGroups(groups);
}
