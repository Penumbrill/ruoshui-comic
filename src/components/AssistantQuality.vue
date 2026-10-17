<script setup>
import {useUiText} from "../ui-text";
const ui=useUiText();

import {computed} from 'vue';import {useStudio} from '../store';import {defaultQuality} from '../../shared/assistant-quality.mjs';
const s=useStudio(),c=computed(()=>s.config.llm||(s.config.llm={}));
</script>
<template><div class="assistant-quality"><label class="inline-check"><input type="checkbox" :checked="c.useDefaultQuality!==false" @change="c.useDefaultQuality=$event.target.checked"/>{{ui("使用默认质量词")}}</label><p v-if="c.useDefaultQuality!==false" class="muted">{{ui(defaultQuality(s.config.activeProfile))}}{{ui(" · 随模型类型适配")}}</p><label v-else>{{ui("自定义质量词")}}<input v-model="c.customQuality" :aria-label="ui(&quot;助手自定义质量词&quot;)" maxlength="2000" :placeholder="ui(&quot;填写要使用的质量词；留空则不添加&quot;)"/><small>{{ui("保留场景、人物和画风描述；复制、导出与导入生图同步使用此处内容。")}}</small></label></div></template>
