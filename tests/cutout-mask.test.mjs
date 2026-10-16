import test from 'node:test';import assert from 'node:assert/strict';
import {outsideMaskPoints} from '../shared/cutout-mask.mjs';
function rotate(p,cx,cy,a){a*=Math.PI/180;return{x:cx+(p.x-cx)*Math.cos(a)-(p.y-cy)*Math.sin(a),y:cy+(p.x-cx)*Math.sin(a)+(p.y-cy)*Math.cos(a)};}
test('the outside mask stays on the panel edge after independent panel and cutout rotations',()=>{
 const points=[{x:40,y:30},{x:160,y:10},{x:190,y:120},{x:90,y:180},{x:10,y:100}],panel={points,rotation:27},layer={x:25,y:5,w:220,h:230,rotation:-19};
 const result=outsideMaskPoints(layer,panel);
 for(let i=0;i<points.length;i++){
  const actual=rotate(result[i],135,120,layer.rotation),expected=rotate(points[i],100,95,panel.rotation);
  assert(Math.abs(actual.x-expected.x)<1e-9);assert(Math.abs(actual.y-expected.y)<1e-9);
 }
 assert.deepEqual(outsideMaskPoints({...layer,rotation:0},{points,rotation:0}),points);
});
