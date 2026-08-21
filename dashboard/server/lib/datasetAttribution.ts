import fs from 'node:fs';
import { compareVersions } from './versioning';
import type { DatasetAttribution } from '../../shared/types';
import type { DashboardInputVersionHistoryEntry } from './dashboardInputVersionHistory';

interface ConfigEntryWithComment {
  value: string;
  comment: string;
}

const DATASET_TAG_REGISTRY: Record<string, { fullName: string; order: number }> = {
  was: { fullName: 'Wealth and Assets Survey', order: 10 },
  nmg: { fullName: 'NMG Survey of Household Finances (Bank of England)', order: 20 },
  boe: { fullName: 'Bank of England data series', order: 25 },
  psd: { fullName: 'Product Sales Database (Bank of England)', order: 30 },
  ppd: { fullName: 'Price Paid Data (HM Land Registry)', order: 40 },
  gov: { fullName: 'UK Government publications (Gov.uk / Parliament)', order: 50 },
  ons: { fullName: 'Office for National Statistics', order: 60 },
  lcfs: { fullName: 'Living Costs and Food Survey', order: 70 },
  ehs: { fullName: 'English Housing Survey', order: 80 },
  zoopla: { fullName: 'Zoopla listings data', order: 90 },
  cml: { fullName: 'Council of Mortgage Lenders data', order: 100 },
  moneyfacts: { fullName: 'Moneyfacts data', order: 110 },
  arla: { fullName: 'ARLA rental market reports', order: 120 },
  rpi: { fullName: 'Retail Price Index', order: 130 },
  'output-calibrated': { fullName: 'Output-calibrated campaign', order: 200 },
  // The version history tags the five unmeasurable behavioural parameters `output-calibration`.
  // Without this entry they fall through to `unknown` and render as "Unknown source" — the exact
  // opposite of what an analyst needs to know about them.
  'output-calibration': { fullName: 'Fitted to model output — not measured', order: 205 },
  'r8-first-campaign': { fullName: 'R8-first calibration campaign', order: 210 },
  unknown: { fullName: 'Unknown source', order: 999 }
};

const COMMENT_TAG_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  // The acronym must stay case-sensitive: a case-insensitive \bwas\b matches the English word,
  // so comments like "diagnostic fit was negative" were being attributed to the WAS survey.
  { tag: 'was', pattern: /[Ww]ealth and [Aa]ssets [Ss]urvey|\bWAS\b|calibration\/was\// },
  { tag: 'nmg', pattern: /\bnmg\b|nmg survey/i },
  { tag: 'boe', pattern: /\bboe\b|bank of england/i },
  { tag: 'psd', pattern: /\bpsd\b|product sales database/i },
  { tag: 'ppd', pattern: /price paid data|land registry/i },
  { tag: 'gov', pattern: /gov\.uk|public data|parliamentary|tax year|income tax/i },
  { tag: 'ons', pattern: /\bons\b|office for national statistics/i },
  { tag: 'lcfs', pattern: /\blcfs\b|living costs and food survey/i },
  { tag: 'ehs', pattern: /\behs\b|english housing survey/i },
  { tag: 'zoopla', pattern: /zoopla/i },
  { tag: 'cml', pattern: /\bcml\b|council of mortgage lenders/i },
  { tag: 'moneyfacts', pattern: /moneyfacts/i },
  { tag: 'arla', pattern: /\barla\b/i },
  { tag: 'rpi', pattern: /\brpi\b|retail price index/i }
];

