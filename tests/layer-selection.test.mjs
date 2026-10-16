import test from 'node:test';import assert from 'node:assert/strict';import {chooseLayerIds,contextLayerIds} from '../src/editor/layer-selection.js';
test('repeated selection clears, Ctrl toggles one layer, and right click preserves an existing multi-selection',()=>{
 assert.deepEqual(chooseLayerIds(['one'],'one'),[]);assert.deepEqual(chooseLayerIds(['one','two'],'two'),['two']);assert.deepEqual(chooseLayerIds(['one','two'],'two',{toggle:true}),['one']);assert.deepEqual(chooseLayerIds(['one'],'two',{toggle:true}),['one','two']);assert.deepEqual(contextLayerIds(['one','two'],'two'),['one','two']);assert.deepEqual(contextLayerIds(['one','two'],'three'),['three']);
});
test('linked dialogue groups can be selected and cleared as a group without duplicate IDs',()=>{
 assert.deepEqual(chooseLayerIds([],'one',{group:['one','two']}),['one','two']);assert.deepEqual(chooseLayerIds(['one','two'],'two',{group:['one','two']}),[]);assert.deepEqual(contextLayerIds(['three'],'two',['one','two']),['one','two']);
});
