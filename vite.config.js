import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], server: {host: '127.0.0.1', port: 4317, strictPort: true, proxy: {'/api': 'http://127.0.0.1:4319'}}, build: {emptyOutDir:false,chunkSizeWarningLimit: 750} });
