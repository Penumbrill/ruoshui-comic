import test from 'node:test';import assert from 'node:assert/strict';
import {previewSelections,previewMode} from '../shared/preview-selection.mjs';
test('legacy preview belongs to its generation workspace only',()=>{
 const gallery=[{id:'a',generationMode:'generate'},{id:'b',generationMode:'inpaint',sourceImageId:'a'}];
 assert.deepEqual(previewSelections({lastImageId:'b'},gallery),{generate:null,inpaint:gallery[1]});
 assert.deepEqual(previewSelections({previewImageIds:{generate:'a',inpaint:'b'}},gallery),{generate:gallery[0],inpaint:gallery[1]});
 assert.equal(previewMode(gallery[1]),'inpaint');assert.equal(previewMode({sourceImageId:'a'}),'inpaint');
 assert.deepEqual(previewSelections({previewImageIds:{generate:'missing',inpaint:null},lastImageId:'b'},gallery),{generate:null,inpaint:null});
});
