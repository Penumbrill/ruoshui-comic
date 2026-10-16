<script setup>
import {ref} from 'vue';import {Pause,Play,RefreshCw,X} from 'lucide-vue-next';import {useStudio,api} from '../store';
const s=useStudio(),working=ref(false);
async function control(action){if(working.value)return;working.value=true;try{await s.action(async()=>{s.install=await api('models/download/control',{action});});}finally{working.value=false;}}
</script>
<template><div v-if="s.install.profile&&s.install.profile!=='runtime'&&s.install.state!=='done'" class="download-controls"><button v-if="s.install.state==='running'" class="quiet" :disabled="working" title="暂停下载，保留进度" @click="control('pause')"><Pause :size="14"/>暂停</button><button v-else class="quiet" :disabled="working" title="从已下载位置继续" @click="control('resume')"><Play :size="14"/>{{s.install.state==='paused'?'继续':'重新开始'}}</button><button class="quiet" :disabled="working" :aria-busy="working" title="刷新并重试下载，重新检测可用下载源" @click="control('retry')"><RefreshCw :size="14"/>刷新</button><button v-if="s.install.state!=='cancelled'" class="quiet danger" :disabled="working" title="取消任务，保留已下载部分以便下次续传" @click="control('cancel')"><X :size="14"/>取消</button></div></template>
