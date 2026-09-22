import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEMO_EXAMPLE_IDS, DEMO_EXAMPLE_SET_VERSION, DEMO_EXAMPLE_TITLES } from '../../shared/demoExamples';
import { resolveRuntimePaths, type RuntimePathInput } from './runtimePaths';

export const DEMO_EXAMPLE_MARKER = '.dashboard-example.json';
type ExampleKind = 'run' | 'sensitivity';
interface ExampleEntry { kind: ExampleKind; id: string; relativePath: string }
interface ExampleIndex { schemaVersion: 1; exampleSetVersion: number; examples: ExampleEntry[] }
interface ExampleMarker { schemaVersion: 1; exampleSetVersion: number; kind: ExampleKind; id: string }

const normalized = (value: string) => value.trim().toLowerCase();
const runIds = new Set<string>([DEMO_EXAMPLE_IDS.policyRunId, DEMO_EXAMPLE_IDS.baselineRunId].map(normalized));
export function isDemoExampleRunId(id: string): boolean { return runIds.has(normalized(id)); }
export function isDemoExampleSensitivityId(id: string): boolean {
  return normalized(id) === normalized(DEMO_EXAMPLE_IDS.sensitivityExperimentId);
}

export function assertDemoExampleMutable(kind: ExampleKind, id: string): void {
  if ((kind === 'run' ? isDemoExampleRunId : isDemoExampleSensitivityId)(id)) {
    throw new Error(`"${id}" is used by a built-in example and is read-only.`);
  }
}

export function assertDemoExampleTitleAvailable(title: string | undefined): void {
  // Sensitivity titles pass through the existing filename sanitizer; reserve both spellings.
  const key = normalized(title ?? '').replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ');
  if (Object.values(DEMO_EXAMPLE_TITLES).some((value) =>
    normalized(value).replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ') === key)) {
    throw new Error(`"${title}" is used by a built-in example. Choose another name.`);
  }
}

export function assertDemoExampleJobMutable(jobRef: string): void {
  if (jobRef.startsWith('sensitivity:')) assertDemoExampleMutable('sensitivity', jobRef.slice('sensitivity:'.length));
  if (jobRef.startsWith('manual:')) assertDemoExampleMutable('run', jobRef.slice('manual:'.length));
}

function exampleDestination(pathsInput: RuntimePathInput, kind: ExampleKind, id: string): string {
  const paths = resolveRuntimePaths(pathsInput);
  return path.join(paths.resultsRoot, ...(kind === 'sensitivity' ? ['experiments', 'sensitivity'] : []), id);
}

function markerAt(destination: string): ExampleMarker | null {
  try {
    if (!fs.lstatSync(destination).isDirectory()) return null;
    return JSON.parse(fs.readFileSync(path.join(destination, DEMO_EXAMPLE_MARKER), 'utf8')) as ExampleMarker;
  } catch { return null; }
}

function pathEntryExists(destination: string): boolean {
  try { fs.lstatSync(destination); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function matchesMarker(marker: ExampleMarker | null, kind: ExampleKind, id: string): boolean {
  return marker?.schemaVersion === 1 && marker.kind === kind && marker.id === id;
}

export function isInstalledDemoExample(pathsInput: RuntimePathInput, kind: ExampleKind, id: string): boolean {
  if (!(kind === 'run' ? isDemoExampleRunId(id) : isDemoExampleSensitivityId(id))) return false;
  const marker = markerAt(exampleDestination(pathsInput, kind, id));
  return matchesMarker(marker, kind, id) && marker?.exampleSetVersion === DEMO_EXAMPLE_SET_VERSION;
}

function validateSourceTree(root: string): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error(`Unsupported example bundle entry: ${file}`);
    }
    if (entry.name === 'seeds' || entry.name === '.dashboard-managed-run.json') {
      throw new Error(`Uncurated example bundle entry: ${file}`);
    }
    if (entry.isDirectory()) validateSourceTree(file);
  }
}

/** Install once at server startup, before results or sensitivity state is loaded. */
export function seedDemoExamples(
  pathsInput: RuntimePathInput,
  log: (message: string) => void = console.warn
): { installed: string[]; skipped: string[] } {
  const paths = resolveRuntimePaths(pathsInput);
  const result = { installed: [] as string[], skipped: [] as string[] };
  const indexPath = path.join(paths.demoExamplesRoot, 'index.json');
  if (!fs.existsSync(indexPath)) {
    log('[demo-examples] Bundle is unavailable; examples were not installed.');
    return result;
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as ExampleIndex;
  if (index.schemaVersion !== 1 || index.exampleSetVersion !== DEMO_EXAMPLE_SET_VERSION || !Array.isArray(index.examples)) {
    throw new Error('Unsupported built-in example index.');
  }
  const seen = new Set<string>();
  for (const entry of index.examples) {
    const isKnown = entry.kind === 'run' ? isDemoExampleRunId(entry.id) : entry.kind === 'sensitivity' && isDemoExampleSensitivityId(entry.id);
    const expectedRelative = `${entry.kind === 'run' ? 'runs' : 'sensitivity'}/${entry.id}`;
    if (!isKnown || entry.id.includes('/') || entry.id.includes('\\') || entry.relativePath !== expectedRelative || seen.has(entry.id)) {
      throw new Error('Invalid or duplicate built-in example entry.');
    }
    seen.add(entry.id);
    const source = path.join(paths.demoExamplesRoot, entry.relativePath);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isDirectory()) {
      log(`[demo-examples] Missing source for ${entry.id}; skipped.`);
      result.skipped.push(entry.id);
      continue;
    }
    validateSourceTree(source);
    const destination = exampleDestination(paths, entry.kind, entry.id);
    const exists = pathEntryExists(destination);
    const marker = exists ? markerAt(destination) : null;
    if (exists && !matchesMarker(marker, entry.kind, entry.id)) {
      log(`[demo-examples] Preserving unmarked folder ${destination}; skipped.`);
      result.skipped.push(entry.id);
      continue;
    }
    if (marker?.exampleSetVersion === index.exampleSetVersion) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const staging = `${destination}.example-stage-${randomUUID()}`;
    try {
      fs.cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
      const nextMarker: ExampleMarker = { schemaVersion: 1, exampleSetVersion: index.exampleSetVersion, kind: entry.kind, id: entry.id };
      fs.writeFileSync(path.join(staging, DEMO_EXAMPLE_MARKER), `${JSON.stringify(nextMarker, null, 2)}\n`);
      if (exists) fs.rmSync(destination, { recursive: true });
      fs.renameSync(staging, destination);
      result.installed.push(entry.id);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  return result;
}
