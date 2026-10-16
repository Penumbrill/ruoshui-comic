import test from 'node:test';import assert from 'node:assert/strict';import {defaultLlmRepository,recommendedLlmFile} from '../shared/llm-recommendation.mjs';
test('the direct assistant download selects the requested main model, never a projector or draft model',()=>{
 assert.equal(defaultLlmRepository,'HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF');const selected={name:'Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf'};
 assert.equal(recommendedLlmFile([{name:'mmproj-Q4_K_P.gguf'},{name:'fastmtp-Q4_K_P.gguf'},{name:'main-IQ4_XS.gguf'},selected]),selected);assert.equal(recommendedLlmFile([{name:'mmproj-BF16.gguf'}]),null);
});
