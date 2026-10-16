import test from 'node:test';import assert from 'node:assert/strict';
import {contentRatingPreference} from '../assets/danbooru-browser/content-controls.js';
test('hidden adult controls clear individually selected hidden ratings while all retains its original behavior',()=>{
 for(let mask=0;mask<16;mask++){const ratings=['general','sensitive','questionable','explicit'].filter((_,i)=>mask&(1<<i));for(const all of [true,false]){const original=JSON.stringify({all,ratings});assert.equal(contentRatingPreference(original,true),original);if(all){assert.equal(contentRatingPreference(original),original);continue;}const safe=JSON.parse(contentRatingPreference(original));assert.equal(safe.all,false);assert(safe.ratings.length);assert(safe.ratings.every(r=>['general','sensitive'].includes(r)));}}
 assert.deepEqual(JSON.parse(contentRatingPreference('invalid')),{all:false,ratings:['general']});
});
