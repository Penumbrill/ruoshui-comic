<script setup>
import {bubblePath,bubbleTail} from '../editor/decorations';
defineProps({object:Object});
</script>
<template><g :transform="`translate(${object.x||0} ${object.y||0})`"><path :d="bubblePath(object)" :fill="object.fill||'#fff'" :stroke="object.border||'#242633'" :stroke-width="object.borderWidth??3" :stroke-dasharray="object.shape==='whisper'?'9 7':undefined" stroke-linejoin="round"/><template v-if="object.shape==='cloud'&&object.tailEnabled!==false"><ellipse v-for="k in [1,2,3]" :cx="object.w/2+(bubbleTail(object).x-object.w/2)*(.65+k*.115)" :cy="object.h/2+(bubbleTail(object).y-object.h/2)*(.65+k*.115)" :rx="Math.min(object.w,object.h)*(.115-k*.025)" :ry="Math.min(object.w,object.h)*(.09-k*.02)" :fill="object.fill||'#fff'" :stroke="object.border||'#242633'" :stroke-width="object.borderWidth??3"/></template></g></template>
