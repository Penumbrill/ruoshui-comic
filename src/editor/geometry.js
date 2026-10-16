export function rectPoints(x,y,w,h){return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];}
export function bounds(points){const xs=points.map(p=>p.x),ys=points.map(p=>p.y);const x=Math.min(...xs),y=Math.min(...ys);return{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};}
export function polygonWithSides(points,sides){
 const count=Math.max(3,Math.min(32,Math.round(Number(sides)||4))),box=bounds(points);
 if(count===points.length)return points.map(p=>({...p}));
 if(count===4)return rectPoints(box.x,box.y,box.w,box.h);
 const unit=Array.from({length:count},(_,i)=>{const angle=-Math.PI/2+i*2*Math.PI/count;return {x:Math.cos(angle),y:Math.sin(angle)};}),extent=bounds(unit);
 return unit.map(p=>({x:box.x+(p.x-extent.x)/extent.w*box.w,y:box.y+(p.y-extent.y)/extent.h*box.h}));
}
export function scaleFromCorner(points,index,target){
 const corner=points[index];let opposite=(index+2)%points.length;
 if(points.length!==4){let distance=-1;points.forEach((p,i)=>{const d=(p.x-corner.x)**2+(p.y-corner.y)**2;if(d>distance){distance=d;opposite=i;}});}
 const anchor=points[opposite],dx=corner.x-anchor.x,dy=corner.y-anchor.y,denominator=dx*dx+dy*dy;
 const scale=denominator?Math.max(.05,((target.x-anchor.x)*dx+(target.y-anchor.y)*dy)/denominator):1;
 return points.map(p=>({x:anchor.x+(p.x-anchor.x)*scale,y:anchor.y+(p.y-anchor.y)*scale}));
}
export function splitPolygon(points,a,b){
 const cross=p=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
 const clip=sign=>{const out=[];for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length],dp=cross(p)*sign,dq=cross(q)*sign;if(dp>=-0.01)out.push({...p});if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);out.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y)});}}return out;};
 const first=clip(1),second=clip(-1);if(first.length<3||second.length<3)return null;return[first,second];
}
export function templatePanels(name,width,height,gap=22,margin=45){
 const w=width-margin*2,h=height-margin*2;
 const templates={four:[[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]],six:[[0,0,.5,1/3],[.5,0,.5,1/3],[0,1/3,.5,1/3],[.5,1/3,.5,1/3],[0,2/3,.5,1/3],[.5,2/3,.5,1/3]],story:[[0,0,1,.25],[0,.25,.5,.5],[.5,.25,.5,.5],[0,.75,1,.25]],strip:[[0,0,1,1/3],[0,1/3,1,1/3],[0,2/3,1,1/3]],hero:[[0,0,1,.6],[0,.6,.5,.4],[.5,.6,.5,.4]],single:[[0,0,1,1]]};
 return (templates[name]||templates.four).map(([x,y,pw,ph])=>rectPoints(margin+x*w+gap/2,margin+y*h+gap/2,pw*w-gap,ph*h-gap));
}
