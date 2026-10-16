export function resizePanelPair(sizes,index,delta,minimums=[]){
 const result=[...sizes],sum=result[index]+result[index+1],a=Math.max(48,minimums[index]||100),b=Math.max(48,minimums[index+1]||100),scale=Math.min(1,sum/(a+b));
 const value=Math.max(a*scale,Math.min(sum-b*scale,result[index]+delta));result[index]=value;result[index+1]=sum-value;return result;
}
export function fitPanelSizes(sizes,total,minimums=[]){
 const sum=sizes.reduce((a,b)=>a+b,0);if(!sum||total<=0)return sizes;
 const min=sizes.map((_,i)=>Math.max(48,minimums[i]||100)),minSum=min.reduce((a,b)=>a+b,0),factor=Math.min(1,total/(minSum||total));
 const floor=sizes.map((_,i)=>(min[i]||48)*factor),remaining=Math.max(0,total-floor.reduce((a,b)=>a+b,0)),weights=sizes.map((n,i)=>Math.max(0,n-floor[i])),weightSum=weights.reduce((a,b)=>a+b,0);
 return sizes.map((_,i)=>floor[i]+remaining*(weightSum?weights[i]/weightSum:1/sizes.length));
}
