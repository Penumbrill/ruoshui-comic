<script setup>
import {useUiText} from "../ui-text";
const ui=useUiText();

import {computed} from 'vue';import {RotateCcw} from 'lucide-vue-next';import {parameterValue,restoreParameter} from '../../shared/parameter-defaults.mjs';
const p=defineProps({model:Object,defaults:Object,path:String,label:String});const value=computed(()=>parameterValue(p.defaults,p.path));
const title=computed(()=>`恢复${p.label||'此参数'}默认值：${value.value===undefined?'自动':value.value===''?'随机':value.value}`);
</script>
<template><button type="button" class="parameter-reset" :title="ui(title)" :aria-label="ui(title)" @click.stop.prevent="restoreParameter(model,path,value)"><RotateCcw :size="12"/></button></template>
