import { defineConfig } from 'vite';

// base './' 让构建产物可以部署在任意子路径（内网静态服务器、Nginx 子目录等）
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
