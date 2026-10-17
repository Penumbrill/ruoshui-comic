import test from 'node:test';
import assert from 'node:assert/strict';
import {migratePromptExamples} from '../shared/prompt-examples.mjs';

const starter = () => ({
  positive: 'masterpiece, best quality, anime illustration, a traveler walking through a quiet town, detailed background, soft lighting, ',
  negative: 'worst quality, low quality, blurry, bad anatomy, extra limbs, text, watermark, ',
  inpaint: {positive: 'saved source prompt', negative: 'saved source exclusions'},
});

test('retiring starter text keeps inpaint source prompts and later deliberate edits', () => {
  const config = {profiles: {original: starter(), expanded: starter()}};
  migratePromptExamples(config);
  for (const profile of Object.values(config.profiles)) {
    assert.equal(profile.positive, '');
    assert.equal(profile.negative, '');
    assert.equal(profile.inpaint.positive, 'saved source prompt');
    assert.equal(profile.inpaint.negative, 'saved source exclusions');
  }
  Object.assign(config.profiles.original, starter());
  migratePromptExamples(config);
  assert.equal(config.profiles.original.positive, starter().positive);
});

test('edited prompts survive migration even when one field still matches the starter', () => {
  const config = {profiles: {
    original: {...starter(), positive: 'my character, forest'},
    expanded: {...starter(), negative: 'my exclusions'},
  }};
  const before = structuredClone(config.profiles);
  migratePromptExamples(config);
  assert.deepEqual(config.profiles, before);
});
