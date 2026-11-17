import { createWorker, OEM, PSM } from 'tesseract.js';

export async function readKeynote(image:Blob) {
  const assets = new URL('/ocr-assets/',location.origin);
  const worker = await createWorker('eng',OEM.LSTM_ONLY,{
    workerPath:new URL('worker.min.js',assets).href,
    corePath:new URL('tesseract-core-lstm.wasm.js',assets).href,
    langPath:assets.href,
    workerBlobURL:false,
  });
  try {
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
    const {data}=await worker.recognize(image);
    return data.text.replace(/\s+/g,' ').trim();
  } finally {
    await worker.terminate();
  }
}
