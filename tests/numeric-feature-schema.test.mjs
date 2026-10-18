import test from 'node:test';
import assert from 'node:assert/strict';
import {featureNumberStep} from '../shared/numeric-wheel.mjs';

test('pixel dimensions and numeric counts keep unit increments even when the engine declares FLOAT',()=>{
 for(const key of ['guide_size','max_size','tile_width','tile_height','seam_fix_width','feather','noise_mask_feather','mask_blur','steps','cycle','batch_size']){
  for(const schema of [undefined,'INT','FLOAT'])assert.equal(featureNumberStep(key,schema),1,`${key}: ${schema}`);
 }
 for(const key of ['cfg','denoise','upscale_by','bbox_threshold','bbox_crop_factor','sam_mask_hint_threshold','seam_fix_denoise'])assert.equal(featureNumberStep(key,'FLOAT'),.1,key);
});
