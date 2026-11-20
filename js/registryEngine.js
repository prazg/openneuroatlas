/**
 * OpenNeuroAtlas — Core Registry Engine
 *
 * Zero-dependency ES Module responsible for:
 *  - Parallel loading and indexing of schema + datasets/models/challenges collections
 *  - Weighted instant full-text search, multi-facet AND/OR filtering, and sorting
 *  - Disjunctive facet counts
 *  - Analytics aggregation (KPIs, Modality × Pathology Coverage Matrix, Access Tiers,
 *    Cohort Size Landscape, Release Timeline)
 *  - Algorithmic Open-Science Gap Detection (clickable insights + PR prefill payloads)
 *  - Schema-driven record validation (exact parity with tests/validate_registry.py)
 *
 * Design invariant: zero DOM access; pure data & computation.
 */

const RECORD_TYPE_MAP = Object.freeze({
  dataset: 'datasets',
  datasets: 'datasets',
  model: 'models',
  models: 'models',
  challenge: 'challenges',
  challenges: 'challenges',
});

const SINGULAR_TYPE_MAP = Object.freeze({
  datasets: 'dataset',
  models: 'model',
  challenges: 'challenge',
});

const ACCESS_OPENNESS_RANK = Object.freeze({
  'Open Access': 0,
  'Registration Required': 1,
  'Controlled DUA': 2,
});

const DEFAULT_FORBIDDEN_URL_HOSTS = Object.freeze([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'example.com',
  'example.org',
  'placeholder.com',
]);

const FORBIDDEN_URL_SUBSTRINGS = Object.freeze([
  'vertexaisearch',
  'grounding-api-redirect',
]);

const DEFAULT_ONCOLOGY_PATHOLOGIES = Object.freeze([
  'Glioma / GBM',
  'Brain Metastases',
  'Meningioma',
  'Pituitary & Sellar',
  'Pediatric Tumors',
  'Skull Base / Schwannoma',
]);

const PRIORITY_SURGICAL_INTERSECTIONS = Object.freeze([
  {
    modality: 'Surgical Video',
    pathology: 'Glioma / GBM',
    clinicalRationale:
      'Open annotated glioma resection video cohorts are essential for intraoperative phase recognition, margin localization, and tool tracking.',
  },
  {
    modality: 'Intra-Op Ultrasound',
    pathology: 'Pediatric Tumors',
    clinicalRationale:
      'Pediatric brain tumors face acute brain-shift and eloquence constraints yet lack open intraoperative ultrasound (iUS) validation cohorts.',
  },
  {
    modality: 'Intra-Op Ultrasound',
    pathology: 'Brain Metastases',
    clinicalRationale:
      'Subcortical metastasis resection relies heavily on neuronavigated iUS, but open paired MRI–iUS metastasis cohorts remain scarce.',
  },
  {
    modality: 'Optical / Fluorescence',
    pathology: 'Glioma / GBM',
    clinicalRationale:
      '5-ALA fluorescence, Raman histology, and hyperspectral optical imaging lack large open benchmark datasets for residual tumor detection.',
  },
  {
    modality: 'Surgical Video',
    pathology: 'Aneurysm & Vascular',
    clinicalRationale:
      'Microsurgical aneurysm clipping and bypass workflows lack open labeled video benchmarks for anatomy and clip-placement AI.',
  },
  {
    modality: 'Intra-Op Ultrasound',
    pathology: 'Meningioma',
    clinicalRationale:
      'Open intraoperative ultrasound meningioma cohorts are missing for evaluating cross-tumor brain-shift registration models.',
  },
  {
    modality: 'Surgical Video',
    pathology: 'Spine',
    clinicalRationale:
      'Open endoscopic and microscopic spine surgery video datasets remain sparse despite high global procedural volume.',
  },
  {
    modality: 'Optical / Fluorescence',
    pathology: 'Brain Metastases',
    clinicalRationale:
      'Optical and fluorescence-guided resection benchmarks for brain metastases are absent from public neuro-oncology repositories.',
  },
]);

const LOW_FIELD_REGEX =
  /\b(low[- ]field|ultra[- ]low[- ]field|portable mri|0\.064\s*t|0\.55\s*t|hyperfine|point[- ]of[- ]care mri)\b/i;

const AFRICA_LMIC_REGEX =
  /\b(africa|african|sub[- ]saharan|ssa\b|lmic|low[- ]and[- ]middle[- ]income|global south|brats[- ]africa|nigeria|kenya|uganda|ghana|ethiopia|south africa)\b/i;

const FACET_DEFINITIONS = Object.freeze([
  { stateKey: 'pathologies', field: 'pathologies', isArray: true, vocabKey: 'pathologies' },
  { stateKey: 'modalities', field: 'modalities', isArray: true, vocabKey: 'modalities' },
  { stateKey: 'clinicalPhases', field: 'clinicalPhases', isArray: true, vocabKey: 'clinicalPhases' },
  { stateKey: 'tasks', field: 'tasks', isArray: true, vocabKey: 'tasks' },
  { stateKey: 'annotations', field: 'annotations', isArray: true, vocabKey: 'annotations' },
  { stateKey: 'molecularMarkers', field: 'molecularMarkers', isArray: true, vocabKey: 'molecularMarkers' },
  { stateKey: 'accessTiers', field: 'accessTier', isArray: false, vocabKey: 'accessTiers' },
  { stateKey: 'platforms', field: 'platform', isArray: false, vocabKey: 'datasetPlatforms' },
  { stateKey: 'modelCategories', field: 'category', isArray: false, vocabKey: 'modelCategories' },
  { stateKey: 'challengeStatuses', field: 'status', isArray: false, vocabKey: 'challengeStatuses' },
  { stateKey: 'metrics', field: 'metrics', isArray: true, vocabKey: 'metrics' },
]);

/**
 * Normalize plural or singular record type identifier to canonical plural collection name.
 * @param {string} recordType
 * @returns {'datasets'|'models'|'challenges'|null}
 */
export function normalizeRecordType(recordType) {
  if (typeof recordType !== 'string') return null;
  return RECORD_TYPE_MAP[recordType.trim().toLowerCase()] || null;
}

/**
 * Infer canonical plural record type from an indexed or plain record object.
 * @param {object} record
 * @returns {'datasets'|'models'|'challenges'}
 */
function inferRecordType(record) {
  if (!record || typeof record !== 'object') return 'datasets';
  if (record._recordType && RECORD_TYPE_MAP[record._recordType]) {
    return RECORD_TYPE_MAP[record._recordType];
  }
  if (record._type && RECORD_TYPE_MAP[record._type]) {
    return RECORD_TYPE_MAP[record._type];
  }
  if ('repoUrl' in record || 'installSnippet' in record || 'weightsAvailable' in record) {
    return 'models';
  }
  if ('yearsActive' in record || 'organizer' in record || 'metrics' in record) {
    return 'challenges';
  }
  return 'datasets';
}

/**
 * Extract integer release / start year for sorting and timeline placement.
 * @param {object} record
 * @param {string} [recordType]
 * @returns {number|null}
 */
export function extractRecordYear(record, recordType) {
  if (!record || typeof record !== 'object') return null;
  if (typeof record._year === 'number' && Number.isFinite(record._year)) {
    return record._year;
  }
  if (typeof record.year === 'number' && Number.isFinite(record.year)) {
    return Math.trunc(record.year);
  }
  if (typeof record.yearsActive === 'string') {
    const match = record.yearsActive.trim().match(/^(\d{4})/);
    if (match) return parseInt(match[1], 10);
  }
  if (record.citation && typeof record.citation.year === 'number' && Number.isFinite(record.citation.year)) {
    return Math.trunc(record.citation.year);
  }
  // Keep recordType parameter acknowledged for callers passing both arguments
  void recordType;
  return null;
}

/**
 * Normalize values into a flat array of lowercase non-empty strings.
 * @param {Array<string|string[]|null|undefined>} inputs
 * @returns {string[]}
 */
function collectLowerStrings(inputs) {
  const out = [];
  for (const val of inputs) {
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.trim()) {
          out.push(item.trim().toLowerCase());
        }
      }
    } else if (typeof val === 'string' && val.trim()) {
      out.push(val.trim().toLowerCase());
    }
  }
  return out;
}

/**
 * Build pre-lowercased weighted search buckets for instant full-text search.
 * @param {object} record
 * @returns {{ tier1: string[], tier2: string[], tier3: string[], tier1Text: string, tier2Text: string, tier3Text: string }}
 */
function buildSearchFields(record) {
  const tier1 = collectLowerStrings([record.id, record.shortName, record.name]);
  const tier2 = collectLowerStrings([
    record.pathologies,
    record.modalities,
    record.tasks,
    record.molecularMarkers,
    record.annotations,
    record.clinicalPhases,
    record.metrics,
    record.architecture,
    record.organizer,
    record.platform,
    record.category,
    record.accessTier,
    record.status,
  ]);
  const citation = record.citation && typeof record.citation === 'object' ? record.citation : {};
  const tier3 = collectLowerStrings([
    record.highlights,
    record.limitations,
    record.license,
    record.openSourceLicense,
    record.framework,
    record.cohortDisplay,
    record.yearsActive,
    citation.authors,
    citation.title,
    citation.venue,
    citation.doi,
    citation.bibtexKey,
  ]);

  return {
    tier1,
    tier2,
    tier3,
    tier1Text: tier1.join(' '),
    tier2Text: tier2.join(' '),
    tier3Text: tier3.join(' '),
  };
}

