import test from 'node:test';import assert from 'node:assert/strict';import {importableImages}from'../shared/image-import.mjs';
test('image upload and drop share supported-file filtering, including Windows files with no MIME type',()=>{
 const files=[{name:'图片.PNG',type:'image/png'},{name:'photo.JPEG',type:''},{name:'cutout.webp',type:'image/webp'},{name:'document.txt',type:'text/plain'},{name:'fake.png',type:'application/x-msdownload'},{name:'vector.svg',type:'image/svg+xml'}];
 assert.deepEqual(importableImages(files),files.slice(0,3));assert.deepEqual(importableImages(null),[]);
});
