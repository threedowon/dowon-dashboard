import {build} from 'esbuild';

await build({
  entryPoints: {'sheet': 'hardware/src/main.tsx'},
  outdir: 'hardware/dist',
  bundle: true, minify: true, splitting: true, format: 'esm',
  jsx: 'automatic', target: ['es2022'],
  external: ['../../assets/fonts/*'],
  define: {'process.env.NODE_ENV': '"production"'},
});
