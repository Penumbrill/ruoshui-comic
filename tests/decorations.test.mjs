import test from 'node:test';import assert from 'node:assert/strict';
import {resizeDecoration,bubblePath,bubbleTail,editTail,stickerPresets} from '../src/editor/decorations.js';
function rotate(p,o){const a=(o.rotation||0)*Math.PI/180,cx=o.x+o.w/2,cy=o.y+o.h/2;return{x:cx+(p.x-cx)*Math.cos(a)-(p.y-cy)*Math.sin(a),y:cy+(p.x-cx)*Math.sin(a)+(p.y-cy)*Math.cos(a)};}
test('rotated decoration resize preserves the opposite world corner and Shift aspect ratio',()=>{
 const o={x:100,y:150,w:320,h:160,rotation:35},anchor=rotate({x:o.x,y:o.y},o),target=rotate({x:o.x+640,y:o.y+320},o),result={...o,...resizeDecoration(o,2,target,true)},after=rotate({x:result.x,y:result.y},result);
 assert(Math.abs(result.w/result.h-2)<1e-8);assert(Math.hypot(after.x-anchor.x,after.y-anchor.y)<1e-8);assert(Math.abs(result.w-640)<1e-8);
});
test('bubble tails support all directions and dragging a rotated tail round-trips its angle',()=>{
 for(const shape of ['ellipse','round','rect','cloud','burst','whisper'])for(const angle of [0,45,90,135,180,225,270,315]){const o={x:10,y:20,w:300,h:180,shape,tailAngle:angle,tailLength:.6,rotation:20};assert(!/NaN|Infinity/.test(bubblePath(o)));const tip=bubbleTail(o),world=rotate({x:o.x+tip.x,y:o.y+tip.y},o),edited=editTail(o,world);assert.equal(edited.tailAngle,angle);assert(Math.abs(edited.tailLength-.6)<1e-8);}
 assert(stickerPresets.length>=40);assert.equal(new Set(stickerPresets.map(p=>p.id)).size,stickerPresets.length);
});
