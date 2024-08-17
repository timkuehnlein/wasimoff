import { fileURLToPath, URL } from "node:url";
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill';
import { nodePolyfills } from "vite-plugin-node-polyfills";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [ vue(),
    nodePolyfills(
      {
        include: ["path", "stream", "util"],
        exclude: ["http"],
        globals: {
          Buffer:true,
          global: true,
        },
        protocolImports: true,
      }
    ),
   ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // buffer: "buffer",
    },
  },
  build: { target: "firefox114",
    // rollupOptions: {
    //   plugins: [
    //     rollupNodePolyfills(), // rollup-plugin-node-polyfills
    //   ]
    // }
   },
  worker: { format: "es" },
  server: {
    headers: {
      // support SharedArrayBuffers
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    proxy: {
      // forward requests to the broker
      "/api/broker": "http://localhost:4080",
    }
  },
  // optimizeDeps: {
  //   esbuildOptions: {
  //     // Node.js global to browser globalThis
  //     define: {
  //       global: 'globalThis',
  //     },
  //     // Enable esbuild polyfill plugins
  //     plugins: [
  //       NodeGlobalsPolyfillPlugin({
  //         buffer: true,
  //       }),
  //       NodeModulesPolyfillPlugin(),
  //     ],
  //   },
  // },
})
