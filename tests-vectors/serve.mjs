import {build,preview} from 'vite';
const outDir='dist-vectors';
await build({build:{outDir,rollupOptions:{input:'tests-vectors/vectors-fixture.html'}}});
await preview({build:{outDir},preview:{host:'127.0.0.1',port:8767,strictPort:true}});
