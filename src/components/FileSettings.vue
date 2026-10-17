<script setup>
import {useUiText} from "../ui-text";
const ui=useUiText();

import {fuzzyMatch} from '../../shared/search.mjs';
import {ref,computed,onMounted} from 'vue';import {FolderOpen,RefreshCw} from 'lucide-vue-next';import {useStudio,api} from '../store';
const s=useStudio(),data=ref(null),query=ref(''),loading=ref(false),page=ref(0);
const files=computed(()=>data.value?.files.filter(f=>fuzzyMatch(query.value,f.name,f.category))||[]);
async function refresh(){loading.value=true;try{data.value=await api('files/inventory');page.value=0;}finally{loading.value=false;}}
const size=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':Math.ceil(n/1024)+' KB';onMounted(()=>s.action(refresh));
async function reveal(f){if(!window.desktop?.revealManagedFile){s.notify('请在桌面客户端打开本地文件位置');return;}await window.desktop.revealManagedFile(f.kind,f.name);}
</script>
<template><section class="card"><div class="card-heading"><strong>{{ui("文件与本地位置")}}</strong><button class="secondary" :disabled="loading" @click="s.action(refresh)"><RefreshCw :size="15"/>{{ui("刷新文件")}}</button></div><div class="settings-body"><p class="muted">{{ui("当前位置：")}}{{ui(data?.root)}}{{ui("。移动整合包后，软件会重新检测自己的运行环境和文件位置。")}}</p><div v-for="folder in data?.folders" :key="folder.id" class="local-file-row"><div><strong>{{ui(folder.name)}}</strong><small>{{ui(folder.folder)}}</small></div><button class="secondary" @click="s.openFolder(folder.id)"><FolderOpen :size="15"/>{{ui("打开文件夹")}}</button></div><input v-model="query" :aria-label="ui(&quot;搜索本地文件&quot;)" :placeholder="ui(&quot;搜索模型、翻译文件、抠图文件…&quot;)" @input="page=0"/><p class="muted">{{ui("共 ")}}{{ui(files.length)}}{{ui(" 个文件，包含语言模型、视觉投影、抠图、翻译及生图模型的全部文件。")}}</p><div v-for="f in files.slice(page*60,(page+1)*60)" :key="f.name" class="local-file-row"><div><code>{{ui(f.name)}}</code><small>{{ui(size(f.size))}}</small></div><button class="icon-button" :aria-label="ui('打开 '+f.name+' 所在文件夹')" :title="ui('打开 '+f.name+' 所在文件夹')" @click="s.action(()=>reveal(f))"><FolderOpen :size="17"/></button></div><div v-if="files.length>60" class="pagination"><button class="secondary" :disabled="page===0" @click="page--">{{ui("上一页")}}</button><span>{{ui(page+1)}} / {{ui(Math.ceil(files.length/60))}}</span><button class="secondary" :disabled="(page+1)*60>=files.length" @click="page++">{{ui("下一页")}}</button></div></div></section></template>
