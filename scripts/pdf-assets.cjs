const { cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const dest = join(__dirname, '..', 'public', 'pdf-assets');
mkdirSync(dest, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm']) {
  cpSync(join(__dirname, '..', 'node_modules', 'pdfjs-dist', dir), join(dest, dir), { recursive: true });
}

const ocrDest = join(__dirname, '..', 'public', 'ocr-assets');
mkdirSync(ocrDest, { recursive: true });
for (const [source, name] of [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js/dist/worker.min.js.LICENSE.txt', 'worker.min.js.LICENSE.txt'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/LICENSE', 'CORE-LICENSE.txt'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
]) {
  cpSync(join(__dirname, '..', 'node_modules', source), join(ocrDest, name));
}
