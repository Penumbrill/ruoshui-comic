import test from 'node:test';import assert from 'node:assert/strict';
import {english,translateUi} from '../shared/ui-text.mjs';
import fs from 'node:fs/promises';
test('English interface copy covers settings, project actions, gallery and panel properties',()=>{
 for(const text of ['通用与界面','网络与代理连接','电脑环境与运行时','新建项目','打开项目文件夹','多选','回收区','刷新画廊','抠图图层组','自动对齐原图','取景 / 智能抠图 / 破框','Danbooru 标签浏览器','简体中文']){assert(english[text]);assert(!/[\u3400-\u9fff]/.test(translateUi(text)),text);}
 assert.equal(translateUi(53),53);assert.equal(translateUi('my_style.safetensors'),'my_style.safetensors');
 assert.equal(translateUi('my_custom_story_name'),'my_custom_story_name');
});
test('interface localization leaves comic artwork and prompt content untouched',async()=>{
 for(const file of ['ComicArtwork','BubbleShape','StickerShape'])assert(!(await fs.readFile('src/components/'+file+'.vue','utf8')).includes('useUiText'),file);
 const prompt=await fs.readFile('src/components/PromptField.vue','utf8');assert(!prompt.includes('{{ui(token)}}'));assert(!prompt.includes('{{ui(explanation(token))}}'));
 assert.equal(translateUi(' 张'),' images');
});
