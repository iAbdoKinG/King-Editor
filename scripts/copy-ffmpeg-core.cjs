// Copies the FFmpeg WebAssembly core into public/ffmpeg so it is self-hosted
// (no third-party CDN; works offline once cached). Runs before every build.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const dst = path.join(__dirname, '..', 'public', 'ffmpeg');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const from = path.join(src, f);
  const to = path.join(dst, f);
  if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) fs.copyFileSync(from, to);
}
console.log('FFmpeg core ready in public/ffmpeg');
