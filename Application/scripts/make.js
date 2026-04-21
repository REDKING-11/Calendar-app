const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { api } = require('@electron-forge/core');

const appDir = path.resolve(__dirname, '..');

const DEFAULT_WIX_BIN_DIRS = [
  process.env.WIX_BIN,
  process.env.WIX ? path.join(process.env.WIX, 'bin') : null,
  process.env.WIX_HOME ? path.join(process.env.WIX_HOME, 'bin') : null,
  'C:\\Program Files (x86)\\WiX Toolset v3.14\\bin',
  'C:\\Program Files (x86)\\WiX Toolset v3.11\\bin',
  'C:\\Program Files\\WiX Toolset v3.14\\bin',
  'C:\\Program Files\\WiX Toolset v3.11\\bin',
].filter(Boolean);

function commandExists(command) {
  const executable = process.platform === 'win32' && !command.endsWith('.exe')
    ? `${command}.exe`
    : command;
  const result = spawnSync(executable, ['-?'], {
    stdio: 'ignore',
  });

  return !result.error && result.status === 0;
}

function ensureWixOnPath() {
  if (process.platform !== 'win32') {
    return;
  }

  if (commandExists('candle') && commandExists('light')) {
    return;
  }

  const wixBinDir = DEFAULT_WIX_BIN_DIRS.find((candidate) => (
    fs.existsSync(path.join(candidate, 'candle.exe'))
      && fs.existsSync(path.join(candidate, 'light.exe'))
  ));

  if (!wixBinDir) {
    return;
  }

  process.env.PATH = `${wixBinDir}${path.delimiter}${process.env.PATH || ''}`;
  console.log(`[make] Using WiX Toolset from ${wixBinDir}`);
}

function readOption(args, index) {
  const value = args[index];
  const equalsIndex = value.indexOf('=');

  if (equalsIndex >= 0) {
    return {
      value: value.slice(equalsIndex + 1),
      nextIndex: index,
    };
  }

  return {
    value: args[index + 1],
    nextIndex: index + 1,
  };
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseMakeArgs(args) {
  const options = {
    arch: process.arch,
    platform: process.platform,
    skipPackage: false,
    outDir: null,
    overrideTargets: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--skip-package') {
      options.skipPackage = true;
      continue;
    }

    if (arg === '--arch' || arg.startsWith('--arch=')) {
      const parsed = readOption(args, index);
      options.arch = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (arg === '--platform' || arg.startsWith('--platform=')) {
      const parsed = readOption(args, index);
      options.platform = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (arg === '--targets' || arg.startsWith('--targets=')) {
      const parsed = readOption(args, index);
      options.overrideTargets = parsed.value
        ? parsed.value.split(',').map((target) => target.trim()).filter(Boolean)
        : null;
      index = parsed.nextIndex;
      continue;
    }

    if (arg === '--out-dir' || arg === '--outDir' || arg.startsWith('--out-dir=') || arg.startsWith('--outDir=')) {
      const parsed = readOption(args, index);
      options.outDir = path.resolve(appDir, parsed.value);
      index = parsed.nextIndex;
    }
  }

  if (!options.outDir && !options.skipPackage) {
    options.outDir = path.resolve(appDir, 'out', `make-${timestampForPath()}`);
  }

  return options;
}

async function main() {
  ensureWixOnPath();

  const options = parseMakeArgs(process.argv.slice(2));

  if (options.outDir) {
    console.log(`[make] Output directory: ${options.outDir}`);
  }

  await api.make({
    dir: appDir,
    interactive: true,
    arch: options.arch,
    platform: options.platform,
    skipPackage: options.skipPackage,
    overrideTargets: options.overrideTargets || undefined,
    outDir: options.outDir || undefined,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
