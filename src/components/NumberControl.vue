<script setup>
import {Minus,Plus} from 'lucide-vue-next';
const p=defineProps({modelValue:[Number,String],min:[Number,String],max:[Number,String],step:{type:[Number,String],default:1},label:String,unit:String});const emit=defineEmits(['update:modelValue']);
function set(value){const n=Number(value);if(!Number.isFinite(n))return;emit('update:modelValue',Math.max(p.min===undefined?-Infinity:Number(p.min),Math.min(p.max===undefined?Infinity:Number(p.max),Number(n.toFixed(6)))));}
function change(direction){set((Number(p.modelValue)||0)+direction*Number(p.step));}
</script>
<template><div class="number-control"><button type="button" :aria-label="'减少'+(label||'数值')" :disabled="min!==undefined&&Number(modelValue)<=Number(min)" @click="change(-1)"><Minus :size="13"/></button><input type="number" :aria-label="label" :value="modelValue" :min="min" :max="max" :step="step" @input="$event.target.value!==''&&set($event.target.value)" @change="set($event.target.value)"/><span v-if="unit" class="number-unit">{{unit}}</span><button type="button" :aria-label="'增加'+(label||'数值')" :disabled="max!==undefined&&Number(modelValue)>=Number(max)" @click="change(1)"><Plus :size="13"/></button></div></template>