/**
 * Attach non-enumerable indexing metadata (_type, _recordType, _year, _searchFields) to a record.
 * Non-enumerable properties keep JSON.stringify(record) and Object.keys(record) 100% schema-pure.
 * @param {object} record
 * @param {string} recordType
 * @returns {object}
 */
export function indexRecord(record, recordType) {
  const pluralType = normalizeRecordType(recordType) || inferRecordType(record);
  const singularType = SINGULAR_TYPE_MAP[pluralType];
  const year = extractRecordYear(record, pluralType);
  const searchFields = buildSearchFields(record);

  Object.defineProperties(record, {
    _type: { value: singularType, enumerable: false, configurable: true, writable: false },
    _recordType: { value: pluralType, enumerable: false, configurable: true, writable: false },
    _year: { value: year, enumerable: false, configurable: true, writable: false },
    _searchFields: { value: searchFields, enumerable: false, configurable: true, writable: false },
  });

  return record;
}

/**
 * Normalize a relative or absolute base path to always end with '/'.
 * @param {string} [basePath='./']
 * @returns {string}
 */
function normalizeBasePath(basePath = './') {
  if (typeof basePath !== 'string') return './';
  const trimmed = basePath.trim();
  if (!trimmed || trimmed === '.') return './';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * Fetch and parse a JSON file with descriptive error reporting.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error fetching ${url}: ${reason}`);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  try {
    return await response.json();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${url}: ${reason}`);
  }
}

/**
 * Unwrap a registry file envelope (or fallback plain array).
 * @param {any} payload
 * @param {'datasets'|'models'|'challenges'} expectedType
 * @returns {{ schemaVersion: string|null, recordType: string, lastUpdated: string|null, records: object[] }}
 */
function unwrapEnvelope(payload, expectedType) {
  if (Array.isArray(payload)) {
    return {
      schemaVersion: null,
      recordType: expectedType,
      lastUpdated: null,
      records: payload,
    };
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.records)) {
    return {
      schemaVersion: typeof payload.schemaVersion === 'string' ? payload.schemaVersion : null,
      recordType: typeof payload.recordType === 'string' ? payload.recordType : expectedType,
      lastUpdated: typeof payload.lastUpdated === 'string' ? payload.lastUpdated : null,
      records: payload.records,
    };
  }
  throw new Error(`Malformed registry payload for "${expectedType}": expected object with "records" array.`);
}

/**
 * Load schema and all three registry collections in parallel, returning indexed structures.
 * @param {string} [basePath='./']
 * @returns {Promise<{
 *   schema: object,
 *   meta: { schemaVersion: string, lastUpdated: string|null, envelopes: object },
 *   datasets: object[],
 *   models: object[],
 *   challenges: object[],
 *   allRecords: object[],
 *   byId: Map<string, object>
 * }>}
 */
export async function loadRegistry(basePath = './') {
  const prefix = normalizeBasePath(basePath);

  const [schema, datasetsRaw, modelsRaw, challengesRaw] = await Promise.all([
    fetchJson(`${prefix}schemas/registry-schema.json`),
    fetchJson(`${prefix}data/datasets.json`),
    fetchJson(`${prefix}data/models.json`),
    fetchJson(`${prefix}data/challenges.json`),
  ]);

  const dsEnv = unwrapEnvelope(datasetsRaw, 'datasets');
  const mdEnv = unwrapEnvelope(modelsRaw, 'models');
  const chEnv = unwrapEnvelope(challengesRaw, 'challenges');

  const datasets = dsEnv.records.map((rec) => indexRecord(rec, 'datasets'));
  const models = mdEnv.records.map((rec) => indexRecord(rec, 'models'));
  const challenges = chEnv.records.map((rec) => indexRecord(rec, 'challenges'));

  const allRecords = [...datasets, ...models, ...challenges];
  const byId = new Map();
  for (const rec of allRecords) {
    if (rec && typeof rec.id === 'string' && rec.id) {
      byId.set(rec.id, rec);
    }
  }

  const updateDates = [dsEnv.lastUpdated, mdEnv.lastUpdated, chEnv.lastUpdated]
    .filter((d) => typeof d === 'string' && d.trim() !== '')
    .sort();

  const meta = {
    schemaVersion: schema?.schemaVersion || dsEnv.schemaVersion || '1.0.0',
    lastUpdated: updateDates.length > 0 ? updateDates[updateDates.length - 1] : null,
    envelopes: {
      datasets: {
        schemaVersion: dsEnv.schemaVersion,
        lastUpdated: dsEnv.lastUpdated,
        count: datasets.length,
      },
      models: {
        schemaVersion: mdEnv.schemaVersion,
        lastUpdated: mdEnv.lastUpdated,
        count: models.length,
      },
      challenges: {
        schemaVersion: chEnv.schemaVersion,
        lastUpdated: chEnv.lastUpdated,
        count: challenges.length,
      },
    },
  };

  return {
    schema,
    meta,
    datasets,
    models,
    challenges,
    allRecords,
    byId,
  };
}

/**
 * Create a clean default filter state compatible with both Explorer UI and filterItems().
 * @returns {object}
 */
export function createInitialFilterState() {
  return {
    tab: 'all',
    query: '',
    pathologies: [],
    modalities: [],
    clinicalPhases: [],
    tasks: [],
    annotations: [],
    molecularMarkers: [],
    accessTiers: [],
    platforms: [],
    modelCategories: [],
    category: [],
    challengeStatuses: [],
    metrics: [],
    hasMolecular: false,
    hasLongitudinal: false,
    hasOpenWeights: false,
    weightsOnly: false,
    openAccessOnly: false,
    year: null,
    yearMin: null,
    yearMax: null,
    cohortMin: null,
    cohortMax: null,
    sortBy: 'year-desc',
  };
}

/**
 * Coerce a facet value (string, Set, Array, or null/undefined) into a lowercase string list.
 * @param {any} value
 * @returns {string[]}
 */
function toLowerList(value) {
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    return trimmed ? [trimmed] : [];
  }
  const iterable = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : [];
  const out = [];
  for (const entry of iterable) {
    if (typeof entry === 'string' && entry.trim()) {
      out.push(entry.trim().toLowerCase());
    }
  }
  return out;
}

/**
 * Check array-valued record field against selected facet values (OR within facet by default, optional AND).
 * @param {any} recordField
 * @param {string[]} selectedLower
 * @param {'or'|'and'} [withinMode='or']
 * @returns {boolean}
 */
function matchesArrayFacet(recordField, selectedLower, withinMode = 'or') {
  if (selectedLower.length === 0) return true;
  if (!Array.isArray(recordField) || recordField.length === 0) return false;
  const recordSet = new Set(
    recordField
      .filter((v) => typeof v === 'string')
      .map((v) => v.trim().toLowerCase())
  );
  if (withinMode === 'and') {
    return selectedLower.every((val) => recordSet.has(val));
  }
  return selectedLower.some((val) => recordSet.has(val));
}

/**
 * Check scalar string record field against selected facet values.
 * @param {any} recordField
 * @param {string[]} selectedLower
 * @returns {boolean}
 */
function matchesScalarFacet(recordField, selectedLower) {
  if (selectedLower.length === 0) return true;
  if (typeof recordField !== 'string' || !recordField.trim()) return false;
  const valueLower = recordField.trim().toLowerCase();
  return selectedLower.includes(valueLower);
}

/**
 * Escape a literal string for RegExp construction.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute weighted search relevance score. Returns 0 if any token fails to match (boolean AND).
 * @param {object} item
 * @param {string} fullQuery
 * @param {string[]} tokens
 * @returns {number}
 */
function scoreSearchMatch(item, fullQuery, tokens) {
  if (tokens.length === 0) return 0;
  const sf = item._searchFields || buildSearchFields(item);

  let score = 0;

  // Full-phrase boost on primary identity fields
  for (const t1 of sf.tier1) {
    if (t1 === fullQuery) {
      score += 150;
      break;
    }
    if (t1.startsWith(fullQuery)) {
      score += 80;
      break;
    }
  }

  for (const token of tokens) {
    let tokenMatched = false;
    let tokenBest = 0;

    for (const t1 of sf.tier1) {
      if (t1 === token) {
        tokenMatched = true;
        tokenBest = Math.max(tokenBest, 100);
      } else if (t1.startsWith(token)) {
        tokenMatched = true;
        tokenBest = Math.max(tokenBest, 50);
      } else if (t1.includes(token)) {
        tokenMatched = true;
        const boundary = new RegExp(`(?:^|[\\s\\-/(_])${escapeRegex(token)}`);
        tokenBest = Math.max(tokenBest, boundary.test(t1) ? 40 : 30);
      }
    }

    if (sf.tier2Text.includes(token)) {
      tokenMatched = true;
      const exactTier2 = sf.tier2.some((v) => v === token);
      tokenBest = Math.max(tokenBest, exactTier2 ? 25 : 15);
    }

    if (sf.tier3Text.includes(token)) {
      tokenMatched = true;
      tokenBest = Math.max(tokenBest, 5);
    }

    if (!tokenMatched) return 0;
    score += tokenBest;
  }

  return score;
}

