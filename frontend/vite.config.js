import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // 도메인 허용 설정 (에러 해결 핵심!)
    allowedHosts: [
      'smpa.aikopo.net',
      'smartpantry.aikopo.net',
      'localhost'
    ],
    host: true, // 외부 접속 허용
    port: 5173,
    proxy: {
      // 브라우저 요청을 백엔드(web:3000)로 전달
      '/api': {
        target: 'http://web:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://web:3000',
        changeOrigin: true,
      },
      '/logout': {
        target: 'http://web:3000',
        changeOrigin: true,
      }
    }
  }
});