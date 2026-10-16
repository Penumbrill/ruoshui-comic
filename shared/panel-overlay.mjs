// Inverse of the editor's image cover, pan and rotation, expressed in source pixels.
export function panelOverlayMatrix(panel,width,height){
 if(!width||!height||!panel?.points?.length)return null;
 const xs=panel.points.map(p=>p.x),ys=panel.points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y,cx=x+w/2,cy=y+h/2;
 const scale=Math.max(w/width,h/height)*(panel.imageScale||1),r=-(panel.rotation||0)*Math.PI/180,t=-(panel.imageRotation||0)*Math.PI/180;
 const a=Math.cos(r+t)/scale,b=Math.sin(r+t)/scale,c=-b,d=a;
 const dx=panel.imageX||0,dy=panel.imageY||0;
 return {a,b,c,d,e:width/2-a*cx-c*cy-dx/scale,f:height/2-b*cx-d*cy-dy/scale};
}
export function panelOverlayPage(page,panel){
 const xs=panel.points.map(p=>p.x),ys=panel.points.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
 const objects=page.objects.filter(o=>o.id===panel.id||o.cutout&&o.sourcePanelId===panel.id||o.kind!=='panel'&&!o.cutout&&((o.x||0)+(o.w||0)>=left&&(o.x||0)<=right&&(o.y||0)+(o.h||0)>=top&&(o.y||0)<=bottom)).map(o=>o.id===panel.id?{...o,image:null,fill:'transparent'}:o);
 return {...page,backgroundImage:null,objects};
}
