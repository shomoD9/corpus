import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');
const manifestPath = path.join(rootDir, 'manifest.json');
const zipPath = path.join(rootDir, 'extension.zip');

const shouldCleanOnly = process.argv.includes('--clean');
const shouldZip = process.argv.includes('--zip');

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function cleanArtifacts() {
  if (await exists(distDir)) {
    await rm(distDir, { recursive: true, force: true });
  }

  if (await exists(zipPath)) {
    await rm(zipPath, { force: true });
  }
}

async function copySource() {
  await mkdir(distDir, { recursive: true });
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const injectedClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();

  if (injectedClientId) {
    manifest.oauth2 = manifest.oauth2 || {};
    manifest.oauth2.client_id = injectedClientId;
  } else if (String(manifest?.oauth2?.client_id || '').includes('REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID')) {
    console.warn(
      'Warning: OAuth client id placeholder is still set. Provide GOOGLE_OAUTH_CLIENT_ID for production builds.'
    );
  }

  await writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const entries = await readdir(srcDir);

  for (const entry of entries) {
    await cp(path.join(srcDir, entry), path.join(distDir, 'src', entry), {
      recursive: true,
      force: true
    });
  }
}

function runZip() {
  return new Promise((resolve, reject) => {
    const zip = spawn('zip', ['-r', zipPath, '.'], {
      cwd: distDir,
      stdio: 'inherit'
    });

    zip.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`zip exited with code ${code}`));
    });

    zip.on('error', reject);
  });
}

async function main() {
  await cleanArtifacts();

  if (shouldCleanOnly) {
    console.log('Clean complete.');
    return;
  }

  await copySource();

  if (shouldZip) {
    await runZip();
    console.log('Build + zip complete.');
    return;
  }

  console.log('Build complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
