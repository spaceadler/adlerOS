pdf.js 6.4.299 (Mozilla, Apache 2.0: pdfjs-LICENSE.txt), from npm's
pdfjs-dist-6.4.299.tgz (sha512-AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g==),
its legacy build (polyfilled, for older Safari):

  pdfjs.js                     legacy/build/pdf.min.mjs
  pdfjs-worker.js              legacy/build/pdf.worker.min.mjs
  jbig2_nowasm_fallback.js     wasm/jbig2_nowasm_fallback.js     (jbig2-LICENSE.txt)
  jbig2.wasm                   wasm/jbig2.wasm                   (jbig2-LICENSE.txt)
  openjpeg.wasm                wasm/openjpeg.wasm                (openjpeg-LICENSE.txt)
  openjpeg_nowasm_fallback.js  wasm/openjpeg_nowasm_fallback.js  (openjpeg-LICENSE.txt)

Renamed .mjs to .js: the server serves static files by suffix, two folders
deep. Luna draws a note's PDFs with it where the browser shows only a PDF's
first page (a phone's). The scanned-page decoders are WebAssembly (a page in
7s, not 59, on a Pi); the server lets only pdfjs-worker.js compile it
(PDF_WORKER_CSP), and where that's refused pdf.js takes the JS fallbacks.
