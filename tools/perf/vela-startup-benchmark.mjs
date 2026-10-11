import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const appRequire = createRequire(pathToFileURL(path.join(ROOT, 'apps/vela-tts/index.cjs')));
const { parse } = appRequire('acorn');
const { full, simple } = appRequire('acorn-walk');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function zipEntries(rpk) {
  const listing = execFileSync('unzip', ['-Zl', rpk], { encoding: 'utf8' });
  return listing.split('\n').flatMap(line => {
    const match = line.match(/\s+\d+\.\d+\s+fat\s+(\d+)\s+b-\s+(\d+)\s+\S+\s+\d+-\w+-\d+\s+\S+\s+(.+)$/);
    if (!match) return [];
    const name = match[3];
    if (name.endsWith('/')) return [];
    return [{ name, uncompressedBytes: Number(match[1]), compressedBytes: Number(match[2]) }];
  });
}

function readZip(rpk, name) {
  return execFileSync('unzip', ['-p', rpk, name], { maxBuffer: 16 * 1024 * 1024 });
}

function collectGarbage() {
  if (typeof globalThis.gc !== 'function') return false;
  for (let index = 0; index < 3; index++) globalThis.gc();
  return true;
}

function pageSourceForCompilation(source) {
  if (!source.startsWith('export default function')) {
    throw new Error('Unexpected page bundle prefix; expected export default function');
  }
  return 'var pageModule = ' + source.slice('export default '.length);
}

function compileMetrics(source) {
  const compilationSource = pageSourceForCompilation(source);
  const timings = [];
  for (let index = 0; index < 8; index++) {
    const before = performance.now();
    new vm.Script(compilationSource, { filename: 'pages/index/index.js' });
    timings.push(performance.now() - before);
  }

  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'module' });
  let astNodes = 0;
  full(ast, () => { astNodes++; });
  const moduleMapCandidates = [];
  simple(ast, {
    ObjectExpression(node) {
      const moduleProperties = node.properties.filter(property =>
        property.type === 'Property' && property.key?.type === 'Literal' &&
        typeof property.key.value === 'string' && /^\.{1,2}\//.test(property.key.value) &&
        (property.value.type === 'FunctionExpression' || property.value.type === 'ArrowFunctionExpression'));
      if (moduleProperties.length > 0) moduleMapCandidates.push(moduleProperties.length);
    }
  });
  const bundleModules = moduleMapCandidates.length ? Math.max(...moduleMapCandidates) : null;

  const retainedScripts = [];
  const retainedHeapDeltas = [];
  for (let index = 0; index < 5; index++) {
    collectGarbage();
    const beforeHeap = process.memoryUsage().heapUsed;
    retainedScripts.push(new vm.Script(compilationSource, { filename: 'pages/index/index.js' }));
    collectGarbage();
    retainedHeapDeltas.push(process.memoryUsage().heapUsed - beforeHeap);
  }
  const retainedHeapDeltaBytes = median(retainedHeapDeltas);

  return {
    compileMedianMs: Number(median(timings).toFixed(3)),
    compileRuns: timings.length,
    astNodes,
    bundleModules,
      retainedCompileHeapDeltaBytes: retainedHeapDeltaBytes,
      retainedCompileHeapDeltaRuns: retainedHeapDeltas.length,
      heapDeltaMeasurable: typeof globalThis.gc === 'function',
      heapPeakBytes: null,
      heapPeakReason: 'Node has no continuous peak-heap API; retained heap delta is not a peak'
  };
}

function dataBytesFromEntries(entries) {
  const runtimeDataIds = new Set(['en_dict.txt', 'intonations.txt', 'lang__gmw__en-US.txt', 'phondata.txt', 'phonindex.txt', 'phontab.txt']);
  return entries.filter(entry => runtimeDataIds.has(path.basename(entry.name))).reduce((sum, entry) => sum + entry.uncompressedBytes, 0);
}

function actionReadBytes(manifest, entries) {
  const profile = manifest.config?.jspeakProfile;
  if (profile?.actionReadBytes !== undefined) return profile.actionReadBytes;
  return dataBytesFromEntries(entries);
}

