import {createApp} from 'vue';
import {createPinia} from 'pinia';
import App from './App.vue';
import './style.css';
import {resizePanels} from './panel-resize';
import {previewZoom,brushCursor} from './preview-tools';
import {installNumericWheel} from './numeric-wheel';
installNumericWheel();
createApp(App).use(createPinia()).directive('resize-panels',resizePanels).directive('preview-zoom',previewZoom).directive('brush-cursor',brushCursor).mount('#app');

// All refresh controls share an immediate visual acknowledgement.
const refreshTimers=new WeakMap();document.addEventListener('click',event=>{const button=event.target.closest?.('button');if(!button||button.disabled||!(/刷新|重新翻译|重新检查|重新检测/.test(button.textContent+' '+(button.title||'')+' '+(button.getAttribute('aria-label')||''))||button.querySelector('[class*="lucide-refresh-"]')))return;clearTimeout(refreshTimers.get(button));button.classList.remove('refresh-feedback');void button.offsetWidth;button.classList.add('refresh-feedback');refreshTimers.set(button,setTimeout(()=>button.classList.remove('refresh-feedback'),900));},true);
