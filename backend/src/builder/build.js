import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

const STORAGE_ROOT = path.join(process.cwd(), 'backend', '.storage');
const ZIP_SIZE_LIMIT_MB = Number(process.env.BOT_ZIP_LIMIT_MB || 8);
const EXTRACT_SIZE_LIMIT_MB = Number(process.env.BOT_ZIP_EXTRACT_LIMIT_MB || 32);
const DENYLIST_MODULES = [
  'subprocess',
  'os',
  'sys',
  'socket',
  'ctypes',
  'cffi',
  'multiprocessing',
  'requests',
  'urllib',
  'pathlib',
  'shutil'
];
const DENYLIST_CALLS = ['eval', 'exec', '__import__'];

function ensureDirs() {
  for (const d of ['bot-zips', 'sbom', 'scan', 'tmp']) {
    const p = path.join(STORAGE_ROOT, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
  return STORAGE_ROOT;
}

function rejectWith(reasons = []) {
  const arr = Array.isArray(reasons) ? reasons : [String(reasons)];
  return { status: 'rejected', reasons: arr };
}

function extractZip(zipPath) {
  const tmpBase = path.join(ensureDirs(), 'tmp');
  const workdir = fs.mkdtempSync(path.join(tmpBase, 'bot-'));
  const unzip = spawnSync('unzip', ['-qq', zipPath, '-d', workdir]);
  if (unzip.status !== 0) {
    const py3 = spawnSync('python3', ['-m', 'zipfile', '-e', zipPath, workdir]);
    if (py3.status !== 0) {
      const py = spawnSync('python', ['-m', 'zipfile', '-e', zipPath, workdir]);
      if (py.status !== 0) {
        fs.rmSync(workdir, { recursive: true, force: true });
        throw new Error('Failed to extract ZIP payload');
      }
    }
  }
  return workdir;
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function hasRequirements(dir) {
  return walkFiles(dir).some((file) => path.basename(file).toLowerCase() === 'requirements.txt');
}

function getExtractedSize(dir) {
  return walkFiles(dir).reduce((sum, file) => sum + fs.statSync(file).size, 0);
}

function pythonAstAudit(workdir) {
  const script = `
import ast, json, pathlib, sys
DENY_MODULES = set(${JSON.stringify(DENYLIST_MODULES)})
DENY_CALLS = set(${JSON.stringify(DENYLIST_CALLS)})
root = pathlib.Path(sys.argv[1])
issues = []
for fp in root.rglob('*.py'):
    try:
        text = fp.read_text()
    except Exception:
        continue
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        issues.append(f"{fp.relative_to(root)}: syntax error {exc.msg}")
        continue
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                mod = alias.name.split('.')[0]
                if mod in DENY_MODULES:
                    issues.append(f"{fp.relative_to(root)}: denied import {mod}")
        elif isinstance(node, ast.ImportFrom):
            mod = (node.module or '').split('.')[0]
            if mod in DENY_MODULES:
                issues.append(f"{fp.relative_to(root)}: denied import {mod}")
        elif isinstance(node, ast.Call):
            target = getattr(node.func, 'id', None) or getattr(node.func, 'attr', None)
            if target in DENY_CALLS:
                issues.append(f"{fp.relative_to(root)}: denied builtin {target}")
issues = list(dict.fromkeys(issues))
print(json.dumps(issues))
`;
  const py = spawnSync('python3', ['-c', script, workdir], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const runner = py.status === 0 ? py : spawnSync('python', ['-c', script, workdir], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (runner.status !== 0) return null;
  try {
    return JSON.parse((runner.stdout || '[]').trim() || '[]');
  } catch {
    return null;
  }
}

function fallbackStaticScan(workdir) {
  const hits = new Set();
  for (const file of walkFiles(workdir)) {
    if (!file.endsWith('.py')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const mod of DENYLIST_MODULES) {
      if (text.includes(`import ${mod}`) || text.includes(`from ${mod} import`)) {
        hits.add(`${path.relative(workdir, file)}: denied import ${mod}`);
      }
    }
    for (const fn of DENYLIST_CALLS) {
      if (text.includes(`${fn}(`)) {
        hits.add(`${path.relative(workdir, file)}: denied builtin ${fn}`);
      }
    }
  }
  return Array.from(hits);
}

function runStaticAnalysis(workdir) {
  const astIssues = pythonAstAudit(workdir);
  if (Array.isArray(astIssues)) return astIssues;
  return fallbackStaticScan(workdir);
}

function writeJsonFile(dest, payload) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(payload, null, 2));
}

function createSbom({ versionId, files, imageRef }) {
  return {
    tool: 'syft-sim',
    version: 'v0',
    createdAt: new Date().toISOString(),
    targetImage: imageRef,
    artifacts: files
      .filter((f) => f.endsWith('.py'))
      .map((f) => ({
        name: path.basename(f),
        path: f.replace(STORAGE_ROOT, ''),
        type: 'python-source'
      }))
  };
}

function createScanReport({ digest }) {
  return {
    tool: 'grype-sim',
    generatedAt: new Date().toISOString(),
    summary: 'No critical findings detected',
    findings: [
      {
        id: crypto.randomUUID(),
        severity: 'low',
        package: 'python:3.11-slim',
        detail: 'Baseline image scanned with no actionable CVEs',
        digest
      }
    ]
  };
}

export async function buildVersion({ botId, versionId, zipPath }) {
  ensureDirs();
  if (!fs.existsSync(zipPath)) {
    throw new Error('Bot ZIP not uploaded yet');
  }
  const zipStat = fs.statSync(zipPath);
  const sizeMb = zipStat.size / (1024 * 1024);
  if (sizeMb > ZIP_SIZE_LIMIT_MB) {
    return rejectWith([`Zip too large (> ${ZIP_SIZE_LIMIT_MB} MB)`]);
  }

  const workdir = extractZip(zipPath);
  try {
    const extractedBytes = getExtractedSize(workdir);
    const extractedMb = extractedBytes / (1024 * 1024);
    if (extractedMb > EXTRACT_SIZE_LIMIT_MB) {
      return rejectWith([`Unpacked payload too large (> ${EXTRACT_SIZE_LIMIT_MB} MB)`]);
    }
    if (hasRequirements(workdir)) {
      return rejectWith(['Additional requirements.txt not allowed']);
    }

    const analysisIssues = runStaticAnalysis(workdir);
    if (analysisIssues.length > 0) {
      return rejectWith(analysisIssues.map((msg) => `Static analysis: ${msg}`));
    }

    const artifact = fs.readFileSync(zipPath);
    const signedDigest = 'sha256:' + crypto.createHash('sha256').update(artifact).digest('hex');
    const imageRef = `ghcr.io/daxlinks/bots/${botId}:${versionId}`;
    const files = walkFiles(workdir).map((f) => path.relative(workdir, f));

    const { sbomPath, scanPath } = storagePathsForVersion(versionId);
    writeJsonFile(sbomPath, createSbom({ versionId, files, imageRef }));
    writeJsonFile(scanPath, createScanReport({ digest: signedDigest }));

    return {
      status: 'approved',
      imageRef,
      signedDigest,
      sbomRef: `storage://sbom/${versionId}.json`,
      scanRef: `storage://scan/${versionId}.json`
    };
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

export function storagePathsForVersion(versionId) {
  const base = ensureDirs();
  return {
    zipPath: path.join(base, 'bot-zips', `${versionId}.zip`),
    sbomPath: path.join(base, 'sbom', `${versionId}.json`),
    scanPath: path.join(base, 'scan', `${versionId}.json`)
  };
}
