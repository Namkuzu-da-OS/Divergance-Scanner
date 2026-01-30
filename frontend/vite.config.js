import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5842,
        proxy: {
            '/api': {
                target: 'http://localhost:8042',
                changeOrigin: true,
            },
            '/ws': {
                target: 'ws://localhost:8042',
                ws: true,
            },
        },
    },
});
