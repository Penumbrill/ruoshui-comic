const legacyPositive = 'masterpiece, best quality, anime illustration, a traveler walking through a quiet town, detailed background, soft lighting';
const legacyNegative = 'worst quality, low quality, blurry, bad anatomy, extra limbs, text, watermark';

export const promptExamples = Object.freeze({
  positive: 'Example: masterpiece, best quality, anime illustration, traveler, walking, quiet town, detailed background, soft lighting',
  negative: 'Example: worst quality, low quality, blurry, bad anatomy, extra limbs, extra fingers, extra toes, fused fingers, fused toes, text, watermark',
});

// Only retire the untouched starter pair. Saved artwork and edited prompts stay intact.
export function migratePromptExamples(config) {
  if (config.promptExamplesVersion >= 1) return config;
  const normalize = value => String(value || '').trim().replace(/[,，]\s*$/, '').trim();
  for (const profile of Object.values(config.profiles || {})) {
    if (normalize(profile.positive) === legacyPositive && normalize(profile.negative) === legacyNegative) {
      profile.positive = '';
      profile.negative = '';
    }
  }
  config.promptExamplesVersion = 1;
  return config;
}
