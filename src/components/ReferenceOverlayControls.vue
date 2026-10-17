<script setup>
import {useUiText} from "../ui-text";
const ui=useUiText();

import {computed} from 'vue';import {RotateCcw} from 'lucide-vue-next';import {useStudio} from '../store';
const s=useStudio(),prefs=computed(()=>s.config.previewReference||(s.config.previewReference={enabled:true,opacity:.35}));
</script>
<template><div class="reference-overlay-controls"><label class="inline-check"><input type="checkbox" v-model="prefs.enabled"/>{{ui("分镜参考层")}}</label><label>{{ui("透明度")}}<input type="range" v-model.number="prefs.opacity" min="0" max="1" step=".05" :disabled="!prefs.enabled"/><span>{{ui(Math.round(prefs.opacity*100))}}%</span></label><button class="icon-button" :aria-label="ui(&quot;恢复参考层默认设置&quot;)" :title="ui(&quot;恢复默认：显示参考层，透明度 35%&quot;)" @click="prefs.enabled=true;prefs.opacity=.35"><RotateCcw :size="13"/></button></div></template>