const YEAR_RANGE_PATTERNS = [
  /(\d{4})\s*-\s*(\d{4})/,
  /(\d{4})\s*\/\s*(\d{4})/,
  /(\d{4})\s+to\s+(\d{4})/i
];

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function extractDatasetTags(comment: string, value: string): string[] {
  const tags: string[] = [];
  const text = `${comment}\n${value}`;

  for (const candidate of COMMENT_TAG_PATTERNS) {
    if (candidate.pattern.test(text)) {
      tags.push(candidate.tag);
    }
  }

  // WAS edition markers are often in file names and should be recognized even with ambiguous comments.
  if (/\bR8\b/i.test(value) || /\bW3\b/i.test(value)) {
    tags.push('was');
  }

  return unique(tags.map(normalizeTag)).filter((tag) => tag.length > 0);
}

function extractRange(text: string): string | null {
  for (const pattern of YEAR_RANGE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }
  }

  const quarterMatch = text.match(/\bQ[1-4]\s*(\d{4})\b/i) ?? text.match(/\b(\d{4})\s*Q[1-4]\b/i);
  if (quarterMatch) {
    return quarterMatch[1];
  }

  return null;
}

function extractYears(text: string): string[] {
  const matches = text.match(/\b(?:19|20)\d{2}\b/g) ?? [];
  return unique(matches).sort((left, right) => Number(left) - Number(right));
}

function extractSnippetNear(text: string, tokenPattern: RegExp): string | null {
  const match = tokenPattern.exec(text);
  if (!match || match.index === undefined) {
    return null;
  }
  const start = Math.max(0, match.index - 40);
  const end = Math.min(text.length, match.index + match[0].length + 120);
  return text.slice(start, end);
}

function inferWasEdition(value: string, comment: string): string | undefined {
  const text = `${value} ${comment}`;
  if (/\bR8\b/i.test(text) || /\bround 8\b/i.test(text)) {
    return 'Round 8';
  }
  if (/\bW3\b/i.test(text) || /\bwave 3\b/i.test(text)) {
    return 'Wave 3';
  }
  return undefined;
}

function inferWasYear(value: string, comment: string): string | undefined {
  const text = `${value} ${comment}`;
  if (/\bR8\b/i.test(text) || /\bround 8\b/i.test(text)) {
    return '2022';
  }
  if (/\bW3\b/i.test(text) || /\bwave 3\b/i.test(text)) {
    return '2012';
  }
  return undefined;
}

function inferYearForTag(tag: string, comment: string, value: string): string {
  if (tag === 'was') {
    return inferWasYear(value, comment) ?? 'Unknown';
  }
  if (tag === 'r8-first-campaign') {
    return '2022';
  }
  if (tag === 'output-calibrated' && /r8-first-campaign/i.test(comment)) {
    return '2022';
  }

  const fullText = `${comment}\n${value}`;
  const nearTokenPatternByTag: Record<string, RegExp | undefined> = {
    nmg: /\bnmg\b|bank of england/i,
    boe: /\bboe\b|bank of england/i,
    psd: /\bpsd\b|product sales database/i,
    ppd: /price paid data|land registry/i,
    gov: /gov\.uk|parliamentary|tax year|income tax/i,
    ons: /\bons\b|office for national statistics/i,
    lcfs: /\blcfs\b|living costs and food survey/i,
    ehs: /\behs\b|english housing survey/i,
    zoopla: /zoopla/i,
    cml: /\bcml\b|council of mortgage lenders/i,
    moneyfacts: /moneyfacts/i,
    arla: /\barla\b/i,
    rpi: /\brpi\b|retail price index/i
  };

  const nearPattern = nearTokenPatternByTag[tag];
  if (nearPattern) {
    const snippet = extractSnippetNear(fullText, nearPattern);
    if (snippet) {
      const ranged = extractRange(snippet);
      if (ranged) {
        return ranged;
      }
      const years = extractYears(snippet);
      if (years.length > 0) {
        return years[years.length - 1];
      }
    }
  }

  const ranged = extractRange(fullText);
  if (ranged) {
    return ranged;
  }
  const years = extractYears(fullText);
  if (years.length > 0) {
    return years[years.length - 1];
  }
  return 'Unknown';
}

