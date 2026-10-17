<script setup>
import {useUiText} from "../ui-text";
const ui=useUiText();

import {ref,onMounted} from 'vue';
import {Terminal,RefreshCw} from 'lucide-vue-next';
import {useStudio} from '../store';
const s=useStudio(),state=ref(null),busy=ref(false),error=ref('');
async function check(action='status'){
 if(!window.desktop?.managePath){state.value={available:false,message:'桌面版启动后自动配置 PATH'};return;}
 busy.value=true;error.value='';
 try{state.value=await window.desktop.managePath(action);if(action==='repair'&&state.value.registered)s.notify('PATH 已配置，新打开的终端即可使用');}catch(e){error.value=e.message;}finally{busy.value=false;}
}
onMounted(()=>check());
</script>
<template><section class="card"><div class="card-heading"><strong><Terminal :size="17"/>{{ui(s.t('自动配置 PATH','Automatic PATH setup'))}}</strong></div><div class="settings-body"><div class="setting-row"><div><strong>{{ui(state?.available?(state.registered?s.t('已自动配置','Configured'):s.t('需要修复','Repair needed')):s.t('桌面环境自动适配','Desktop environment setup'))}}</strong><p>{{ui(s.t('软件启动时自动检查。软件目录加入当前用户 PATH，内置运行组件自动加入本软件的运行环境。','Checked automatically at launch. The app folder is registered in user PATH and bundled tools are added to the app runtime environment.'))}}</p><small v-if="state?.root" class="path-location">{{ui(state.root)}}</small><small v-if="state&&!state.available">{{ui(state.message)}}</small></div><button class="secondary" :disabled="busy||!state?.available" @click="check('repair')"><RefreshCw :size="15" :class="{spin:busy}"/>{{ui(busy?s.t('正在检测…','Checking…'):s.t('检测并修复 PATH','Check and repair PATH'))}}</button></div><p v-if="error" class="error-note">{{ui(error)}}</p></div></section></template>
<style scoped>.path-location{display:block;overflow-wrap:anywhere}.setting-row{gap:16px;flex-wrap:wrap}.setting-row>div{flex:1;min-width:220px}.setting-row>button{flex-shrink:0}</style>
