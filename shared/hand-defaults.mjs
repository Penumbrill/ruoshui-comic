export const handAnatomyDefaults=Object.freeze({cfg:4.2,denoise:.35,guide_size:768,steps:32,feather:8,noise_mask_feather:8,detector_crop_factor:2,detector_dilation:8,wildcard:'natural hands, anatomically correct hands, five fingers per hand, correct finger joints'});
// Upgrade only the untouched previous defaults, leaving custom repair values
// and the exact parameters recorded with existing artwork intact.
export function migrateHandDefaults(config){
 if(config.handDefaultsVersion>=1)return config;
 for(const profile of Object.values(config.profiles||{})){
  const hand=profile.hand;
  if(hand?.cfg===8&&hand.denoise===.25&&hand.wildcard==='hands, feet'){const previous={cfg:8,denoise:.25,guide_size:576,steps:28,feather:20,noise_mask_feather:20,detector_crop_factor:3,detector_dilation:0,wildcard:'hands, feet'};for(const [key,value]of Object.entries(handAnatomyDefaults))if(hand[key]===undefined||hand[key]===previous[key])hand[key]=value;}
 }
 config.handDefaultsVersion=1;return config;
}