function inferEditionForTag(tag: string, comment: string, value: string): string | undefined {
  if (tag === 'was') {
    return inferWasEdition(value, comment);
  }
  if (tag === 'r8-first-campaign') {
    return 'Round 8 campaign';
  }
  return undefined;
}

function sortAttributions(left: DatasetAttribution, right: DatasetAttribution): number {
  const leftOrder = DATASET_TAG_REGISTRY[left.tag]?.order ?? DATASET_TAG_REGISTRY.unknown.order;
  const rightOrder = DATASET_TAG_REGISTRY[right.tag]?.order ?? DATASET_TAG_REGISTRY.unknown.order;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  if (left.fullName !== right.fullName) {
    return left.fullName.localeCompare(right.fullName);
  }
  if (left.year !== right.year) {
    return left.year.localeCompare(right.year);
  }
  return (left.edition ?? '').localeCompare(right.edition ?? '');
}

export function parseConfigWithComments(configPath: string): Map<string, ConfigEntryWithComment> {
  const out = new Map<string, ConfigEntryWithComment>();
  const lines = fs.readFileSync(configPath, 'utf-8').split(/\r?\n/);
  let commentBlock: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      commentBlock = [];
      continue;
    }

    if (trimmed.startsWith('#')) {
      commentBlock.push(trimmed.replace(/^#\s?/, ''));
      continue;
    }

    const match = /^([A-Z0-9_]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const key = match[1];
    const raw = match[2].trim();
    const value = raw.replace(/^"|"$/g, '');
    out.set(key, {
      value,
      comment: commentBlock.join(' ')
    });
    commentBlock = [];
  }

  return out;
}

export function buildLatestSourceTagsByKey(
  dashboardInputVersionHistory: DashboardInputVersionHistoryEntry[],
  version: string
): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const entry of dashboardInputVersionHistory) {
    if (compareVersions(entry.snapshot_folder, version) > 0) {
      continue;
    }
    const tags = unique((entry.updated_data_sources ?? []).map(normalizeTag)).filter((tag) => tag.length > 0);
    for (const configKey of entry.config_parameters ?? []) {
      out.set(configKey, tags);
    }
  }

  return out;
}

interface ResolveDatasetAttributionsArgs {
  configKeys: string[];
  configDetails: Map<string, ConfigEntryWithComment>;
  fallbackTagsByKey: Map<string, string[]>;
}

export function resolveDatasetAttributions({
  configKeys,
  configDetails,
  fallbackTagsByKey
}: ResolveDatasetAttributionsArgs): DatasetAttribution[] {
  const attributions: DatasetAttribution[] = [];

  for (const key of configKeys) {
    const detail = configDetails.get(key);
    const comment = detail?.comment ?? '';
    const value = detail?.value ?? '';

    const inferredTags = extractDatasetTags(comment, value);
    const fallbackTags = fallbackTagsByKey.get(key) ?? [];
    const tags = inferredTags.length > 0 ? inferredTags : fallbackTags;
    const normalizedTags = tags.length > 0 ? tags : ['unknown'];

    for (const tag of normalizedTags) {
      const normalizedTag = normalizeTag(tag);
      const tagInfo = DATASET_TAG_REGISTRY[normalizedTag] ?? DATASET_TAG_REGISTRY.unknown;
      attributions.push({
        tag: normalizedTag,
        fullName: tagInfo.fullName,
        year: inferYearForTag(normalizedTag, comment, value),
        edition: inferEditionForTag(normalizedTag, comment, value),
        evidence: value ? `config:${key}=${value}` : `config:${key}`
      });
    }
  }

  const deduped = new Map<string, DatasetAttribution>();
  for (const attribution of attributions) {
    const key = `${attribution.fullName}|${attribution.year}|${attribution.edition ?? ''}`;
    if (!deduped.has(key)) {
      deduped.set(key, attribution);
    }
  }

  return [...deduped.values()].sort(sortAttributions);
}