/**
 * Normalize camelCase and kebab-case sort keys to canonical internal sort mode.
 * @param {string|undefined|null} sortRaw
 * @param {boolean} hasSearchQuery
 * @returns {string}
 */
function normalizeSortKey(sortRaw, hasSearchQuery) {
  if (!sortRaw || typeof sortRaw !== 'string') {
    return hasSearchQuery ? 'relevance' : 'yearDesc';
  }
  const key = sortRaw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  switch (key) {
    case 'relevance':
      return 'relevance';
    case 'yeardesc':
    case 'newest':
      return 'yearDesc';
    case 'yearasc':
    case 'oldest':
      return 'yearAsc';
    case 'cohortdesc':
    case 'largest':
      return 'cohortDesc';
    case 'cohortasc':
    case 'smallest':
      return 'cohortAsc';
    case 'nameasc':
    case 'az':
      return 'nameAsc';
    case 'namedesc':
    case 'za':
      return 'nameDesc';
    case 'openness':
    case 'access':
      return 'openness';
    default:
      return hasSearchQuery ? 'relevance' : 'yearDesc';
  }
}

/**
 * Parse an optional numeric bound from filter state.
 * @param {any} value
 * @returns {number|null}
 */
function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Filter and sort registry items using full-text search, multi-facet AND/OR filters,
 * boolean clinical/open-science toggles, numeric ranges, and deterministic sorting.
 *
 * @param {object[]} items
 * @param {object} [queryState={}]
 * @returns {object[]}
 */
export function filterItems(items, queryState = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const qs = queryState && typeof queryState === 'object' ? queryState : {};

  const rawQuery = String(qs.query ?? qs.search ?? qs.q ?? '').trim().toLowerCase();
  const tokens = rawQuery ? rawQuery.split(/\s+/).filter(Boolean) : [];
  const withinMode = qs.withinFacetMode === 'and' ? 'and' : 'or';

  const rawTab = String(qs.tab ?? qs.activeTab ?? 'all').trim().toLowerCase();
  const targetType = rawTab && rawTab !== 'all' ? normalizeRecordType(rawTab) : null;

  const selPathologies = toLowerList(qs.pathologies);
  const selModalities = toLowerList(qs.modalities);
  const selClinicalPhases = toLowerList(qs.clinicalPhases);
  const selTasks = toLowerList(qs.tasks);
  const selAnnotations = toLowerList(qs.annotations);
  const selMolecularMarkers = toLowerList(qs.molecularMarkers);
  const selAccessTiers = toLowerList(qs.accessTiers ?? qs.accessTier);
  const selPlatforms = toLowerList(qs.platforms ?? qs.platform);
  const selCategories = [
    ...toLowerList(qs.category),
    ...toLowerList(qs.categories),
    ...toLowerList(qs.modelCategories),
  ];
  const selStatuses = [
    ...toLowerList(qs.challengeStatuses),
    ...toLowerList(qs.statuses),
    ...toLowerList(qs.status),
  ];
  const selMetrics = toLowerList(qs.metrics);

  const requireMolecular = Boolean(qs.hasMolecular);
  const requireLongitudinal = Boolean(qs.hasLongitudinal);
  const requireOpenWeights = Boolean(qs.hasOpenWeights || qs.weightsOnly);
  const requireOpenAccess = Boolean(qs.openAccessOnly);

  const exactYear = parseOptionalNumber(qs.year);
  const yearMin = parseOptionalNumber(qs.yearMin);
  const yearMax = parseOptionalNumber(qs.yearMax);
  const cohortMin = parseOptionalNumber(qs.cohortMin);
  const cohortMax = parseOptionalNumber(qs.cohortMax);

  const matched = [];

  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    if (!item || typeof item !== 'object') continue;

    if (targetType && inferRecordType(item) !== targetType) continue;

    if (!matchesArrayFacet(item.pathologies, selPathologies, withinMode)) continue;
    if (!matchesArrayFacet(item.modalities, selModalities, withinMode)) continue;
    if (!matchesArrayFacet(item.clinicalPhases, selClinicalPhases, withinMode)) continue;
    if (!matchesArrayFacet(item.tasks, selTasks, withinMode)) continue;
    if (!matchesArrayFacet(item.annotations, selAnnotations, withinMode)) continue;
    if (!matchesArrayFacet(item.molecularMarkers, selMolecularMarkers, withinMode)) continue;
    if (!matchesScalarFacet(item.accessTier, selAccessTiers)) continue;
    if (!matchesScalarFacet(item.platform, selPlatforms)) continue;
    if (!matchesScalarFacet(item.category, selCategories)) continue;
    if (!matchesScalarFacet(item.status, selStatuses)) continue;
    if (!matchesArrayFacet(item.metrics, selMetrics, withinMode)) continue;

    if (requireMolecular) {
      if (!Array.isArray(item.molecularMarkers) || item.molecularMarkers.length === 0) continue;
    }
    if (requireLongitudinal) {
      if (
        !Array.isArray(item.clinicalPhases) ||
        !item.clinicalPhases.some((p) => typeof p === 'string' && p.toLowerCase() === 'longitudinal')
      ) {
        continue;
      }
    }
    if (requireOpenWeights && item.weightsAvailable !== true) continue;
    if (requireOpenAccess && item.accessTier !== 'Open Access') continue;

    const itemYear = extractRecordYear(item);
    if (exactYear !== null && itemYear !== exactYear) continue;
    if (yearMin !== null && (itemYear === null || itemYear < yearMin)) continue;
    if (yearMax !== null && (itemYear === null || itemYear > yearMax)) continue;

    const cohortSize =
      typeof item.cohortSize === 'number' && Number.isFinite(item.cohortSize) ? item.cohortSize : null;
    if (cohortMin !== null && (cohortSize === null || cohortSize < cohortMin)) continue;
    if (cohortMax !== null && (cohortSize === null || cohortSize > cohortMax)) continue;

    let score = 0;
    if (tokens.length > 0) {
      score = scoreSearchMatch(item, rawQuery, tokens);
      if (score <= 0) continue;
    }

    const opennessRank =
      typeof item.accessTier === 'string' && item.accessTier in ACCESS_OPENNESS_RANK
        ? ACCESS_OPENNESS_RANK[item.accessTier]
        : 3;

    matched.push({
      item,
      score,
      year: itemYear,
      cohort: cohortSize,
      name: String(item.name || item.shortName || item.id || '').toLowerCase(),
      opennessRank,
      idx,
    });
  }

  const sortMode = normalizeSortKey(qs.sortBy ?? qs.sort, tokens.length > 0);

  const cmpYearDesc = (a, b) => {
    if (a.year === b.year) return 0;
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return b.year - a.year;
  };
  const cmpYearAsc = (a, b) => {
    if (a.year === b.year) return 0;
    if (a.year === null) return 1;
    if (b.year === null) return -1;
    return a.year - b.year;
  };
  const cmpCohortDesc = (a, b) => {
    if (a.cohort === b.cohort) return 0;
    if (a.cohort === null) return 1;
    if (b.cohort === null) return -1;
    return b.cohort - a.cohort;
  };
  const cmpCohortAsc = (a, b) => {
    if (a.cohort === b.cohort) return 0;
    if (a.cohort === null) return 1;
    if (b.cohort === null) return -1;
    return a.cohort - b.cohort;
  };
  const cmpNameAsc = (a, b) => a.name.localeCompare(b.name);

  matched.sort((a, b) => {
    let diff = 0;
    switch (sortMode) {
      case 'relevance':
        diff = b.score - a.score || cmpYearDesc(a, b) || cmpNameAsc(a, b);
        break;
      case 'yearDesc':
        diff = cmpYearDesc(a, b) || cmpCohortDesc(a, b) || cmpNameAsc(a, b);
        break;
      case 'yearAsc':
        diff = cmpYearAsc(a, b) || cmpNameAsc(a, b);
        break;
      case 'cohortDesc':
        diff = cmpCohortDesc(a, b) || cmpYearDesc(a, b) || cmpNameAsc(a, b);
        break;
      case 'cohortAsc':
        diff = cmpCohortAsc(a, b) || cmpYearDesc(a, b) || cmpNameAsc(a, b);
        break;
      case 'nameAsc':
        diff = cmpNameAsc(a, b) || cmpYearDesc(a, b);
        break;
      case 'nameDesc':
        diff = cmpNameAsc(b, a) || cmpYearDesc(a, b);
        break;
      case 'openness':
        diff = a.opennessRank - b.opennessRank || cmpYearDesc(a, b) || cmpNameAsc(a, b);
        break;
      default:
        diff = cmpYearDesc(a, b) || cmpNameAsc(a, b);
        break;
    }
    return diff || a.idx - b.idx;
  });

  return matched.map((entry) => entry.item);
}

/**
 * Alias for filterItems matching ARCHITECTURE.md Section 5.1.
 * @param {object[]} records
 * @param {object} [filterState={}]
 * @returns {object[]}
 */
export function filterAndSortRecords(records, filterState = {}) {
  return filterItems(records, filterState);
}

