import test from 'node:test';
import assert from 'node:assert/strict';
import {splitTags,formatPrompt,appendPrompt,adjustWeight,uniquePrompt} from '../src/editor/prompts.js';
import {bounds,rectPoints,scaleFromCorner} from '../src/editor/geometry.js';
test('prompt punctuation uses one comma and space with a trailing separator',()=>{
 assert.equal(formatPrompt('masterpiece,best quality， blue hair,, '),'masterpiece, best quality, blue hair, ');
 assert.equal(appendPrompt('masterpiece, ','black hair'),'masterpiece, black hair, ');
 assert.equal(formatPrompt('a,b\nc,d'),'a, b, \nc, d, ');
});
test('weighted groups, escaped commas and LoRA expressions remain intact',()=>{
 const text='(red hair, blue eyes:1.2), tag\\,withcomma, <wlr:character:0.8:1>';
 assert.deepEqual(splitTags(text),['(red hair, blue eyes:1.2)','tag\\,withcomma','<wlr:character:0.8:1>']);
 assert.equal(adjustWeight('(red hair, blue eyes:1.2)',.1),'(red hair, blue eyes:1.3)');
 assert.equal(uniquePrompt('a,A,b,'),'a, b, ');
});
test('Shift corner scaling preserves the rectangle and fixes the opposite corner',()=>{
 const original=rectPoints(10,20,200,100),scaled=scaleFromCorner(original,2,{x:410,y:220});
 const b=bounds(scaled);assert.equal(b.w,400);assert.equal(b.h,200);assert.deepEqual(scaled[0],original[0]);
 assert.equal(b.w/b.h,2);assert(scaled.every((point,index)=>point.x===scaled[(index+1)%4].x||point.y===scaled[(index+1)%4].y));
});
