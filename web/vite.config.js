import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5173,
        proxy: {
            "/api": "http://127.0.0.1:8088",
            "/status.json": "http://127.0.0.1:8088",
            "/healthz": "http://127.0.0.1:8088",
            "/readyz": "http://127.0.0.1:8088",
        },
    },
});
