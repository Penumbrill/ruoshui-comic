export function contentRatingPreference(value,allowAdult=false){
 if(allowAdult)return value;
 let state;try{state=JSON.parse(value||'{}');}catch{state={};}
 if(state.all)return value;
 const ratings=Array.isArray(state.ratings)?state.ratings.filter(r=>['general','sensitive'].includes(r)):[];
 return JSON.stringify({all:false,ratings:ratings.length?[...new Set(ratings)]:['general']});
}
export function adaptContentControls(allowAdult){
 const pairs=[...document.querySelectorAll('.db-rating-pair')],checks=pairs.map(pair=>pair.querySelector('input'));
 if(checks.length!==5)return;
 for(const pair of pairs.slice(3))pair.hidden=!allowAdult;
 // Visibility is a host preference; every original checkbox, including "all",
 // retains the upstream behavior. Never disable or replace those handlers.
 for(const checkbox of checks)checkbox.disabled=false;
}
