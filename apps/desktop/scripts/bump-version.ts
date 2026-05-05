import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');

const tauriConfPath = path.join(desktopDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(desktopDir, 'src-tauri', 'Cargo.toml');
const packageJsonPath = path.join(desktopDir, 'package.json');

type BumpKind = 'patch' | 'minor' | 'major';

function bump(version: string, kind: BumpKind): string {
  const parts = version.split('.').map((s) => parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Bad semver in tauri.conf.json: "${version}"`);
  }
  let [major, minor, patch] = parts;
  if (kind === 'major') { major += 1; minor = 0; patch = 0; }
  else if (kind === 'minor') { minor += 1; patch = 0; }
  else { patch += 1; }
  return `${major}.${minor}.${patch}`;
}

function rewriteTauriConf(next: string) {
  const raw = fs.readFileSync(tauriConfPath, 'utf-8');
  const conf = JSON.parse(raw);
  conf.version = next;
  fs.writeFileSync(tauriConfPath, JSON.stringify(conf, null, 2) + '\n');
}

// Cargo.toml: only rewrite the [package] section's version line. Don't blanket-
// replace because dependency versions ("tauri = { version = ... }") would match too.
function rewriteCargoToml(next: string) {
  const raw = fs.readFileSync(cargoTomlPath, 'utf-8');
  const lines = raw.split('\n');
  let inPackage = false;
  let replaced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\[package\]\s*$/.test(line)) { inPackage = true; continue; }
    if (/^\[/.test(line)) { inPackage = false; continue; }
    if (inPackage && /^version\s*=\s*"/.test(line)) {
      lines[i] = `version = "${next}"`;
      replaced = true;
      break;
    }
  }
  if (!replaced) throw new Error('Could not find [package].version line in Cargo.toml');
  fs.writeFileSync(cargoTomlPath, lines.join('\n'));
}

function rewritePackageJson(next: string) {
  const raw = fs.readFileSync(packageJsonPath, 'utf-8');
  const pkg = JSON.parse(raw);
  pkg.version = next;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

function main() {
  const kind = process.argv[2] as BumpKind | undefined;
  if (kind !== 'patch' && kind !== 'minor' && kind !== 'major') {
    console.error('Usage: tsx scripts/bump-version.ts <patch|minor|major>');
    process.exit(1);
  }

  const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
  const current = conf.version as string;
  const next = bump(current, kind);
  console.log(`Bumping v${current} → v${next} (${kind})`);

  rewriteTauriConf(next);
  rewriteCargoToml(next);
  rewritePackageJson(next);

  const filesToStage = [
    path.relative(repoRoot, tauriConfPath),
    path.relative(repoRoot, cargoTomlPath),
    path.relative(repoRoot, packageJsonPath),
  ];
  execSync(`git add ${filesToStage.map((f) => `"${f}"`).join(' ')}`, { cwd: repoRoot, stdio: 'inherit' });
  execSync(`git commit -m "chore: bump v${next}"`, { cwd: repoRoot, stdio: 'inherit' });
  execSync(`git tag "v${next}"`, { cwd: repoRoot, stdio: 'inherit' });

  console.log(`\nDone. Next: git push --follow-tags`);
}

main();
