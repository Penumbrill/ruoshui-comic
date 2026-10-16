export function resizePage(page,width,height,{keepRatio=false,scaleContents=false,changed='width'}={}){
 const oldW=page.width,oldH=page.height;
 width=Math.max(256,Math.min(8192,Math.round(width)));height=Math.max(256,Math.min(8192,Math.round(height)));
 if(keepRatio){if(changed==='width')height=Math.round(width*oldH/oldW);else width=Math.round(height*oldW/oldH);if(width>8192||height>8192||width<256||height<256)return false;}
 if(scaleContents){const sx=width/oldW,sy=height/oldH,average=Math.sqrt(sx*sy);for(const o of page.objects){if(o.points)o.points=o.points.map(p=>({x:p.x*sx,y:p.y*sy}));for(const key of ['x','w','imageX','cutoutBaseW'])if(Number.isFinite(o[key]))o[key]*=sx;for(const key of ['y','h','imageY','cutoutBaseH'])if(Number.isFinite(o[key]))o[key]*=sy;for(const key of ['fontSize','width','borderWidth'])if(Number.isFinite(o[key]))o[key]*=average;}}
 page.width=width;page.height=height;return true;
}
export function bubbleBridge(a,b,strength=.55){
 const ac={x:a.x+a.w/2,y:a.y+a.h/2},bc={x:b.x+b.w/2,y:b.y+b.h/2},angle=Math.atan2(bc.y-ac.y,bc.x-ac.x),distance=Math.hypot(bc.x-ac.x,bc.y-ac.y);
 if(distance<1)return '';const spread=.18+Math.max(0,Math.min(1,strength))*.75;
 const edge=(o,theta)=>{const c=Math.cos(theta),s=Math.sin(theta),r=1/Math.sqrt(c*c/(o.w/2)**2+s*s/(o.h/2)**2);return{x:o.x+o.w/2+c*r,y:o.y+o.h/2+s*r};};
 const p=edge(a,angle-spread),q=edge(b,angle+Math.PI+spread),r=edge(b,angle+Math.PI-spread),t=edge(a,angle+spread),topGap=(q.x-p.x)*Math.cos(angle)+(q.y-p.y)*Math.sin(angle),bottomGap=(r.x-t.x)*Math.cos(angle)+(r.y-t.y)*Math.sin(angle),bend=Math.max(0,Math.min(distance*(.35+(1-strength)*.1),Math.max(0,topGap)*.4,Math.max(0,bottomGap)*.4)),dx=Math.cos(angle)*bend,dy=Math.sin(angle)*bend;
 return `M${p.x},${p.y} C${p.x+dx},${p.y+dy} ${q.x-dx},${q.y-dy} ${q.x},${q.y} L${r.x},${r.y} C${r.x-dx},${r.y-dy} ${t.x+dx},${t.y+dy} ${t.x},${t.y} Z`;
}
