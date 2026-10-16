import test from 'node:test';import assert from 'node:assert/strict';import {applyAssistantQuality,qualityStory,qualityInstruction} from '../shared/assistant-quality.mjs';
test('assistant default and custom quality prefixes share one rule without losing scene text',()=>{
 const prompt='masterpiece, best quality, score_7, safe, 2girls, red coat, A girl holds a cup.';
 assert.equal(applyAssistantQuality(prompt,{},'expanded'),'masterpiece, best quality, 2girls, red coat, A girl holds a cup.');
 assert.equal(applyAssistantQuality(prompt,{useDefaultQuality:false,customQuality:'highres, very aesthetic'}),'highres, very aesthetic, 2girls, red coat, A girl holds a cup.');
 assert.equal(applyAssistantQuality(prompt,{useDefaultQuality:false,customQuality:''}),'2girls, red coat, A girl holds a cup.');
 assert.equal(applyAssistantQuality('(masterpiece:1.2), 1girl, (red coat:1.1)',{useDefaultQuality:false}),'1girl, (red coat:1.1)');
});
test('changing custom quality or switching back to defaults removes the previous managed prefix',()=>{
 const initial={title:'test',panels:[{positive:'masterpiece, 1girl, red coat'}]},one=qualityStory(initial,{useDefaultQuality:false,customQuality:'intricate illustration'}),two=qualityStory(one,{useDefaultQuality:false,customQuality:'highres'}),reset=qualityStory(two,{});
 assert.equal(two.panels[0].positive,'highres, 1girl, red coat');assert.equal(reset.panels[0].positive,'masterpiece, best quality, score_7, safe, 1girl, red coat');assert.match(qualityInstruction({useDefaultQuality:false},'original'),/Do not add any quality/);
});
