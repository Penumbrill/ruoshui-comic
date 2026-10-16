function rotate(point,cx,cy,degrees){const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),x=point.x-cx,y=point.y-cy;return {x:cx+x*c-y*s,y:cy+x*s+y*c};}

export function outsideMaskPoints(layer,panel){
 const xs=panel.points.map(p=>p.x),ys=panel.points.map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
 return panel.points.map(point=>rotate(rotate(point,cx,cy,panel.rotation||0),layer.x+layer.w/2,layer.y+layer.h/2,-(layer.rotation||0)));
}
