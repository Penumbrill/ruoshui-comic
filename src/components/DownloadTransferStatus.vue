<script setup>
import {useStudio} from '../store';
const s=useStudio();
defineProps({install:{type:Object,required:true}});
</script>
<template><div class="download-transfer-status" v-if="install.source||install.route||install.connections"><span v-if="install.source">{{s.t('下载源：','Source: ')}}{{install.source==='huggingface.co'?s.t('官网 · ','Official · '):install.source==='hf-mirror.com'?s.t('镜像 · ','Mirror · '):install.source==='modelscope.cn'?s.t('国内托管 · ','Domestic host · '):''}}{{install.source}}</span><span v-if="install.route" :title="install.route==='proxy'?s.t('通过程序检测到的 HTTP 代理；最终线路由代理规则决定。','Uses the detected HTTP proxy; its rules choose the final route.'):s.t('未使用 HTTP 代理；系统 VPN/TUN 仍可能接管流量。','No HTTP proxy is used. A system VPN/TUN may still route this traffic.')">{{install.route==='proxy'?s.t('HTTP 代理','HTTP proxy'):s.t('系统网络','System network')}}</span><span v-if="install.connections">{{s.t(install.connections+' 路下载',install.connections===1?'1 connection':install.connections+' connections')}}</span><span v-if="install.downloadHost&&install.downloadHost!==install.source">{{s.t('实际节点：','Actual host: ')}}{{install.downloadHost}}</span></div></template>
<style scoped>.download-transfer-status{display:flex;gap:5px 14px;flex-wrap:wrap;color:#8b819f;font-size:11px;line-height:1.6;overflow-wrap:anywhere}</style>
