// Copies the built web app (../dist) into ./app for packaging.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'dist');
const dst = path.join(__dirname, 'app');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('Build the web app first: npm run build (in the repository root).');
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
// Browser-only files are not needed inside the desktop app.
for (const f of ['sw.js', '_headers']) fs.rmSync(path.join(dst, f), { force: true });
console.log('Copied web app to', dst);
