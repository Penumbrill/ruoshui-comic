<script setup>
import {computed} from 'vue';import {useStudio} from '../store';import {defaultQuality} from '../../shared/assistant-quality.mjs';
const s=useStudio(),c=computed(()=>s.config.llm||(s.config.llm={}));
</script>
<template><div class="assistant-quality"><label class="inline-check"><input type="checkbox" :checked="c.useDefaultQuality!==false" @change="c.useDefaultQuality=$event.target.checked"/>使用默认质量词</label><p v-if="c.useDefaultQuality!==false" class="muted">{{defaultQuality(s.config.activeProfile)}} · 随模型类型适配</p><label v-else>自定义质量词<input v-model="c.customQuality" aria-label="助手自定义质量词" maxlength="2000" placeholder="填写要使用的质量词；留空则不添加"/><small>保留场景、人物和画风描述；复制、导出与导入生图同步使用此处内容。</small></label></div></template>