export function benchmarkVelaStartup(rpk) {
  const rpkBytes = readFileSync(rpk);
  const entries = zipEntries(rpk);
  const totalUncompressedBytes = entries.reduce((sum, entry) => sum + entry.uncompressedBytes, 0);
  const totalCompressedBytes = entries.reduce((sum, entry) => sum + entry.compressedBytes, 0);
  const pageName = 'pages/index/index.js';
  const appName = 'app.js';
  const page = readZip(rpk, pageName);
  const app = readZip(rpk, appName);
  const manifest = JSON.parse(readZip(rpk, 'manifest.json').toString('utf8'));
  const profile = manifest.config?.jspeakProfile || null;
  const pageMetrics = compileMetrics(page.toString('utf8'));
  const appMetrics = compileMetrics(app.toString('utf8'));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    node: { version: process.version, arch: process.arch, platform: process.platform },
    rpk: {
      path: path.resolve(rpk),
      bytes: rpkBytes.length,
      sha256: sha256(rpkBytes),
      uncompressedBytes: totalUncompressedBytes,
      zipCompressedBytes: totalCompressedBytes,
      files: entries.length,
      parseSourceBytes: page.length + app.length,
      pageBundleBytes: page.length,
      appBundleBytes: app.length
    },
    manifest: {
      package: manifest.package,
      versionName: manifest.versionName,
      versionCode: manifest.versionCode,
      profile
    },
    startup: {
      launchFileReadBytes: 0,
      launchFileReadReason: 'Source audit: onInit creates session state only and does not call @system.file.readArrayBuffer',
      firstActionReadBytes: actionReadBytes(manifest, entries),
      ...pageMetrics,
      appCompileMedianMs: appMetrics.compileMedianMs,
      appAstNodes: appMetrics.astNodes,
      appBundleModules: appMetrics.bundleModules,
      appRetainedCompileHeapDeltaBytes: appMetrics.retainedCompileHeapDeltaBytes,
      heapPeakBytes: null,
      heapPeakReason: 'Node has no continuous peak-heap API; retained heap delta is not a peak'
    },
    measurement: {
      engine: 'Node/V8 vm.Script and acorn static analysis',
      limitation: 'These are host-side parse proxies, not QuickJS/Vela engine or device heap measurements'
    }
  };
}

export function benchmarkVelaBuildDirectory(directory) {
  const page = readFileSync(path.join(directory, 'pages/index/index.js'));
  const app = readFileSync(path.join(directory, 'app.js'));
  const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const profile = manifest.config?.jspeakProfile || null;
  const pageMetrics = compileMetrics(page.toString('utf8'));
  const appMetrics = compileMetrics(app.toString('utf8'));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    node: { version: process.version, arch: process.arch, platform: process.platform },
    buildDirectory: path.resolve(directory),
    manifest: {
      package: manifest.package,
      versionName: manifest.versionName,
      versionCode: manifest.versionCode,
      profile
    },
    startup: {
      parseSourceBytes: page.length + app.length,
      pageBundleBytes: page.length,
      appBundleBytes: app.length,
      ...pageMetrics,
      appCompileMedianMs: appMetrics.compileMedianMs,
      appAstNodes: appMetrics.astNodes,
      appBundleModules: appMetrics.bundleModules,
      appRetainedCompileHeapDeltaBytes: appMetrics.retainedCompileHeapDeltaBytes,
      heapPeakBytes: null,
      heapPeakReason: 'Node has no continuous peak-heap API; retained heap delta is not a peak'
    },
    measurement: {
      engine: 'Node/V8 vm.Script and acorn static analysis',
      limitation: 'These are host-side parse proxies, not QuickJS/Vela engine or device heap measurements'
    }
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (process.argv.length === 4 && process.argv[3] === '--build-directory') {
    console.log(JSON.stringify(benchmarkVelaBuildDirectory(process.argv[2]), null, 2));
  } else if (process.argv.length === 3) {
    console.log(JSON.stringify(benchmarkVelaStartup(process.argv[2]), null, 2));
  } else {
    throw new Error('Usage: node --expose-gc tools/perf/vela-startup-benchmark.mjs <rpk> | <build-directory> --build-directory');
  }
}
