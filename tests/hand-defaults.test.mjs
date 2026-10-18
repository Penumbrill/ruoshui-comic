import test from 'node:test';import assert from 'node:assert/strict';
import {handAnatomyDefaults,migrateHandDefaults} from '../shared/hand-defaults.mjs';import{makeProfile}from'../server/profiles.mjs';
test('balanced hand repair defaults apply to both models and only untouched older settings migrate',()=>{
 for(const type of ['original','expanded'])for(const [key,value]of Object.entries(handAnatomyDefaults))assert.equal(makeProfile(type).hand[key],value);
 const old={cfg:8,denoise:.25,wildcard:'hands, feet',steps:37},custom={...old,cfg:5};
 const config={profiles:{original:{hand:old},expanded:{hand:custom}}};migrateHandDefaults(config);
 assert.deepEqual(config.profiles.original.hand,{...old,...handAnatomyDefaults,steps:37});assert.equal(custom.cfg,5);assert.equal(custom.denoise,.25);
 Object.assign(old,{cfg:8,denoise:.25,wildcard:'hands, feet'});migrateHandDefaults(config);assert.equal(old.cfg,8,'later deliberate edits must survive');
});
