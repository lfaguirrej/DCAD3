import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true,
        port: 5173,
        cors: true,
        allowedHosts: true,
        hmr: {
            clientPort: 443
        },
        proxy: {
            '/convert': {
                target: 'http://localhost:8001',
                changeOrigin: true,
                secure: false,
            },
            '/models': {
                target: 'http://localhost:8001',
                changeOrigin: true,
                secure: false,
            },
            '/upload': {
                target: 'http://localhost:8001',
                changeOrigin: true,
                secure: false,
            },
            '/static': {
                target: 'http://localhost:8001',
                changeOrigin: true,
                secure: false,
            }
        }
    }
});
