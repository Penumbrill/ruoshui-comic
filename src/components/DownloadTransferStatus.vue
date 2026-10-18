<script setup>
import {useStudio} from '../store';
const s=useStudio();
defineProps({install:{type:Object,required:true}});
</script>
<template><div class="download-transfer-status" v-if="install.source||install.route||install.connections"><span v-if="install.source">{{s.t('下载源：','Source: ')}}{{install.source}}</span><span v-if="install.route">{{install.route==='proxy'?s.t('代理连接','Proxy connection'):s.t('直接连接','Direct connection')}}</span><span v-if="install.connections">{{s.t(install.connections+' 路下载',install.connections===1?'1 connection':install.connections+' connections')}}</span><span v-if="install.downloadHost&&install.downloadHost!==install.source">{{s.t('下载节点：','Download host: ')}}{{install.downloadHost}}</span></div></template>
<style scoped>.download-transfer-status{display:flex;gap:5px 14px;flex-wrap:wrap;color:#8b819f;font-size:11px;line-height:1.6;overflow-wrap:anywhere}</style>
