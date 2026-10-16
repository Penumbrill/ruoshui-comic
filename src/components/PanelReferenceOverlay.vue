<script setup>
import {computed} from 'vue';
import ComicArtwork from './ComicArtwork.vue';
import {panelOverlayMatrix,panelOverlayPage} from '../../shared/panel-overlay.mjs';
const props=defineProps({page:Object,panel:Object,width:Number,height:Number,opacity:{type:Number,default:.35}});
const matrix=computed(()=>panelOverlayMatrix(props.panel,props.width,props.height));
const scene=computed(()=>panelOverlayPage(props.page,props.panel));
</script>
<template><svg v-if="matrix" class="panel-reference-overlay" :viewBox="`0 0 ${width} ${height}`" aria-label="半透明分镜参考层" :style="{opacity}"><g :transform="`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`"><ComicArtwork :page="scene" :background="false"/></g></svg></template>
<style scoped>.panel-reference-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:2}</style>