/**
 * Compute disjunctive facet counts: for each facet F, counts reflect all active filters EXCEPT F.
 * @param {object[]} records
 * @param {object} [filterState={}]
 * @param {object|null} [schema=null]
 * @returns {object}
 */
export function computeFacetCounts(records, filterState = {}, schema = null) {
  const safeRecords = Array.isArray(records) ? records : [];
  const baseState = filterState && typeof filterState === 'object' ? filterState : {};
  const vocabularies = schema?.vocabularies || {};

  // Tab counts with tab filter relaxed
  const tabRelaxed = filterItems(safeRecords, { ...baseState, tab: 'all', activeTab: 'all' });
  const tabs = { all: tabRelaxed.length, datasets: 0, models: 0, challenges: 0 };
  for (const rec of tabRelaxed) {
    const rType = inferRecordType(rec);
    tabs[rType] = (tabs[rType] || 0) + 1;
  }

  const result = { tabs };

  for (const facet of FACET_DEFINITIONS) {
    const relaxedState = { ...baseState, [facet.stateKey]: [] };
    if (facet.stateKey === 'modelCategories') {
      relaxedState.category = [];
      relaxedState.categories = [];
    } else if (facet.stateKey === 'platforms') {
      relaxedState.platform = [];
    } else if (facet.stateKey === 'accessTiers') {
      relaxedState.accessTier = [];
    } else if (facet.stateKey === 'challengeStatuses') {
      relaxedState.statuses = [];
      relaxedState.status = [];
    }

    const candidates = filterItems(safeRecords, relaxedState);
    const counts = {};

    // Seed canonical vocabulary terms with 0 so UI displays full filter taxonomy
    if (facet.stateKey === 'platforms') {
      const dsPlats = Array.isArray(vocabularies.datasetPlatforms) ? vocabularies.datasetPlatforms : [];
      const chPlats = Array.isArray(vocabularies.challengePlatforms) ? vocabularies.challengePlatforms : [];
      for (const term of [...dsPlats, ...chPlats]) {
        counts[term] = 0;
      }
    } else if (Array.isArray(vocabularies[facet.vocabKey])) {
      for (const term of vocabularies[facet.vocabKey]) {
        counts[term] = 0;
      }
    }

    for (const rec of candidates) {
      if (facet.isArray) {
        const vals = rec[facet.field];
        if (!Array.isArray(vals)) continue;
        const seen = new Set();
        for (const val of vals) {
          if (typeof val === 'string' && !seen.has(val)) {
            seen.add(val);
            counts[val] = (counts[val] || 0) + 1;
          }
        }
      } else {
        const val = rec[facet.field];
        if (typeof val === 'string' && val) {
          counts[val] = (counts[val] || 0) + 1;
        }
      }
    }

    result[facet.stateKey] = counts;
  }

  // Boolean toggle counts (disjunctive per toggle)
  const molRelaxed = filterItems(safeRecords, { ...baseState, hasMolecular: false });
  const longRelaxed = filterItems(safeRecords, { ...baseState, hasLongitudinal: false });
  const weightsRelaxed = filterItems(safeRecords, {
    ...baseState,
    hasOpenWeights: false,
    weightsOnly: false,
  });
  const oaRelaxed = filterItems(safeRecords, { ...baseState, openAccessOnly: false });

  result.toggles = {
    hasMolecular: molRelaxed.filter(
      (r) => Array.isArray(r.molecularMarkers) && r.molecularMarkers.length > 0
    ).length,
    hasLongitudinal: longRelaxed.filter(
      (r) => Array.isArray(r.clinicalPhases) && r.clinicalPhases.includes('Longitudinal')
    ).length,
    hasOpenWeights: weightsRelaxed.filter((r) => r.weightsAvailable === true).length,
    openAccessOnly: oaRelaxed.filter((r) => r.accessTier === 'Open Access').length,
  };

  return result;
}

/**
 * Derive ordered unique axis values from schema vocabularies or record arrays.
 * @param {object|null} schema
 * @param {string} vocabKey
 * @param {object[]} allRecords
 * @param {string} field
 * @returns {string[]}
 */
