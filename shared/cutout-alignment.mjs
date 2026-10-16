export function alignedCutout(layer,panel){
 if(!panel?.points?.length)return null;const xs=panel.points.map(p=>p.x),ys=panel.points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),bw=Math.max(...xs)-x,bh=Math.max(...ys)-y;
 const ratio=(layer.sourceWidth&&layer.sourceHeight?layer.sourceWidth/layer.sourceHeight:layer.cutoutBaseW&&layer.cutoutBaseH?layer.cutoutBaseW/layer.cutoutBaseH:layer.w/layer.h)||1;
 const w=Math.max(bw,bh*ratio)*(panel.imageScale||1),h=w/ratio,rotation=(panel.rotation||0)+(panel.imageRotation||0),a=rotation*Math.PI/180,dx=panel.imageX||0,dy=panel.imageY||0;
 return{x:x+bw/2+dx*Math.cos(a)-dy*Math.sin(a)-w/2,y:y+bh/2+dx*Math.sin(a)+dy*Math.cos(a)-h/2,w,h,rotation,cutoutBaseW:w,cutoutBaseH:h};
}
