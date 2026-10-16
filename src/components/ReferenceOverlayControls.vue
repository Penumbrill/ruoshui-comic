<script setup>
import {computed} from 'vue';import {RotateCcw} from 'lucide-vue-next';import {useStudio} from '../store';
const s=useStudio(),prefs=computed(()=>s.config.previewReference||(s.config.previewReference={enabled:true,opacity:.35}));
</script>
<template><div class="reference-overlay-controls"><label class="inline-check"><input type="checkbox" v-model="prefs.enabled"/>分镜参考层</label><label>透明度<input type="range" v-model.number="prefs.opacity" min="0" max="1" step=".05" :disabled="!prefs.enabled"/><span>{{Math.round(prefs.opacity*100)}}%</span></label><button class="icon-button" aria-label="恢复参考层默认设置" title="恢复默认：显示参考层，透明度 35%" @click="prefs.enabled=true;prefs.opacity=.35"><RotateCcw :size="13"/></button></div></template>
