import test from 'node:test';
import assert from 'node:assert/strict';
import {bounds,rectPoints,polygonWithSides,splitPolygon} from '../src/editor/geometry.js';

test('panel side count preserves bounds and produces convex polygons with distinct corners',()=>{
 const original=[{x:42,y:90},{x:600,y:50},{x:570,y:930},{x:70,y:900}],box=bounds(original);
 for(const count of [3,5,6,8,12,32]){
  const points=polygonWithSides(original,count);
  assert.equal(points.length,count);
  for(const key of ['x','y','w','h'])assert.ok(Math.abs(bounds(points)[key]-box[key])<1e-9);
  for(let i=0;i<count;i++){
   const a=points[i],b=points[(i+1)%count],c=points[(i+2)%count];
   assert.ok((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)>0);
  }
  const halves=splitPolygon(points,{x:box.x-10,y:box.y+box.h/2},{x:box.x+box.w+10,y:box.y+box.h/2});
  assert.equal(halves.length,2);
 }
 assert.deepEqual(original,[{x:42,y:90},{x:600,y:50},{x:570,y:930},{x:70,y:900}]);
});

test('unchanged count preserves hand edited vertices and conversion back to four sides is rectangular',()=>{
 const original=rectPoints(20,30,400,500),pentagon=polygonWithSides(original,5);
 pentagon[0].x+=10;
 assert.deepEqual(polygonWithSides(pentagon,5),pentagon);
 assert.notEqual(polygonWithSides(pentagon,5)[0],pentagon[0]);
 assert.deepEqual(polygonWithSides(pentagon,4),original);
 assert.equal(polygonWithSides(original,99).length,32);
 assert.equal(polygonWithSides(original,1).length,3);
});
