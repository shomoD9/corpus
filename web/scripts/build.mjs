import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

const shouldCleanOnly = process.argv.includes('--clean');

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function cleanDist() {
  if (await exists(distDir)) {
    await rm(distDir, { recursive: true, force: true });
  }
}

async function copySrcToDist() {
  await mkdir(distDir, { recursive: true });
  const entries = await readdir(srcDir);

  for (const entry of entries) {
    await cp(path.join(srcDir, entry), path.join(distDir, entry), {
      recursive: true,
      force: true
    });
  }
}

async function main() {
  await cleanDist();

  if (shouldCleanOnly) {
    console.log('Cleaned dist directory.');
    return;
  }

  await copySrcToDist();
  console.log('Build complete. Output: dist/');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
