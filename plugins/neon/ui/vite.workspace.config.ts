import {defineConfig} from 'vite';
import base from './vite.config';

export default defineConfig({
  ...base,
  build: {
    ...base.build,
    emptyOutDir: false,
    lib: {entry:'src/workspace.tsx',formats:['iife'],name:'__tabularis_plugin__',fileName:()=>'workspace.js'},
  },
});