function resolveAxisValues(schema, vocabKey, allRecords, field) {
  const fromSchema = schema?.vocabularies?.[vocabKey];
  if (Array.isArray(fromSchema) && fromSchema.length > 0) {
    return [...fromSchema];
  }
  const seen = new Set();
  for (const rec of allRecords) {
    const vals = rec?.[field];
    if (Array.isArray(vals)) {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim()) seen.add(v);
      }
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

/**
 * Detect algorithmic open-science gaps across modalities, pathologies, access tiers,
 * clinical phases, biomarkers, benchmarks, and global/low-field equity.
 *
 * @param {object} analytics
 * @param {object} registryOrCollections
 * @returns {Array<object>}
 */
export function detectOpenScienceGaps(analytics, registryOrCollections = {}) {
  const datasets = Array.isArray(registryOrCollections?.datasets) ? registryOrCollections.datasets : [];
  const challenges = Array.isArray(registryOrCollections?.challenges) ? registryOrCollections.challenges : [];
  const schema = registryOrCollections?.schema || null;
  const matrix = analytics?.coverageMatrix;

  if (!matrix || !matrix.byPathology) return [];

  const oncologyPathologies =
    Array.isArray(schema?.suggestions?.oncologyPathologies) &&
    schema.suggestions.oncologyPathologies.length > 0
      ? schema.suggestions.oncologyPathologies
      : DEFAULT_ONCOLOGY_PATHOLOGIES;

  const gaps = [];
  const seenIds = new Set();

  const pushGap = (gap) => {
    if (!gap || !gap.id || seenIds.has(gap.id)) return;
    seenIds.add(gap.id);
    gaps.push(gap);
  };

  const slugify = (text) =>
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  // 1. High-priority intraoperative & surgical modality blind spots
  let criticalSurgicalAdded = 0;
  for (const target of PRIORITY_SURGICAL_INTERSECTIONS) {
    const cell = matrix.byPathology[target.pathology]?.[target.modality];
    if (!cell) continue;
    if (cell.datasets === 0 && criticalSurgicalAdded < 5) {
      criticalSurgicalAdded += 1;
      pushGap({
        id: `gap-surgical-${slugify(target.modality)}-${slugify(target.pathology)}`,
        category: 'Critical Gap',
        severity: 'critical',
        severityRank: 1,
        title: `No public ${target.modality} datasets for ${target.pathology}`,
        description: target.clinicalRationale,
        metricLabel: '0 datasets',
        modality: target.modality,
        pathology: target.pathology,
        datasetCount: 0,
        filterPayload: {
          tab: 'datasets',
          pathologies: [target.pathology],
          modalities: [target.modality],
        },
        prefillPayload: {
          recordType: 'datasets',
          pathologies: [target.pathology],
          modalities: [target.modality],
          clinicalPhases: ['Intra-Op'],
        },
      });
    } else if (cell.datasets === 1 && criticalSurgicalAdded < 5) {
      criticalSurgicalAdded += 1;
      pushGap({
        id: `gap-surgical-sparse-${slugify(target.modality)}-${slugify(target.pathology)}`,
        category: 'Sparse Coverage',
        severity: 'high',
        severityRank: 2,
        title: `Single ${target.modality} cohort for ${target.pathology}`,
        description: `${target.clinicalRationale} Currently only 1 dataset exists — zero independent external validation cohort.`,
        metricLabel: '1 dataset',
        modality: target.modality,
        pathology: target.pathology,
        datasetCount: 1,
        filterPayload: {
          tab: 'datasets',
          pathologies: [target.pathology],
          modalities: [target.modality],
        },
        prefillPayload: {
          recordType: 'datasets',
          pathologies: [target.pathology],
          modalities: [target.modality],
          clinicalPhases: ['Intra-Op'],
        },
      });
    }
  }

  // 2. Low-field MRI & Sub-Saharan Africa / LMIC global equity gap
  if (datasets.length > 0) {
    const lowFieldIds = [];
    const africaIds = [];
    for (const ds of datasets) {
      const text = [ds.name, ds.shortName, ds.highlights, ds.limitations].filter(Boolean).join(' ');
      if (LOW_FIELD_REGEX.test(text)) lowFieldIds.push(ds.id);
      if (AFRICA_LMIC_REGEX.test(text)) africaIds.push(ds.id);
    }

    if (lowFieldIds.length <= 1 || africaIds.length <= 1) {
      const combinedCount = new Set([...lowFieldIds, ...africaIds]).size;
      const severity = combinedCount === 0 ? 'critical' : 'high';
      pushGap({
        id: 'gap-equity-low-field-africa',
        category: 'Equity / Domain-Shift Gap',
        severity,
        severityRank: severity === 'critical' ? 1 : 2,
        title: 'Under-represented Low-Field MRI & Sub-Saharan Africa / LMIC cohorts',
        description: `Only ${africaIds.length} of ${datasets.length} datasets cover Sub-Saharan African / LMIC populations and ${lowFieldIds.length} cover low-field / portable MRI. Most neuro-AI models remain biased toward high-field (1.5T–3T) Western tertiary centers.`,
        metricLabel: `${africaIds.length} Africa/LMIC · ${lowFieldIds.length} Low-Field`,
        modality: 'Structural MRI',
        pathology: 'Glioma / GBM',
        datasetCount: combinedCount,
        filterPayload: {
          tab: 'datasets',
          query: africaIds.length > 0 ? 'Africa' : '',
        },
        prefillPayload: {
          recordType: 'datasets',
          modalities: ['Structural MRI'],
          pathologies: ['Glioma / GBM'],
        },
      });
    }
  }

  // 3. Access-barrier bottlenecks (pathologies with datasets > 0 but 0 Open Access datasets)
  let accessBottlenecksAdded = 0;
  for (const pathology of matrix.pathologies) {
    if (pathology === 'Multi-Pathology') continue;
    const matchingDs = datasets.filter(
      (d) => Array.isArray(d.pathologies) && d.pathologies.includes(pathology)
    );
    if (matchingDs.length === 0) continue;
    const openAccessDs = matchingDs.filter((d) => d.accessTier === 'Open Access');
    if (openAccessDs.length === 0 && accessBottlenecksAdded < 3) {
      accessBottlenecksAdded += 1;
      pushGap({
        id: `gap-access-${slugify(pathology)}`,
        category: 'Access Bottleneck',
        severity: 'high',
        severityRank: 2,
        title: `Zero direct Open-Access datasets for ${pathology}`,
        description: `All ${matchingDs.length} cataloged ${pathology} dataset${matchingDs.length === 1 ? '' : 's'} require account registration or controlled institutional DUA approval, slowing reproducible benchmarking.`,
        metricLabel: `0 / ${matchingDs.length} Open Access`,
        modality: null,
        pathology,
        datasetCount: matchingDs.length,
        filterPayload: {
          tab: 'datasets',
          pathologies: [pathology],
        },
        prefillPayload: {
          recordType: 'datasets',
          pathologies: [pathology],
        },
      });
    }
  }

  // 4. Perioperative clinical-phase gaps across oncology pathologies
  let phaseGapsAdded = 0;
  const criticalPhases = ['Intra-Op', 'Early Post-Op', 'Longitudinal'];
  for (const pathology of oncologyPathologies) {
    const matchingDs = datasets.filter(
      (d) => Array.isArray(d.pathologies) && d.pathologies.includes(pathology)
    );
    if (matchingDs.length === 0) continue;
    const missingPhases = criticalPhases.filter(
      (phase) =>
        !matchingDs.some(
          (d) => Array.isArray(d.clinicalPhases) && d.clinicalPhases.includes(phase)
        )
    );
    if (missingPhases.length > 0 && phaseGapsAdded < 3) {
      phaseGapsAdded += 1;
      pushGap({
        id: `gap-phase-${slugify(pathology)}`,
        category: 'Phase Gap',
        severity: missingPhases.length >= 2 ? 'high' : 'medium',
        severityRank: missingPhases.length >= 2 ? 2 : 3,
        title: `Perioperative phase gaps in ${pathology}`,
        description: `Cataloged ${pathology} datasets (${matchingDs.length}) have zero coverage for: ${missingPhases.join(', ')}. Longitudinal and early post-op cohorts are crucial for resection-cavity and recurrence modeling.`,
        metricLabel: `Missing ${missingPhases.join(' + ')}`,
        modality: null,
        pathology,
        datasetCount: 0,
        filterPayload: {
          tab: 'datasets',
          pathologies: [pathology],
        },
        prefillPayload: {
          recordType: 'datasets',
          pathologies: [pathology],
          clinicalPhases: [missingPhases[0]],
        },
      });
    }
  }

  // 5. Biomarker & open-benchmark gaps
  let biomarkerGapsAdded = 0;
  for (const pathology of oncologyPathologies) {
    const matchingDs = datasets.filter(
      (d) => Array.isArray(d.pathologies) && d.pathologies.includes(pathology)
    );
    if (matchingDs.length === 0) continue;
    const hasMolecular = matchingDs.some(
      (d) => Array.isArray(d.molecularMarkers) && d.molecularMarkers.length > 0
    );
    if (!hasMolecular && biomarkerGapsAdded < 2) {
      biomarkerGapsAdded += 1;
      pushGap({
        id: `gap-biomarker-${slugify(pathology)}`,
        category: 'Biomarker / Benchmark Gap',
        severity: 'medium',
        severityRank: 3,
        title: `No molecularly annotated ${pathology} datasets`,
        description: `None of the ${matchingDs.length} cataloged ${pathology} dataset${matchingDs.length === 1 ? '' : 's'} include structured molecular or genomic biomarkers (e.g., IDH, MGMT, BRAF, DNA Methylation) for radiogenomic modeling.`,
        metricLabel: `0 / ${matchingDs.length} molecular`,
        modality: null,
        pathology,
        datasetCount: 0,
        filterPayload: {
          tab: 'datasets',
          pathologies: [pathology],
        },
        prefillPayload: {
          recordType: 'datasets',
          pathologies: [pathology],
        },
      });
    }
  }

  // Benchmark gap: pathologies with >= 2 datasets and 0 challenges
  let benchmarkGapsAdded = 0;
  for (const pathology of matrix.pathologies) {
    if (pathology === 'Multi-Pathology') continue;
    const dsCount = datasets.filter(
      (d) => Array.isArray(d.pathologies) && d.pathologies.includes(pathology)
    ).length;
    const chCount = challenges.filter(
      (c) => Array.isArray(c.pathologies) && c.pathologies.includes(pathology)
    ).length;
    if (dsCount >= 2 && chCount === 0 && benchmarkGapsAdded < 2) {
      benchmarkGapsAdded += 1;
      pushGap({
        id: `gap-benchmark-${slugify(pathology)}`,
        category: 'Biomarker / Benchmark Gap',
        severity: 'medium',
        severityRank: 3,
        title: `No open leaderboard benchmark for ${pathology}`,
        description: `${dsCount} public datasets exist for ${pathology}, yet 0 standardized MICCAI or open challenges evaluate methods on a unified test split.`,
        metricLabel: `${dsCount} datasets · 0 challenges`,
        modality: null,
        pathology,
        datasetCount: dsCount,
        filterPayload: {
          tab: 'datasets',
          pathologies: [pathology],
        },
        prefillPayload: {
          recordType: 'challenges',
          pathologies: [pathology],
        },
      });
    }
  }

  // 6. Single-cohort reproducibility risks (Modalities x Pathologies with exactly 1 dataset)
  let singleCohortAdded = 0;
  for (const cell of matrix.cells) {
    if (cell.pathology === 'Multi-Pathology') continue;
    if (cell.datasets === 1 && singleCohortAdded < 3) {
      // Skip pairs already added in priority surgical check
      const duplicateId = `gap-surgical-sparse-${slugify(cell.modality)}-${slugify(cell.pathology)}`;
      if (seenIds.has(duplicateId)) continue;
      singleCohortAdded += 1;
      pushGap({
        id: `gap-single-cohort-${slugify(cell.modality)}-${slugify(cell.pathology)}`,
        category: 'Sparse Coverage',
        severity: 'medium',
        severityRank: 3,
        title: `Single-cohort bottleneck: ${cell.modality} × ${cell.pathology}`,
        description: `Only 1 cataloged dataset covers ${cell.modality} in ${cell.pathology}, creating an external-validation reproducibility risk for models trained on this intersection.`,
        metricLabel: '1 dataset (no external validation)',
        modality: cell.modality,
        pathology: cell.pathology,
        datasetCount: 1,
        filterPayload: {
          tab: 'datasets',
          pathologies: [cell.pathology],
          modalities: [cell.modality],
        },
        prefillPayload: {
          recordType: 'datasets',
          pathologies: [cell.pathology],
          modalities: [cell.modality],
        },
      });
    }
  }

  gaps.sort((a, b) => a.severityRank - b.severityRank || a.title.localeCompare(b.title));
  return gaps;
}

/**
 * Compute comprehensive analytics over the OpenNeuroAtlas registry.
 *
 * Supports BOTH call signatures seamlessly:
 *  - computeAnalytics(datasets, models, challenges, schema)
 *  - computeAnalytics(registry)  // where registry = { datasets, models, challenges, schema }
 *
 * @param {object[]|object} datasetsOrRegistry
 * @param {object[]} [modelsArg]
 * @param {object[]} [challengesArg]
 * @param {object|null} [schemaArg]
 * @returns {object}
 */
export function computeAnalytics(datasetsOrRegistry, modelsArg, challengesArg, schemaArg) {
  let datasets;
  let models;
  let challenges;
  let schema;

  if (
    datasetsOrRegistry &&
    !Array.isArray(datasetsOrRegistry) &&
    typeof datasetsOrRegistry === 'object'
  ) {
    datasets = Array.isArray(datasetsOrRegistry.datasets) ? datasetsOrRegistry.datasets : [];
    models = Array.isArray(datasetsOrRegistry.models) ? datasetsOrRegistry.models : [];
    challenges = Array.isArray(datasetsOrRegistry.challenges) ? datasetsOrRegistry.challenges : [];
    schema = datasetsOrRegistry.schema || (modelsArg && !Array.isArray(modelsArg) ? modelsArg : null);
  } else {
    datasets = Array.isArray(datasetsOrRegistry) ? datasetsOrRegistry : [];
    models = Array.isArray(modelsArg) ? modelsArg : [];
    challenges = Array.isArray(challengesArg) ? challengesArg : [];
    schema = schemaArg || null;
  }

  const allRecords = [...datasets, ...models, ...challenges];

  // 1. Summary KPIs
  let openAccessCount = 0;
  let registrationRequiredCount = 0;
  let controlledDuaCount = 0;
  let longitudinalCount = 0;
  let intraOpCount = 0;
  let molecularAnnotatedCount = 0;
  let totalPatients = 0;
  let openAccessPatients = 0;
  let knownCohortCount = 0;

  for (const ds of datasets) {
    if (ds.accessTier === 'Open Access') openAccessCount += 1;
    else if (ds.accessTier === 'Registration Required') registrationRequiredCount += 1;
    else if (ds.accessTier === 'Controlled DUA') controlledDuaCount += 1;

    if (Array.isArray(ds.clinicalPhases)) {
      if (ds.clinicalPhases.includes('Longitudinal')) longitudinalCount += 1;
      if (ds.clinicalPhases.includes('Intra-Op')) intraOpCount += 1;
    }

    if (Array.isArray(ds.molecularMarkers) && ds.molecularMarkers.length > 0) {
      molecularAnnotatedCount += 1;
    }

    if (typeof ds.cohortSize === 'number' && Number.isFinite(ds.cohortSize) && ds.cohortSize > 0) {
      knownCohortCount += 1;
      totalPatients += ds.cohortSize;
      if (ds.accessTier === 'Open Access') {
        openAccessPatients += ds.cohortSize;
      }
    }
  }

  const openWeightsModelCount = models.filter((m) => m.weightsAvailable === true).length;
  const activeChallengesCount = challenges.filter((c) => c.status === 'Active / Recurring').length;

  const coveredModalities = new Set();
  const coveredPathologies = new Set();
  for (const rec of allRecords) {
    if (Array.isArray(rec.modalities)) {
      for (const m of rec.modalities) coveredModalities.add(m);
    }
    if (Array.isArray(rec.pathologies)) {
      for (const p of rec.pathologies) {
        if (p !== 'Multi-Pathology') coveredPathologies.add(p);
      }
    }
  }

  const kpis = {
    totalDatasets: datasets.length,
    totalModels: models.length,
    totalChallenges: challenges.length,
    totalRecords: allRecords.length,
    openAccessCount,
    openAccessPct:
      datasets.length > 0 ? Math.round((openAccessCount / datasets.length) * 1000) / 10 : 0,
    registrationRequiredCount,
    controlledDuaCount,
    longitudinalCount,
    intraOpCount,
    molecularAnnotatedCount,
    openWeightsModelCount,
    activeChallengesCount,
    totalPatients,
    openAccessPatients,
    knownCohortCount,
    modalitiesCoveredCount: coveredModalities.size,
    pathologiesCoveredCount: coveredPathologies.size,
  };

  // 2. Modality × Pathology Coverage Matrix
  const pathologies = resolveAxisValues(schema, 'pathologies', allRecords, 'pathologies');
  const modalities = resolveAxisValues(schema, 'modalities', allRecords, 'modalities');

  const byPathology = {};
  const byModality = {};
  const cells = [];

  for (const mod of modalities) {
    byModality[mod] = {};
  }

  for (const path of pathologies) {
    byPathology[path] = {};
    for (const mod of modalities) {
      const cell = {
        pathology: path,
        modality: mod,
        count: 0,
        total: 0,
        datasets: 0,
        models: 0,
        challenges: 0,
        openAccessDatasets: 0,
        totalPatients: 0,
        datasetIds: [],
        modelIds: [],
        challengeIds: [],
        recordIds: [],
      };
      byPathology[path][mod] = cell;
      byModality[mod][path] = cell;
      cells.push(cell);
    }
  }

  const registerInMatrix = (records, kind) => {
    for (const rec of records) {
      if (!Array.isArray(rec.pathologies) || !Array.isArray(rec.modalities)) continue;
      const cohort =
        kind === 'datasets' &&
        typeof rec.cohortSize === 'number' &&
        Number.isFinite(rec.cohortSize) &&
        rec.cohortSize > 0
          ? rec.cohortSize
          : 0;
      const isOpen = kind === 'datasets' && rec.accessTier === 'Open Access';

      for (const path of rec.pathologies) {
        const row = byPathology[path];
        if (!row) continue;
        for (const mod of rec.modalities) {
          const cell = row[mod];
          if (!cell) continue;

          if (kind === 'datasets' && !cell.datasetIds.includes(rec.id)) {
            cell.datasetIds.push(rec.id);
            cell.datasets += 1;
            cell.count = cell.datasets;
            if (isOpen) cell.openAccessDatasets += 1;
            cell.totalPatients += cohort;
          } else if (kind === 'models' && !cell.modelIds.includes(rec.id)) {
            cell.modelIds.push(rec.id);
            cell.models += 1;
          } else if (kind === 'challenges' && !cell.challengeIds.includes(rec.id)) {
            cell.challengeIds.push(rec.id);
            cell.challenges += 1;
          }

          if (rec.id && !cell.recordIds.includes(rec.id)) {
            cell.recordIds.push(rec.id);
          }
          cell.total = cell.datasets + cell.models + cell.challenges;
        }
      }
    }
  };

  registerInMatrix(datasets, 'datasets');
  registerInMatrix(models, 'models');
  registerInMatrix(challenges, 'challenges');

  let maxCount = 0;
  let maxDatasetCount = 0;
  let maxOpenAccessCount = 0;

  const rows = pathologies.map((path) => {
    const rowCells = modalities.map((mod) => byPathology[path][mod]);
    let rowTotal = 0;
    let rowDatasets = 0;
    let rowOpenAccess = 0;

    for (const cell of rowCells) {
      rowTotal += cell.total;
      rowDatasets += cell.datasets;
      rowOpenAccess += cell.openAccessDatasets;
      if (cell.total > maxCount) maxCount = cell.total;
      if (cell.datasets > maxDatasetCount) maxDatasetCount = cell.datasets;
      if (cell.openAccessDatasets > maxOpenAccessCount) {
        maxOpenAccessCount = cell.openAccessDatasets;
      }
    }

    return {
      pathology: path,
      total: rowTotal,
      datasets: rowDatasets,
      openAccessDatasets: rowOpenAccess,
      cells: rowCells,
    };
  });

  const coverageMatrix = {
    modalities,
    pathologies,
    maxCount,
    maxDatasetCount,
    maxOpenAccessCount,
    byPathology,
    byModality,
    rows,
    cells,
  };

  // 3. Access-Tier Breakdown
  const tiers =
    Array.isArray(schema?.vocabularies?.accessTiers) && schema.vocabularies.accessTiers.length > 0
      ? schema.vocabularies.accessTiers
      : ['Open Access', 'Registration Required', 'Controlled DUA'];

  const accessBreakdown = tiers.map((tier) => {
    const tierDatasets = datasets.filter((d) => d.accessTier === tier);
    const tierPatients = tierDatasets.reduce(
      (sum, d) =>
        sum +
        (typeof d.cohortSize === 'number' && Number.isFinite(d.cohortSize) && d.cohortSize > 0
          ? d.cohortSize
          : 0),
      0
    );
    const count = tierDatasets.length;
    return {
      tier,
      label: tier,
      count,
      datasetCount: count,
      sharePct: datasets.length > 0 ? Math.round((count / datasets.length) * 1000) / 10 : 0,
      totalPatients: tierPatients,
      datasetIds: tierDatasets.map((d) => d.id),
    };
  });

  // 4. Cohort Size Landscape (Buckets + Top Sorted Bars)
  const cohortBuckets = [
    { label: '< 50', min: 1, max: 49, count: 0, datasetIds: [] },
    { label: '50–199', min: 50, max: 199, count: 0, datasetIds: [] },
    { label: '200–999', min: 200, max: 999, count: 0, datasetIds: [] },
    { label: '1,000+', min: 1000, max: Infinity, count: 0, datasetIds: [] },
    { label: 'Unspecified / Video', min: null, max: null, count: 0, datasetIds: [] },
  ];

  for (const ds of datasets) {
    const size =
      typeof ds.cohortSize === 'number' && Number.isFinite(ds.cohortSize) && ds.cohortSize > 0
        ? ds.cohortSize
        : null;
    if (size === null) {
      cohortBuckets[4].count += 1;
      cohortBuckets[4].datasetIds.push(ds.id);
    } else if (size < 50) {
      cohortBuckets[0].count += 1;
      cohortBuckets[0].datasetIds.push(ds.id);
    } else if (size < 200) {
      cohortBuckets[1].count += 1;
      cohortBuckets[1].datasetIds.push(ds.id);
    } else if (size < 1000) {
      cohortBuckets[2].count += 1;
      cohortBuckets[2].datasetIds.push(ds.id);
    } else {
      cohortBuckets[3].count += 1;
      cohortBuckets[3].datasetIds.push(ds.id);
    }
  }

  const sortedCohorts = datasets
    .filter((d) => typeof d.cohortSize === 'number' && Number.isFinite(d.cohortSize) && d.cohortSize > 0)
    .sort(
      (a, b) =>
        b.cohortSize - a.cohortSize ||
        (extractRecordYear(b) || 0) - (extractRecordYear(a) || 0) ||
        String(a.name || '').localeCompare(String(b.name || ''))
    )
    .map((d) => ({
      id: d.id,
      shortName: d.shortName || d.name,
      name: d.name,
      cohortSize: d.cohortSize,
      cohortDisplay: d.cohortDisplay || `${d.cohortSize.toLocaleString()} patients`,
      accessTier: d.accessTier,
      year: extractRecordYear(d),
      pathologies: Array.isArray(d.pathologies) ? d.pathologies : [],
      modalities: Array.isArray(d.modalities) ? d.modalities : [],
      platform: d.platform || null,
    }));

  const cohortBars = sortedCohorts.slice(0, 12);
  const topCohorts = sortedCohorts.slice(0, 8);

  // 5. Year-by-Year Release Timeline
  const yearMap = new Map();
  let minYear = Infinity;
  let maxYear = -Infinity;

  const tallyYear = (records, kind) => {
    for (const rec of records) {
      const y = extractRecordYear(rec, kind);
      if (y === null || !Number.isFinite(y)) continue;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
      if (!yearMap.has(y)) {
        yearMap.set(y, { datasets: 0, models: 0, challenges: 0, openAccessDatasets: 0 });
      }
      const bucket = yearMap.get(y);
      bucket[kind] += 1;
      if (kind === 'datasets' && rec.accessTier === 'Open Access') {
        bucket.openAccessDatasets += 1;
      }
    }
  };

  tallyYear(datasets, 'datasets');
  tallyYear(models, 'models');
  tallyYear(challenges, 'challenges');

  const timeline = [];
  if (Number.isFinite(minYear) && Number.isFinite(maxYear)) {
    let cumDatasets = 0;
    let cumModels = 0;
    let cumChallenges = 0;
    let cumAll = 0;

    for (let y = minYear; y <= maxYear; y += 1) {
      const counts = yearMap.get(y) || {
        datasets: 0,
        models: 0,
        challenges: 0,
        openAccessDatasets: 0,
      };
      const total = counts.datasets + counts.models + counts.challenges;
      cumDatasets += counts.datasets;
      cumModels += counts.models;
      cumChallenges += counts.challenges;
      cumAll += total;

      timeline.push({
        year: y,
        datasets: counts.datasets,
        models: counts.models,
        challenges: counts.challenges,
        openAccessDatasets: counts.openAccessDatasets,
        total,
        cumulativeDatasets: cumDatasets,
        cumulativeModels: cumModels,
        cumulativeChallenges: cumChallenges,
        cumulativeAll: cumAll,
      });
    }
  }

  const partialAnalytics = {
    kpis,
    coverageMatrix,
    accessBreakdown,
    cohortBuckets,
    cohortBars,
    topCohorts,
    timeline,
  };

  const dataGaps = detectOpenScienceGaps(partialAnalytics, {
    datasets,
    models,
    challenges,
    schema,
  });

  return {
    ...partialAnalytics,
    dataGaps,
  };
}

/**
 * Validate a URL string against HTTPS, pattern, forbidden hosts, and forbidden redirect substrings.
 * @param {string} value
 * @param {string|undefined} pattern
 * @param {string[]} forbiddenHosts
 * @returns {string[]} List of error messages
 */
function validateHttpsUrl(value, pattern, forbiddenHosts) {
  const errs = [];
  if (!value.startsWith('https://')) {
    errs.push('URL must start with "https://".');
  }
  const lowerUrl = value.toLowerCase();
  for (const banned of FORBIDDEN_URL_SUBSTRINGS) {
    if (lowerUrl.includes(banned)) {
      errs.push(`URL must not contain forbidden redirect/proxy token "${banned}".`);
    }
  }
  if (pattern) {
    const regex = new RegExp(pattern);
    if (!regex.test(value)) {
      errs.push('URL does not match required HTTPS URL format.');
    }
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      errs.push(`URL protocol must be https:, got "${parsed.protocol}".`);
    }
    const host = (parsed.hostname || '').toLowerCase();
    if (!host || !host.includes('.')) {
      errs.push('URL must contain a valid public hostname.');
    }
    for (const forbidden of forbiddenHosts) {
      const fLow = forbidden.toLowerCase();
      if (host === fLow || host.endsWith(`.${fLow}`)) {
        errs.push(`URL host "${host}" is forbidden (${forbidden}).`);
        break;
      }
    }
  } catch {
    errs.push('URL could not be parsed as a valid URL.');
  }
  return errs;
}

