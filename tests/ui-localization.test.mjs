import test from 'node:test';import assert from 'node:assert/strict';
import {english,translateUi} from '../shared/ui-text.mjs';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {hfConnectionHelp} from '../server/hf-network.mjs';
test('English interface copy covers settings, project actions, gallery and panel properties',()=>{
 for(const text of ['通用与界面','网络与代理连接','电脑环境与运行时','新建项目','打开项目文件夹','多选','回收区','刷新画廊','抠图图层组','自动对齐原图','取景 / 智能抠图 / 破框','Danbooru 标签浏览器','简体中文']){assert(english[text]);assert(!/[\u3400-\u9fff]/.test(translateUi(text)),text);}
 assert.equal(translateUi(53),53);assert.equal(translateUi('my_style.safetensors'),'my_style.safetensors');
 assert.equal(translateUi('my_custom_story_name'),'my_custom_story_name');
});
test('model connection errors have matching English messages',()=>{assert.match(translateUi(hfConnectionHelp),/network accelerator/);for(const text of [hfConnectionHelp,'模型仓库需要登录或访问许可，请在官网获取权限后导入本地模型。','模型仓库或文件不存在，请检查地址后重新查询。'])assert(!/[\u3400-\u9fff]/.test(translateUi(text)));});
test('embedded browser translates interface labels and later changes, preserving user content',async()=>{const source=await fs.readFile('assets/danbooru-browser/locale.js','utf8'),labels=JSON.parse(await fs.readFile('assets/danbooru-browser/locale-en.json','utf8'));assert.equal(labels['热门'],'Popular');let callback;const text=(data,protectedNode=false)=>({nodeType:3,data,parentElement:{closest:()=>protectedNode?{}:null}}),label=text('  普通  '),prompt=text('普通',true),post=text('普通',true),root={nodeType:1,childNodes:[label,prompt,post],closest:()=>null,hasAttribute:()=>false},dialogs=[];const window={alert:m=>dialogs.push(m),confirm:m=>dialogs.push(m),prompt:m=>dialogs.push(m)},context={location:{search:'?lang=en'},URLSearchParams,document:{body:root,documentElement:{},getElementById:()=>root},Node:{TEXT_NODE:3,ELEMENT_NODE:1},fetch:async()=>({json:async()=>labels}),MutationObserver:class{constructor(fn){callback=fn;}observe(){}},window};await vm.runInNewContext('(async()=>{'+source+'})()',context);assert.equal(label.data,'  General  ');assert.equal(prompt.data,'普通');assert.equal(post.data,'普通');assert.equal(context.document.documentElement.lang,'en');const added=text('就绪');callback([{type:'childList',addedNodes:[added]}]);assert.equal(added.data,'Ready');window.confirm('确认删除这张图片？');assert.deepEqual(dialogs,['Delete this image?']);context.location.search='?lang=zh';context.fetch=()=>{throw Error('Chinese UI must not fetch English labels');};await vm.runInNewContext('(async()=>{'+source+'})()',context);assert.equal(context.document.documentElement.lang,'zh');});
test('interface localization leaves comic artwork and prompt content untouched',async()=>{
 for(const file of ['ComicArtwork','BubbleShape','StickerShape'])assert(!(await fs.readFile('src/components/'+file+'.vue','utf8')).includes('useUiText'),file);
 const prompt=await fs.readFile('src/components/PromptField.vue','utf8');assert(!prompt.includes('{{ui(token)}}'));assert(!prompt.includes('{{ui(explanation(token))}}'));
 assert.equal(translateUi(' 张'),' images');
});
