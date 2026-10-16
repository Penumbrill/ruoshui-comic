<script setup>
import {ref,onMounted} from 'vue';
import {RefreshCw,Trash2,LoaderCircle} from 'lucide-vue-next';
import {useStudio,api} from '../store';
const s=useStudio(),status=ref(null),busy=ref(false),error=ref('');
s.config.cacheMaintenance||={enabled:true,maxMB:0,days:7};
const size=bytes=>bytes>=1024**3?(bytes/1024**3).toFixed(2)+' GB':(bytes/1024**2).toFixed(1)+' MB';
async function refresh(){busy.value=true;error.value='';try{status.value=await api('cache/status');}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function clean(){busy.value=true;try{const result=await api('cache/clean',{});s.notify(result.skipped||`已清理 ${result.removedFiles} 个缓存文件，释放 ${size(result.removedBytes)}`);status.value=await api('cache/status');}catch(e){error.value=e.message;}finally{busy.value=false;}}
onMounted(refresh);
</script>
<template><section class="card"><div class="card-heading"><strong>缓存与存储</strong><button class="quiet" @click="refresh" :disabled="busy" :aria-busy="busy"><RefreshCw :size="15"/>刷新占用</button></div><div class="settings-body"><label class="inline-check"><input type="checkbox" v-model="s.config.cacheMaintenance.enabled"/>空闲时自动清理临时缓存</label><p class="muted">启动后和每隔 30 分钟检查，按缓存期限与磁盘可用空间清理。</p><p v-if="status">临时缓存 {{size(status.bytes)}} · 自动容量上限 {{size(status.maxBytes)}}</p><p v-if="status?.last" class="muted">上次释放 {{size(status.last.removedBytes)}} · {{new Date(status.last.at).toLocaleString()}}</p><p v-if="error" class="error-note">{{error}}</p><div class="button-row"><button class="secondary" @click="clean" :disabled="busy" :aria-busy="busy"><LoaderCircle v-if="busy" :size="15" class="spin"/><Trash2 v-else :size="15"/>立即清理过期缓存</button></div><p class="muted">作品、模型、聊天、自动保存、登录状态及未完成下载会保留。</p><details><summary>高级：缓存期限和容量</summary><div class="parameter-grid"><label>保留天数<input type="number" v-model.number="s.config.cacheMaintenance.days" min="1" max="30"/></label><label>容量上限（MB，0 为自动）<input type="number" v-model.number="s.config.cacheMaintenance.maxMB" min="0" max="8192"/></label></div></details></div></section></template>