/**
 * Recursively validate a field value against a schema property definition.
 * @param {any} value
 * @param {object} propSpec
 * @param {string} path
 * @param {object} schema
 * @param {Array<{path: string, field: string, message: string}>} errors
 */
function validateFieldValue(value, propSpec, path, schema, errors) {
  const addErr = (message) => errors.push({ path, field: path, message });

  if (value === null) {
    if (propSpec.nullable === true) return;
    addErr('Value cannot be null.');
    return;
  }

  const forbiddenHosts = Array.isArray(schema?.integrityRules?.forbiddenUrlHosts)
    ? schema.integrityRules.forbiddenUrlHosts
    : DEFAULT_FORBIDDEN_URL_HOSTS;

  switch (propSpec.type) {
    case 'string': {
      if (typeof value !== 'string') {
        addErr(`Expected string, got ${typeof value}.`);
        return;
      }
      const trimmedLen = value.trim().length;
      if (typeof propSpec.minLength === 'number' && propSpec.minLength > 0 && trimmedLen === 0) {
        addErr('String cannot be blank or whitespace-only.');
        return;
      }
      if (typeof propSpec.minLength === 'number' && value.length < propSpec.minLength) {
        addErr(`Must be at least ${propSpec.minLength} characters (currently ${value.length}).`);
      }
      if (typeof propSpec.maxLength === 'number' && value.length > propSpec.maxLength) {
        addErr(`Must be at most ${propSpec.maxLength} characters (currently ${value.length}).`);
      }
      if (propSpec.format === 'https-url') {
        const urlErrs = validateHttpsUrl(value, propSpec.pattern, forbiddenHosts);
        for (const msg of urlErrs) addErr(msg);
      } else if (propSpec.pattern) {
        const regex = new RegExp(propSpec.pattern);
        if (!regex.test(value)) {
          addErr(`Value does not match required pattern (${propSpec.pattern}).`);
        }
      }
      if (Array.isArray(propSpec.enum) && !propSpec.enum.includes(value)) {
        addErr(`Value "${value}" is not one of allowed options: ${propSpec.enum.join(', ')}.`);
      }
      if (propSpec.vocabRef) {
        const vocab = schema?.vocabularies?.[propSpec.vocabRef];
        if (Array.isArray(vocab) && !vocab.includes(value)) {
          addErr(
            `Value "${value}" is not in controlled vocabulary "${propSpec.vocabRef}".`
          );
        }
      }
      break;
    }

    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        addErr(`Expected integer, got ${typeof value === 'number' ? value : typeof value}.`);
        return;
      }
      if (typeof propSpec.minimum === 'number' && value < propSpec.minimum) {
        addErr(`Must be >= ${propSpec.minimum} (got ${value}).`);
      }
      if (typeof propSpec.maximum === 'number' && value > propSpec.maximum) {
        addErr(`Must be <= ${propSpec.maximum} (got ${value}).`);
      }
      break;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        addErr(`Expected boolean, got ${typeof value}.`);
      }
      break;
    }

    case 'array': {
      if (!Array.isArray(value)) {
        addErr(`Expected array, got ${typeof value}.`);
        return;
      }
      if (typeof propSpec.minItems === 'number' && value.length < propSpec.minItems) {
        addErr(`Must contain at least ${propSpec.minItems} item(s) (currently ${value.length}).`);
      }
      const vocab = propSpec.vocabRef ? schema?.vocabularies?.[propSpec.vocabRef] : null;
      const seen = new Set();

      for (let i = 0; i < value.length; i += 1) {
        const elem = value[i];
        const elemPath = `${path}[${i}]`;
        if (propSpec.items?.type === 'string') {
          if (typeof elem !== 'string' || !elem.trim()) {
            errors.push({
              path: elemPath,
              field: elemPath,
              message: 'Array element must be a non-empty string.',
            });
            continue;
          }
        }
        if (propSpec.uniqueItems) {
          if (seen.has(elem)) {
            errors.push({
              path: elemPath,
              field: elemPath,
              message: `Duplicate value "${elem}" is not allowed.`,
            });
          } else {
            seen.add(elem);
          }
        }
        if (Array.isArray(vocab) && !vocab.includes(elem)) {
          errors.push({
            path: elemPath,
            field: elemPath,
            message: `Invalid value "${elem}" for controlled vocabulary "${propSpec.vocabRef}".`,
          });
        }
      }
      break;
    }

    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        addErr(`Expected object, got ${Array.isArray(value) ? 'array' : typeof value}.`);
        return;
      }
      const defSpec = propSpec.objectRef ? schema?.definitions?.[propSpec.objectRef] : propSpec;
      if (!defSpec || typeof defSpec !== 'object') return;

      validateObjectAgainstSpec(value, defSpec, path, schema, errors);
      break;
    }

    default:
      break;
  }
}

