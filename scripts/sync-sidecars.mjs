import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function inferTargetTriple() {
  const env = process.env.VECHO_TARGET_TRIPLE;
  if (env && env.trim()) return env.trim();

  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    if (arch !== 'x64') {
      throw new Error(`Unsupported Windows arch: ${arch} (expected x64)`);
    }
    return 'x86_64-pc-windows-msvc';
  }

  if (platform === 'darwin') {
    if (arch === 'arm64') return 'aarch64-apple-darwin';
    if (arch === 'x64') return 'x86_64-apple-darwin';
    throw new Error(`Unsupported macOS arch: ${arch}`);
  }

  if (platform === 'linux') {
    if (arch === 'x64') return 'x86_64-unknown-linux-gnu';
    if (arch === 'arm64') return 'aarch64-unknown-linux-gnu';
    throw new Error(`Unsupported Linux arch: ${arch}`);
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

async function chmodIfNeeded(filePath) {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(filePath, 0o755);
  } catch {
    // ignore
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const target = inferTargetTriple();
  const ext = target.includes('windows') ? '.exe' : '';

  const srcDir = path.join(repoRoot, 'sidecars', target);
  const destDir = path.join(repoRoot, 'src-tauri', 'bin');
  await fs.mkdir(destDir, { recursive: true });

  const names = ['ffmpeg', 'ffprobe', 'yt-dlp'];
  const copied = [];

  for (const name of names) {
    const src = path.join(srcDir, `${name}${ext}`);
    const dest = path.join(destDir, `${name}-${target}${ext}`);

    await fs.copyFile(src, dest);
    await chmodIfNeeded(dest);
    copied.push({ name, dest });
  }

  process.stdout.write(`Synced sidecars for ${target}\n`);
  for (const c of copied) {
    process.stdout.write(`- ${c.name}: ${path.relative(repoRoot, c.dest)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + '\n');
  process.stderr.write(`\nExpected layout:\n`);
  process.stderr.write(`  sidecars/<target-triple>/ffmpeg(.exe)\n`);
  process.stderr.write(`  sidecars/<target-triple>/ffprobe(.exe)\n`);
  process.stderr.write(`  sidecars/<target-triple>/yt-dlp(.exe)\n\n`);
  process.stderr.write(`Then run:\n  npm run sidecars:sync\n`);
  process.exit(1);
});