/**
 * Validate an object against a schema object specification (recordType or definition).
 * @param {object} obj
 * @param {object} spec
 * @param {string} prefixPath
 * @param {object} schema
 * @param {Array<{path: string, field: string, message: string}>} errors
 */
function validateObjectAgainstSpec(obj, spec, prefixPath, schema, errors) {
  const properties = spec.properties || {};
  const requiredFields = Array.isArray(spec.required) ? spec.required : [];
  const prefix = prefixPath ? `${prefixPath}.` : '';

  if (spec.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in properties)) {
        const fullPath = `${prefix}${key}`;
        errors.push({
          path: fullPath,
          field: fullPath,
          message: `Unknown field "${key}" is not allowed by the schema.`,
        });
      }
    }
  }

  for (const reqKey of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(obj, reqKey) || obj[reqKey] === undefined) {
      const fullPath = `${prefix}${reqKey}`;
      errors.push({
        path: fullPath,
        field: fullPath,
        message: `Required field "${reqKey}" is missing.`,
      });
    }
  }

  for (const [key, propSpec] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(obj, key) || obj[key] === undefined) {
      continue;
    }
    const fullPath = `${prefix}${key}`;
    validateFieldValue(obj[key], propSpec, fullPath, schema, errors);
  }
}

/**
 * Normalize an optional Set/Array into a Set of strings.
 * @param {Set<string>|string[]|null|undefined} input
 * @returns {Set<string>|null}
 */
function toIdSet(input) {
  if (!input) return null;
  if (input instanceof Set) return input;
  if (Array.isArray(input)) return new Set(input);
  return null;
}

/**
 * Validate a single registry record against schemas/registry-schema.json.
 * Designed for direct consumption by the in-browser PR Builder with exact parity
 * to tests/validate_registry.py.
 *
 * @param {object} record
 * @param {'datasets'|'models'|'challenges'|'dataset'|'model'|'challenge'} recordType
 * @param {object} schema
 * @param {Set<string>|string[]|{ existingIds?: Set<string>|string[], existingBibtexKeys?: Set<string>|string[], enforceCuratedYearRange?: boolean }|null} [optionsOrExistingIds=null]
 * @returns {{ valid: boolean, errors: Array<{path: string, field: string, message: string}>, warnings: Array<{path: string, field: string, message: string}> }}
 */
export function validateRecord(record, recordType, schema, optionsOrExistingIds = null) {
  const errors = [];
  const warnings = [];

  const normalizedType = normalizeRecordType(recordType);
  if (!normalizedType) {
    errors.push({
      path: '_recordType',
      field: '_recordType',
      message: `Unknown recordType "${recordType}". Expected "datasets", "models", or "challenges".`,
    });
    return { valid: false, errors, warnings };
  }

  const typeSpec = schema?.recordTypes?.[normalizedType];
  if (!typeSpec) {
    errors.push({
      path: '_schema',
      field: '_schema',
      message: `Schema is missing recordTypes["${normalizedType}"].`,
    });
    return { valid: false, errors, warnings };
  }

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    errors.push({
      path: '',
      field: '',
      message: 'Record must be a plain JSON object.',
    });
    return { valid: false, errors, warnings };
  }

  let existingIds = null;
  let existingBibtexKeys = null;
  let enforceCuratedYearRange = true;

  if (optionsOrExistingIds instanceof Set || Array.isArray(optionsOrExistingIds)) {
    existingIds = toIdSet(optionsOrExistingIds);
  } else if (optionsOrExistingIds && typeof optionsOrExistingIds === 'object') {
    existingIds = toIdSet(optionsOrExistingIds.existingIds);
    existingBibtexKeys = toIdSet(optionsOrExistingIds.existingBibtexKeys);
    if (optionsOrExistingIds.enforceCuratedYearRange !== undefined) {
      enforceCuratedYearRange = Boolean(optionsOrExistingIds.enforceCuratedYearRange);
    }
  }

  // Schema-driven object, field, regex, vocabulary, and URL validation
  validateObjectAgainstSpec(record, typeSpec, '', schema, errors);

  // Cross-field rules
  if (normalizedType === 'models') {
    const enforceWeightsRule = schema?.integrityRules?.weightsUrlRequiresWeightsAvailable !== false;
    if (
      enforceWeightsRule &&
      typeof record.weightsUrl === 'string' &&
      record.weightsUrl.trim() !== '' &&
      record.weightsAvailable !== true
    ) {
      errors.push({
        path: 'weightsAvailable',
        field: 'weightsAvailable',
        message: 'weightsAvailable must be true when weightsUrl is provided.',
      });
    }
    if (record.weightsAvailable === true && !record.weightsUrl) {
      warnings.push({
        path: 'weightsUrl',
        field: 'weightsUrl',
        message: 'weightsAvailable is true, but weightsUrl is empty — consider linking checkpoints directly.',
      });
    }
  }

  // Curated year-range & challenge span checks ([2005, 2027]) — parity with tests/validate_registry.py
  const CURATED_YEAR_MIN = 2005;
  const CURATED_YEAR_MAX = 2027;
  const pushYearIssue = (path, message) => {
    if (enforceCuratedYearRange) {
      errors.push({ path, field: path, message });
    } else {
      warnings.push({ path, field: path, message });
    }
  };

  if (normalizedType === 'datasets' || normalizedType === 'models') {
    if (
      typeof record.year === 'number' &&
      Number.isInteger(record.year) &&
      (record.year < CURATED_YEAR_MIN || record.year > CURATED_YEAR_MAX)
    ) {
      pushYearIssue(
        'year',
        `year ${record.year} is outside required range [${CURATED_YEAR_MIN}, ${CURATED_YEAR_MAX}].`
      );
    }
  } else if (normalizedType === 'challenges' && typeof record.yearsActive === 'string') {
    const foundYears = (record.yearsActive.match(/\d{4}/g) || []).map((y) => parseInt(y, 10));
    if (foundYears.length > 0) {
      const startYear = foundYears[0];
      if (startYear < CURATED_YEAR_MIN || startYear > CURATED_YEAR_MAX) {
        pushYearIssue(
          'yearsActive',
          `Start year ${startYear} in '${record.yearsActive}' is outside [${CURATED_YEAR_MIN}, ${CURATED_YEAR_MAX}].`
        );
      }
      for (let i = 1; i < foundYears.length; i += 1) {
        const y = foundYears[i];
        if (y < startYear) {
          errors.push({
            path: 'yearsActive',
            field: 'yearsActive',
            message: `Year ${y} in '${record.yearsActive}' precedes start year ${startYear}.`,
          });
        } else if (y > CURATED_YEAR_MAX) {
          pushYearIssue(
            'yearsActive',
            `Year ${y} in '${record.yearsActive}' exceeds maximum ${CURATED_YEAR_MAX}.`
          );
        }
      }
    }
  }

  // Duplicate ID & BibTeX key checks
  if (existingIds && typeof record.id === 'string' && existingIds.has(record.id)) {
    errors.push({
      path: 'id',
      field: 'id',
      message: `Duplicate record id "${record.id}" already exists in the registry.`,
    });
  }

  if (
    existingBibtexKeys &&
    record.citation &&
    typeof record.citation.bibtexKey === 'string' &&
    record.citation.bibtexKey
  ) {
    const keyLower = record.citation.bibtexKey.toLowerCase();
    const hasCollision =
      existingBibtexKeys.has(record.citation.bibtexKey) ||
      Array.from(existingBibtexKeys).some((k) => String(k).toLowerCase() === keyLower);
    if (hasCollision) {
      errors.push({
        path: 'citation.bibtexKey',
        field: 'citation.bibtexKey',
        message: `Duplicate BibTeX key "${record.citation.bibtexKey}" already exists in this collection.`,
      });
    }
  }

  // Helpful domain warnings (non-blocking)
  if (normalizedType === 'datasets') {
    const oncologySet = new Set(
      Array.isArray(schema?.suggestions?.oncologyPathologies)
        ? schema.suggestions.oncologyPathologies
        : DEFAULT_ONCOLOGY_PATHOLOGIES
    );
    const hasOncology =
      Array.isArray(record.pathologies) && record.pathologies.some((p) => oncologySet.has(p));
    if (hasOncology && Array.isArray(record.molecularMarkers) && record.molecularMarkers.length === 0) {
      warnings.push({
        path: 'molecularMarkers',
        field: 'molecularMarkers',
        message:
          'Oncology dataset has no molecularMarkers listed — confirm if IDH/MGMT/WHO Grade labels exist.',
      });
    }
    if (
      typeof record.year === 'number' &&
      record.citation &&
      typeof record.citation.year === 'number' &&
      Math.abs(record.year - record.citation.year) > 5
    ) {
      warnings.push({
        path: 'citation.year',
        field: 'citation.year',
        message: `Dataset release year (${record.year}) differs from citation year (${record.citation.year}) by >5 years.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Alias for validateRecord matching ARCHITECTURE.md Section 5.4.
 * @param {object} record
 * @param {string} recordType
 * @param {object} schema
 * @param {Set<string>|string[]|object} [existingIds]
 * @returns {{ valid: boolean, errors: Array<object>, warnings: Array<object> }}
 */
export function validateRecordAgainstSchema(record, recordType, schema, existingIds = new Set()) {
  return validateRecord(record, recordType, schema, existingIds);
}
