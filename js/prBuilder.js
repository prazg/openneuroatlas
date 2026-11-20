/**
 * OpenNeuroAtlas — Schema-Driven Interactive PR Builder
 *
 * Dynamically renders controlled-vocabulary pickers and structured inputs directly
 * from `schemas/registry-schema.json`, runs real-time parity validation via
 * `validateRecord()` from `js/registryEngine.js`, and exports formatted JSON,
 * downloadable `.json` files, and ready-to-paste GitHub PR descriptions.
 */

import { validateRecord, normalizeRecordType } from './registryEngine.js';
import { getPlatformFetchTemplate, copyToClipboard, downloadTextFile } from './exporters.js';

const DEFAULT_REPO = Object.freeze({
  owner: 'openneuroatlas',
  repo: 'openneuroatlas',
});

const RECORD_TYPE_META = Object.freeze([
  { key: 'datasets', label: 'Dataset', dataFile: 'data/datasets.json' },
  { key: 'models', label: 'Model / Toolkit', dataFile: 'data/models.json' },
  { key: 'challenges', label: 'Challenge / Benchmark', dataFile: 'data/challenges.json' },
]);

const SECTION_ORDER = Object.freeze([
  'Core Identity',
  'Clinical & Technical Scope',
  'Access & Code',
  'Citation & Notes',
]);

/**
 * Validate a record against schemas/registry-schema.json (exported alias).
 * @param {object} record
 * @param {string} recordType
 * @param {object} schema
 * @param {Set<string>|string[]|object} [existingIds]
 */
export function validateRecordAgainstSchema(record, recordType, schema, existingIds = new Set()) {
  return validateRecord(record, recordType, schema, existingIds);
}

/**
 * Escape HTML special characters safely.
 * @param {any} val
 * @returns {string}
 */
function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert arbitrary text into a lowercase kebab-case slug matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
 * @param {string} text
 * @returns {string}
 */
function toSlug(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Derive a recommended BibTeX citation key (`<firstauthor><year><shortslug>`).
 * @param {string} authors
 * @param {number|string} year
 * @param {string} slug
 * @returns {string}
 */
function deriveBibtexKey(authors, year, slug) {
  const firstAuthor = String(authors || '')
    .split(/\s+and\s+/i)[0]
    .split(',')[0]
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');

  const yr = String(year || '').match(/\d{4}/)?.[0] || '';
  const compactSlug = String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 18);

  const raw = `${firstAuthor || 'ref'}${yr}${compactSlug}`;
  const clean = raw.replace(/[^a-z0-9_-]/g, '');
  if (!clean || !/^[a-z]/.test(clean)) return `ref${clean || '2026entry'}`;
  return clean.slice(0, 60);
}

/**
 * Syntax-highlight formatted JSON into safe HTML spans.
 * @param {string} jsonStr
 * @returns {string}
 */
function highlightJsonHtml(jsonStr) {
  const escaped = esc(jsonStr);
  return escaped.replace(
    /(&quot;(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\&]|&(?!quot;))*&quot;(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      if (match.startsWith('&quot;')) {
        if (match.endsWith(':')) {
          return `<span class="json-key">${match}</span>`;
        }
        return `<span class="json-str">${match}</span>`;
      }
      if (match === 'true' || match === 'false') {
        return `<span class="json-bool">${match}</span>`;
      }
      if (match === 'null') {
        return `<span class="json-null">${match}</span>`;
      }
      return `<span class="json-num">${match}</span>`;
    }
  );
}

/**
 * Generate a clean, structured GitHub Pull Request / Issue Markdown description.
 *
 * @param {object} record
 * @param {string} recordType
 * @param {{ owner?: string, repo?: string, isValid?: boolean, valid?: boolean, errorCount?: number }} [repoConfig]
 * @param {boolean|{ valid?: boolean, errors?: Array<object> }|null} [validationResult]
 * @returns {string}
 */
export function generatePrMarkdown(
  record,
  recordType,
  repoConfig = DEFAULT_REPO,
  validationResult = null
) {
  const type = normalizeRecordType(recordType) || 'datasets';
  const meta = RECORD_TYPE_META.find((m) => m.key === type) || RECORD_TYPE_META[0];
  const titleName = record?.shortName || record?.name || record?.id || 'New Resource';
  const jsonBlock = JSON.stringify(record, null, 2);

  const isValid =
    typeof validationResult === 'boolean'
      ? validationResult
      : validationResult && typeof validationResult === 'object'
        ? Boolean(validationResult.valid)
        : typeof repoConfig?.isValid === 'boolean'
          ? repoConfig.isValid
          : typeof repoConfig?.valid === 'boolean'
            ? repoConfig.valid
            : false;

  const errorCount = Array.isArray(validationResult?.errors)
    ? validationResult.errors.length
    : typeof repoConfig?.errorCount === 'number'
      ? repoConfig.errorCount
      : 0;

  const summaryRows = [
    ['Record Type', meta.label],
    ['Target File', `\`${meta.dataFile}\``],
    ['Record ID', `\`${record?.id || 'TBD'}\``],
    ['Name', record?.name || '—'],
    ['Pathologies', Array.isArray(record?.pathologies) && record.pathologies.length ? record.pathologies.join(', ') : '—'],
    ['Modalities', Array.isArray(record?.modalities) && record.modalities.length ? record.modalities.join(', ') : '—'],
  ];

  if (type === 'datasets') {
    summaryRows.push(['Cohort', record?.cohortDisplay || '—']);
    summaryRows.push(['Access Tier', record?.accessTier || '—']);
    summaryRows.push(['Platform', record?.platform || '—']);
    summaryRows.push(['Landing URL', record?.url || '—']);
  } else if (type === 'models') {
    summaryRows.push(['Category', record?.category || '—']);
    summaryRows.push(['Open Weights', record?.weightsAvailable ? 'Yes' : 'No']);
    summaryRows.push(['License', record?.openSourceLicense || '—']);
    summaryRows.push(['Repository URL', record?.repoUrl || '—']);
  } else {
    summaryRows.push(['Organizer', record?.organizer || '—']);
    summaryRows.push(['Years Active', record?.yearsActive || '—']);
    summaryRows.push(['Status', record?.status || '—']);
    summaryRows.push(['Challenge URL', record?.url || '—']);
  }

  const tableLines = [
    '| Field | Value |',
    '|---|---|',
    ...summaryRows.map(([k, v]) => `| ${k} | ${String(v).replace(/\|/g, '\\|')} |`),
  ].join('\n');

  const jsonHeading = isValid
    ? '### Validated JSON Entry'
    : '### Draft JSON Entry (Validation Incomplete)';
  const validationCheckItem = isValid
    ? '- [x] Built & validated in the OpenNeuroAtlas PR Builder against `schemas/registry-schema.json`'
    : `- [ ] Built & validated in the OpenNeuroAtlas PR Builder against \`schemas/registry-schema.json\`${
        errorCount > 0 ? ` (${errorCount} validation issue${errorCount === 1 ? '' : 's'} remaining)` : ''
      }`;

  return [
    `## OpenNeuroAtlas Registry Submission: ${titleName}`,
    '',
    '### Resource Summary',
    tableLines,
    '',
    jsonHeading,
    `Append this object to the \`"records"\` array in \`${meta.dataFile}\` and update \`"lastUpdated"\`:`,
    '',
    '```json',
    jsonBlock,
    '```',
    '',
    '### Verification Checklist',
    validationCheckItem,
    '- [ ] Verified all URLs resolve over `https://` to official dataset/repo/challenge pages',
    '- [ ] Ran `python tests/validate_registry.py --strict` locally (0 errors)',
    '- [ ] Confirmed controlled vocabulary terms and accurate citation metadata',
  ].join('\n');
}

/**
 * Create a clean blank draft form state for the given record type.
 * @param {'datasets'|'models'|'challenges'} recordType
 * @param {object} schema
 * @returns {object}
 */
function createEmptyDraft(recordType, schema) {
  const typeSpec = schema?.recordTypes?.[recordType];
  const props = typeSpec?.properties || {};
  const draft = {};
  const currentYear = new Date().getFullYear();

  for (const [key, spec] of Object.entries(props)) {
    if (spec.type === 'array') {
      draft[key] = [];
    } else if (spec.type === 'boolean') {
      draft[key] = false;
    } else if (spec.type === 'integer') {
      if (key === 'year') draft[key] = String(Math.min(currentYear, 2026));
      else draft[key] = '';
    } else if (spec.type === 'object' && spec.objectRef === 'citation') {
      draft.citation = {
        authors: '',
        title: '',
        venue: '',
        year: String(Math.min(currentYear, 2026)),
        bibtexKey: '',
        doi: '',
      };
    } else if (spec.vocabRef && Array.isArray(schema?.vocabularies?.[spec.vocabRef])) {
      draft[key] = schema.vocabularies[spec.vocabRef][0] || '';
    } else {
      draft[key] = '';
    }
  }

  return draft;
}

/**
 * Create a realistic, schema-valid example draft so users can inspect valid formatting immediately.
 * @param {'datasets'|'models'|'challenges'} recordType
 * @returns {object}
 */
function createSampleDraft(recordType) {
  if (recordType === 'models') {
    return {
      id: 'neuro-seg-demo-2026',
      name: 'NeuroSeg-Demo 3D Foundation Model',
      category: 'Foundation Model',
      year: '2026',
      modalities: ['Structural MRI', 'Intra-Op Ultrasound'],
      pathologies: ['Glioma / GBM', 'Meningioma'],
      architecture: '3D Swin-UNETR encoder with cross-modal MRI-to-iUS alignment head',
      weightsAvailable: true,
      openSourceLicense: 'Apache-2.0',
      framework: 'PyTorch / MONAI',
      repoUrl: 'https://github.com/openneuroatlas/neuro-seg-demo',
      weightsUrl: 'https://huggingface.co/openneuroatlas/neuro-seg-demo',
      paperUrl: 'https://arxiv.org/abs/2601.00001',
      installSnippet:
        'pip install torch monai huggingface_hub\nhuggingface-cli download openneuroatlas/neuro-seg-demo --local-dir ./weights',
      citation: {
        authors: 'Author, Jane and Collaborator, Alex',
        title: 'NeuroSeg-Demo: Cross-modal preoperative MRI and intraoperative ultrasound segmentation',
        venue: 'MICCAI',
        year: '2026',
        bibtexKey: 'author2026neurosegdemo',
        doi: '10.48550/arXiv.2601.00001',
      },
      highlights:
        'Example template demonstrating a schema-valid foundation model submission with open weights, controlled modalities, and reproducible installation instructions.',
    };
  }

  if (recordType === 'challenges') {
    return {
      id: 'neuro-shift-bench-2026',
      name: 'NeuroShift Open Intraoperative Registration Benchmark',
      organizer: 'MICCAI Surgical AI Working Group',
      yearsActive: '2026–Present',
      status: 'Active / Recurring',
      modalities: ['Structural MRI', 'Intra-Op Ultrasound'],
      pathologies: ['Glioma / GBM', 'Brain Metastases'],
      tasks: ['Image Registration / Brain Shift', 'Resection Cavity Segmentation'],
      metrics: ['TRE', 'Dice', 'Runtime / Efficiency'],
      platform: 'Grand Challenge',
      url: 'https://grand-challenge.org/challenges/',
      paperUrl: 'https://arxiv.org/abs/2601.00002',
      citation: {
        authors: 'Organizer, Sam and Lead, Priya and others',
        title: 'NeuroShift 2026: Multi-center intraoperative brain-shift registration benchmark',
        venue: 'MICCAI',
        year: '2026',
        bibtexKey: 'organizer2026neuroshift',
        doi: '10.48550/arXiv.2601.00002',
      },
      highlights:
        'Example template illustrating a schema-valid recurring MICCAI neurosurgery benchmark with standardized landmark TRE, cavity Dice, and runtime leaderboard metrics.',
    };
  }

  return {
    id: 'neuro-ius-sample-2026',
    name: 'Multi-Center Intraoperative Glioma Ultrasound & MRI Cohort (Sample)',
    shortName: 'Neuro-iUS Sample',
    year: '2026',
    pathologies: ['Glioma / GBM', 'Brain Metastases'],
    modalities: ['Structural MRI', 'Intra-Op Ultrasound'],
    clinicalPhases: ['Pre-Op', 'Intra-Op', 'Early Post-Op'],
    tasks: ['Tumor Segmentation', 'Image Registration / Brain Shift'],
    cohortSize: '140',
    cohortDisplay: '140 patients (pre-op mpMRI + tracked 3D iUS + post-op MRI)',
    annotations: ['Voxel-wise Tumor Sub-regions', 'Anatomical Landmarks / Fiducials', 'Molecular / Genetic Labels'],
    molecularMarkers: ['IDH', 'MGMT', 'WHO Grade'],
    accessTier: 'Open Access',
    license: 'CC BY 4.0',
    platform: 'TCIA',
    url: 'https://www.cancerimagingarchive.net/collections/',
    paperUrl: 'https://doi.org/10.1038/s41597-024-03295-z',
    fetchSnippet:
      'pip install tcia_utils\npython -c "from tcia_utils import nbia; series = nbia.getSeries(collection=\'Neuro-iUS-Sample\'); nbia.downloadSeries(series, path=\'./data/neuro-ius-sample-2026\')"',
    citation: {
      authors: 'Researcher, Maya and Surgeon, David and others',
      title: 'Multi-center paired preoperative MRI and 3D intraoperative ultrasound benchmark in brain tumor resection',
      venue: 'Scientific Data',
      year: '2026',
      bibtexKey: 'researcher2026neuroiussample',
      doi: '10.1038/s41597-024-03295-z',
    },
    highlights:
      'Example template demonstrating a schema-valid dataset entry pairing preoperative MRI, tracked 3D intraoperative ultrasound, molecular biomarkers, and early post-operative resection imaging.',
    limitations:
      'Sample template entry for testing the PR Builder; replace URLs, cohort counts, and citation metadata with verified real-world study details prior to opening a PR.',
  };
}

/**
 * Convert form draft state into an exact schema-typed JSON record object.
 * @param {object} draft
 * @param {'datasets'|'models'|'challenges'} recordType
 * @param {object} schema
 * @returns {object}
 */
function draftToSchemaRecord(draft, recordType, schema) {
  const typeSpec = schema?.recordTypes?.[recordType];
  const props = typeSpec?.properties || {};
  const record = {};

  for (const [key, spec] of Object.entries(props)) {
    const rawVal = draft[key];

    if (spec.type === 'array') {
      record[key] = Array.isArray(rawVal) ? [...rawVal] : [];
    } else if (spec.type === 'boolean') {
      record[key] = Boolean(rawVal);
    } else if (spec.type === 'integer') {
      const trimmed = String(rawVal ?? '').trim();
      if (trimmed === '') {
        record[key] = spec.nullable ? null : '';
      } else if (/^-?\d+$/.test(trimmed)) {
        record[key] = parseInt(trimmed, 10);
      } else {
        record[key] = Number(trimmed);
      }
    } else if (spec.type === 'object' && spec.objectRef === 'citation') {
      const citDraft = rawVal && typeof rawVal === 'object' ? rawVal : {};
      const citYearTrim = String(citDraft.year ?? '').trim();
      const doiTrim = String(citDraft.doi ?? '').trim();
      record.citation = {
        authors: String(citDraft.authors ?? '').trim(),
        title: String(citDraft.title ?? '').trim(),
        venue: String(citDraft.venue ?? '').trim(),
        year: /^-?\d+$/.test(citYearTrim) ? parseInt(citYearTrim, 10) : citYearTrim === '' ? '' : Number(citYearTrim),
        bibtexKey: String(citDraft.bibtexKey ?? '').trim(),
        doi: doiTrim === '' ? null : doiTrim.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ''),
      };
    } else {
      const strVal = String(rawVal ?? '');
      const trimmed = spec.ui?.inputType === 'code' ? strVal.trim() : strVal.trim();
      if (trimmed === '' && spec.nullable) {
        record[key] = null;
      } else {
        record[key] = trimmed;
      }
    }
  }

  return record;
}

/**
 * Mount the Schema-Driven Interactive PR Builder inside `container`.
 *
 * @param {HTMLElement} container
 * @param {{
 *   schema: object,
 *   registry: object,
 *   repoConfig?: { owner: string, repo: string },
 *   initialPrefill?: object|null,
 *   onNotify?: (message: string, kind?: 'success'|'error') => void
 * }} options
 */
export function mountPrBuilder(container, options = {}) {
  if (!container) return null;
  const schema = options.schema;
  const registry = options.registry || { datasets: [], models: [], challenges: [], allRecords: [] };
  const repoConfig = options.repoConfig || DEFAULT_REPO;
  const notify = typeof options.onNotify === 'function' ? options.onNotify : () => {};

  if (!schema || !schema.recordTypes) {
    container.innerHTML = '<p class="viz-subtitle">Registry schema unavailable.</p>';
    return null;
  }

  let recordType = 'datasets';
  let draft = createEmptyDraft(recordType, schema);
  let manualId = false;
  let manualBibtexKey = false;
  let manualCitYear = false;

  const existingIds = new Set((registry.allRecords || []).map((r) => r.id).filter(Boolean));
  const getExistingBibtexKeys = () => {
    const col = registry[recordType] || [];
    return new Set(col.map((r) => r.citation?.bibtexKey).filter(Boolean));
  };

  // Apply initial prefill if supplied
  function applyPrefill(prefill) {
    if (!prefill || typeof prefill !== 'object') return;
    const nextType = normalizeRecordType(prefill.recordType) || recordType;
    recordType = nextType;
    draft = createEmptyDraft(recordType, schema);
    manualId = false;
    manualBibtexKey = false;
    manualCitYear = false;

    const props = schema.recordTypes[recordType]?.properties || {};
    for (const [k, v] of Object.entries(prefill)) {
      if (k === 'recordType' || !(k in props)) continue;
      if (props[k].type === 'array' && Array.isArray(v)) {
        const vocab = props[k].vocabRef ? schema.vocabularies?.[props[k].vocabRef] : null;
        draft[k] = vocab ? v.filter((item) => vocab.includes(item)) : [...v];
      } else if (props[k].type === 'boolean') {
        draft[k] = Boolean(v);
      } else if (v !== null && v !== undefined) {
        draft[k] = String(v);
      }
    }
    renderFull();
  }

  // Build form shell & sections once per recordType switch
  function renderFull() {
    const typeSpec = schema.recordTypes[recordType];
    const props = typeSpec.properties || {};

    // Group properties by ui.section
    const sectionMap = new Map();
    SECTION_ORDER.forEach((sec) => sectionMap.set(sec, []));

    for (const [propKey, propSpec] of Object.entries(props)) {
      const secName = propSpec.ui?.section || 'Additional Metadata';
      if (!sectionMap.has(secName)) sectionMap.set(secName, []);
      sectionMap.get(secName).push([propKey, propSpec]);
    }

    const typeButtonsHtml = RECORD_TYPE_META.map(
      (m) => `
        <button
          type="button"
          class="pr-type-btn${m.key === recordType ? ' is-active' : ''}"
          data-pr-type="${m.key}"
          aria-pressed="${m.key === recordType}"
        >
          ${esc(m.label)}
        </button>
      `
    ).join('');

    // Build datalists from schema.suggestions
    const datalistsHtml = Object.entries(schema.suggestions || {})
      .map(
        ([sugKey, items]) => `
        <datalist id="pr-datalist-${esc(sugKey)}">
          ${(Array.isArray(items) ? items : []).map((v) => `<option value="${esc(v)}"></option>`).join('')}
        </datalist>
      `
      )
      .join('');

    const sectionsHtml = Array.from(sectionMap.entries())
      .filter(([, entries]) => entries.length > 0)
      .map(([secName, entries]) => {
        const fieldsHtml = entries.map(([key, spec]) => renderFieldHtml(key, spec)).join('');
        return `
          <section class="pr-section-card">
            <header class="pr-section-header">
              <h3>${esc(secName)}</h3>
            </header>
            <div class="pr-fields-grid">
              ${fieldsHtml}
            </div>
          </section>
        `;
      })
      .join('');

    const targetMeta = RECORD_TYPE_META.find((m) => m.key === recordType) || RECORD_TYPE_META[0];

    container.innerHTML = `
      <div class="pr-builder-shell">
        <div class="pr-topbar">
          <div class="pr-type-tabs" role="group" aria-label="Select contribution record type">
            ${typeButtonsHtml}
          </div>
          <div class="pr-topbar-utils">
            <button type="button" class="btn btn-secondary btn-sm" id="pr-btn-sample">Fill Valid Example</button>
            <button type="button" class="btn btn-ghost btn-sm btn-danger-text" id="pr-btn-reset">Reset Form</button>
          </div>
        </div>

        <div class="pr-grid">
          <form class="pr-form-column" id="pr-builder-form" novalidate>
            ${sectionsHtml}
            ${datalistsHtml}
          </form>

          <aside class="pr-preview-column" aria-label="Live schema validation and JSON output">
            <div class="pr-validation-card">
              <div id="pr-status-banner" class="pr-status-banner is-invalid">
                <span id="pr-status-text">Validating&hellip;</span>
                <span id="pr-status-count" class="mono"></span>
              </div>
              <ul id="pr-issues-list" class="pr-issues-list"></ul>
            </div>

            <div class="pr-json-card">
              <div class="pr-json-header">
                <span>Target: <code class="mono">${esc(targetMeta.dataFile)}</code> &rarr; <code>"records"</code></span>
                <span class="mono">Schema v${esc(schema.schemaVersion || '1.0.0')}</span>
              </div>
              <pre id="pr-json-pre" class="pr-json-pre mono" aria-label="Formatted JSON preview"></pre>
              <div class="pr-action-bar">
                <button type="button" id="pr-btn-copy-json" class="btn btn-primary btn-sm">Copy JSON</button>
                <button type="button" id="pr-btn-download-json" class="btn btn-secondary btn-sm">Download .json</button>
                <button type="button" id="pr-btn-copy-pr" class="btn btn-secondary btn-sm">Copy PR Description</button>
                <button type="button" id="pr-btn-github-issue" class="btn btn-ghost btn-sm">Open GitHub Issue</button>
              </div>
              <div class="pr-ci-note">
                Local parity check before pushing: <code class="mono">python tests/validate_registry.py --strict</code>
              </div>
            </div>
          </aside>
        </div>
      </div>
    `;

    wireEvents();
    updateValidationAndPreview();
  }

  /**
   * Render a single schema property field control.
   */
  function renderFieldHtml(key, spec) {
    const ui = spec.ui || {};
    const label = ui.label || key;
    const requiredStar = spec.required && !spec.nullable ? '<span class="req-star" aria-hidden="true">*</span>' : '';
    const help = ui.helpText || spec.description || '';
    const inputType = ui.inputType || 'text';

    // Citation nested object group
    if (inputType === 'citation-group' || spec.objectRef === 'citation') {
      const citSpec = schema.definitions?.citation?.properties || {};
      const citFieldsHtml = Object.entries(citSpec)
        .map(([ck, cSpec]) => {
          const cui = cSpec.ui || {};
          const path = `citation.${ck}`;
          const isFull = ck === 'authors' || ck === 'title';
          const cReq = cSpec.required && !cSpec.nullable ? '<span class="req-star" aria-hidden="true">*</span>' : '';
          const val = draft.citation?.[ck] ?? '';
          const htmlType = cui.inputType === 'number' ? 'number' : 'text';

          return `
            <div class="pr-field${isFull ? ' is-full' : ''}" data-field-path="${esc(path)}">
              <div class="pr-label-row">
                <label class="pr-label" for="pr-input-${esc(path)}">${esc(cui.label || ck)}${cReq}</label>
                ${
                  ck === 'bibtexKey'
                    ? '<button type="button" class="text-link-btn" data-pr-action="sync-bibkey">Auto-generate</button>'
                    : ''
                }
              </div>
              <input
                type="${htmlType}"
                id="pr-input-${esc(path)}"
                class="text-input${ck === 'bibtexKey' || ck === 'doi' ? ' mono' : ''}"
                data-bind="${esc(path)}"
                value="${esc(val)}"
                placeholder="${esc(cui.placeholder || '')}"
                ${cSpec.minimum != null ? `min="${cSpec.minimum}"` : ''}
                ${cSpec.maximum != null ? `max="${cSpec.maximum}"` : ''}
              />
              <span class="pr-help">${esc(cui.helpText || '')}</span>
              <span class="pr-field-error" data-error-for="${esc(path)}" hidden></span>
            </div>
          `;
        })
        .join('');

      return `
        <div class="pr-field is-full" data-field-path="citation">
          <div class="pr-label-row">
            <span class="pr-label">${esc(label)}<span class="req-star" aria-hidden="true">*</span></span>
          </div>
          <div class="pr-citation-subgrid">${citFieldsHtml}</div>
        </div>
      `;
    }

    // Controlled-vocabulary multi-select checkboxes
    if (inputType === 'multi-select' && spec.vocabRef) {
      const vocab = schema.vocabularies?.[spec.vocabRef] || [];
      const selectedSet = new Set(Array.isArray(draft[key]) ? draft[key] : []);
      const chipsHtml = vocab
        .map((term) => {
          const checked = selectedSet.has(term);
          return `
            <label class="pr-vocab-chip${checked ? ' is-checked' : ''}">
              <input
                type="checkbox"
                data-bind-multi="${esc(key)}"
                value="${esc(term)}"
                ${checked ? 'checked' : ''}
              />
              <span>${esc(term)}</span>
            </label>
          `;
        })
        .join('');

      return `
        <div class="pr-field is-full" data-field-path="${esc(key)}">
          <div class="pr-label-row">
            <span class="pr-label">${esc(label)}${spec.minItems > 0 ? '<span class="req-star" aria-hidden="true">*</span>' : ''}</span>
            <span class="pr-help mono" data-multi-count="${esc(key)}">${selectedSet.size} selected</span>
          </div>
          <div class="pr-checkbox-grid" role="group" aria-label="${esc(label)}">
            ${chipsHtml}
          </div>
          <span class="pr-help">${esc(help)}</span>
          <span class="pr-field-error" data-error-for="${esc(key)}" hidden></span>
        </div>
      `;
    }

    // Controlled-vocabulary single select
    if (inputType === 'select' && spec.vocabRef) {
      const vocab = schema.vocabularies?.[spec.vocabRef] || [];
      const currentVal = draft[key] ?? '';
      const optsHtml = vocab
        .map((term) => `<option value="${esc(term)}"${term === currentVal ? ' selected' : ''}>${esc(term)}</option>`)
        .join('');

      return `
        <div class="pr-field" data-field-path="${esc(key)}">
          <label class="pr-label" for="pr-input-${esc(key)}">${esc(label)}${requiredStar}</label>
          <select id="pr-input-${esc(key)}" class="select-input" data-bind="${esc(key)}">
            ${optsHtml}
          </select>
          <span class="pr-help">${esc(help)}</span>
          <span class="pr-field-error" data-error-for="${esc(key)}" hidden></span>
        </div>
      `;
    }

    // Boolean checkbox (e.g., weightsAvailable)
    if (inputType === 'checkbox' || spec.type === 'boolean') {
      const checked = Boolean(draft[key]);
      return `
        <div class="pr-field is-full" data-field-path="${esc(key)}">
          <label class="pr-boolean-row" for="pr-input-${esc(key)}">
            <input type="checkbox" id="pr-input-${esc(key)}" data-bind-bool="${esc(key)}" ${checked ? 'checked' : ''} />
            <span>
              <strong class="pr-label">${esc(label)}</strong>
              <span class="pr-help" style="display:block;">${esc(help)}</span>
            </span>
          </label>
          <span class="pr-field-error" data-error-for="${esc(key)}" hidden></span>
        </div>
      `;
    }

    // Code snippet textarea (fetchSnippet / installSnippet)
    if (inputType === 'code') {
      const starterBtn =
        key === 'fetchSnippet'
          ? '<button type="button" class="text-link-btn" data-pr-action="insert-starter">Insert Platform Starter</button>'
          : '';
      return `
        <div class="pr-field is-full" data-field-path="${esc(key)}">
          <div class="pr-label-row">
            <label class="pr-label" for="pr-input-${esc(key)}">${esc(label)}${requiredStar}</label>
            ${starterBtn}
          </div>
          <textarea
            id="pr-input-${esc(key)}"
            class="textarea-input pr-code-input"
            data-bind="${esc(key)}"
            placeholder="${esc(ui.placeholder || '')}"
            spellcheck="false"
          >${esc(draft[key] ?? '')}</textarea>
          <span class="pr-help">${esc(help)}</span>
          <span class="pr-field-error" data-error-for="${esc(key)}" hidden></span>
        </div>
      `;
    }

    // Multi-line textarea (highlights, limitations)
    if (inputType === 'textarea') {
      return `
        <div class="pr-field is-full" data-field-path="${esc(key)}">
          <div class="pr-label-row">
            <label class="pr-label" for="pr-input-${esc(key)}">${esc(label)}${requiredStar}</label>
            <span class="pr-help mono" data-char-count="${esc(key)}">${String(draft[key] ?? '').length}/${spec.maxLength || 500}</span>
          </div>
          <textarea
            id="pr-input-${esc(key)}"
            class="textarea-input pr-textarea"
            data-bind="${esc(key)}"
            placeholder="${esc(ui.placeholder || '')}"
          >${esc(draft[key] ?? '')}</textarea>
          <span class="pr-help">${esc(help)}</span>
          <span class="pr-field-error" data-error-for="${esc(key)}" hidden></span>
        </div>
      `;
    }

    // Standard single-line text / url / number
    const isFull = key === 'name' || key === 'architecture' || key === 'url' || key === 'repoUrl';
    const htmlType = inputType === 'number' ? 'number' : inputType === 'url' ? 'url' : 'text';
    const listAttr = spec.suggestionRef ? ` list="pr-datalist-${esc(spec.suggestionRef)}"` : '';
    const extraAction =
      key === 'id'
        ? '<button type="button" class="text-link-btn" data-pr-action="sync-id">Auto-slug</button>'
        : '';

    return `
      <div class="pr-field${isFull ? ' is-full' : ''}" data-field-path="${esc(key)}">
        <div class="pr-label-row">
          <label class="pr-label" for="pr-input-${esc(key)}">${esc(label)}${requiredStar}</label>
          ${extraAction}
        </div>
        <input
          type="${htmlType}"
          id="pr-input-${esc(key)}"
          class="text-input${key === 'id' || inputType === 'url' ? ' mono' : ''}"
          data-bind="${esc(key)}"
          value="${esc(draft[key] ?? '')}"
          placeholder="${esc(ui.placeholder || '')}"
          ${spec.minimum != null ? `min="${spec.minimum}"` : ''}
          ${spec.maximum != null ? `max="${spec.maximum}"` : ''}
          ${listAttr}
        />
        <span class="pr-help">${esc(help)}</span>
        <span class="pr-field-error" data-error-for="${esc(key)}" hidden></span>
      </div>
    `;
  }

  /**
   * Wire form inputs, record-type tabs, helper buttons, and export actions.
   */
  function wireEvents() {
    // Switch record type
    container.querySelectorAll('[data-pr-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextType = btn.getAttribute('data-pr-type');
        if (!nextType || nextType === recordType) return;
        recordType = nextType;
        draft = createEmptyDraft(recordType, schema);
        manualId = false;
        manualBibtexKey = false;
        manualCitYear = false;
        renderFull();
      });
    });

    // Sample & Reset buttons
    container.querySelector('#pr-btn-sample')?.addEventListener('click', () => {
      draft = createSampleDraft(recordType);
      manualId = true;
      manualBibtexKey = true;
      manualCitYear = true;
      renderFull();
      notify('Loaded valid sample template — replace with real study metadata before submitting.');
    });

    container.querySelector('#pr-btn-reset')?.addEventListener('click', () => {
      draft = createEmptyDraft(recordType, schema);
      manualId = false;
      manualBibtexKey = false;
      manualCitYear = false;
      renderFull();
      notify('PR Builder form cleared.');
    });

    const form = container.querySelector('#pr-builder-form');
    if (form) {
      // Standard text/select/textarea inputs
      form.addEventListener('input', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const bindPath = target.getAttribute('data-bind');
        if (!bindPath) return;

        const val = target.value;
        if (bindPath.startsWith('citation.')) {
          const ck = bindPath.slice('citation.'.length);
          draft.citation[ck] = val;
          if (ck === 'bibtexKey') manualBibtexKey = val.trim().length > 0;
          if (ck === 'year') manualCitYear = val.trim().length > 0;
        } else {
          draft[bindPath] = val;
          if (bindPath === 'id') manualId = val.trim().length > 0;
        }

        // Update char counter if textarea
        const charEl = form.querySelector(`[data-char-count="${CSS.escape(bindPath)}"]`);
        if (charEl) {
          const maxLen = schema.recordTypes[recordType]?.properties?.[bindPath]?.maxLength || 500;
          charEl.textContent = `${val.length}/${maxLen}`;
        }

        // Smart auto-sync for id, citation.year, and citation.bibtexKey
        if (!manualId && (bindPath === 'shortName' || bindPath === 'name')) {
          const source = draft.shortName || draft.name || '';
          const autoSlug = toSlug(source);
          draft.id = autoSlug;
          const idInput = form.querySelector('[data-bind="id"]');
          if (idInput) idInput.value = autoSlug;
        }

        if (!manualCitYear && (bindPath === 'year' || bindPath === 'yearsActive')) {
          const matchedYear = String(val).match(/\d{4}/)?.[0];
          if (matchedYear) {
            draft.citation.year = matchedYear;
            const cyInput = form.querySelector('[data-bind="citation.year"]');
            if (cyInput) cyInput.value = matchedYear;
          }
        }

        if (
          !manualBibtexKey &&
          (bindPath === 'citation.authors' ||
            bindPath === 'citation.year' ||
            bindPath === 'year' ||
            bindPath === 'shortName' ||
            bindPath === 'name' ||
            bindPath === 'id')
        ) {
          const autoKey = deriveBibtexKey(
            draft.citation.authors,
            draft.citation.year || draft.year || draft.yearsActive,
            draft.id || draft.shortName || draft.name
          );
          if (draft.citation.authors || draft.id) {
            draft.citation.bibtexKey = autoKey;
            const bkInput = form.querySelector('[data-bind="citation.bibtexKey"]');
            if (bkInput) bkInput.value = autoKey;
          }
        }

        updateValidationAndPreview();
      });

      // Checkbox, select & multi-select change handler
      form.addEventListener('change', (e) => {
        const target = e.target;
        if (target instanceof HTMLSelectElement) {
          const bindPath = target.getAttribute('data-bind');
          if (bindPath) {
            draft[bindPath] = target.value;
            updateValidationAndPreview();
          }
          return;
        }
        if (!(target instanceof HTMLInputElement)) return;

        const multiKey = target.getAttribute('data-bind-multi');
        if (multiKey) {
          const current = new Set(Array.isArray(draft[multiKey]) ? draft[multiKey] : []);
          if (target.checked) current.add(target.value);
          else current.delete(target.value);
          const vocab = schema.vocabularies?.[schema.recordTypes[recordType]?.properties?.[multiKey]?.vocabRef] || [];
          // Preserve canonical vocabulary order
          draft[multiKey] = vocab.length > 0 ? vocab.filter((t) => current.has(t)) : Array.from(current);
          target.closest('.pr-vocab-chip')?.classList.toggle('is-checked', target.checked);
          const countEl = form.querySelector(`[data-multi-count="${CSS.escape(multiKey)}"]`);
          if (countEl) countEl.textContent = `${draft[multiKey].length} selected`;
          updateValidationAndPreview();
          return;
        }

        const boolKey = target.getAttribute('data-bind-bool');
        if (boolKey) {
          draft[boolKey] = target.checked;
          updateValidationAndPreview();
          return;
        }
      });

      // Helper action buttons inside form
      form.addEventListener('click', (e) => {
        const btn = e.target instanceof HTMLElement ? e.target.closest('[data-pr-action]') : null;
        if (!btn) return;
        const action = btn.getAttribute('data-pr-action');

        if (action === 'sync-id') {
          manualId = false;
          const autoSlug = toSlug(draft.shortName || draft.name || '');
          draft.id = autoSlug;
          const idInput = form.querySelector('[data-bind="id"]');
          if (idInput) idInput.value = autoSlug;
          updateValidationAndPreview();
        } else if (action === 'sync-bibkey') {
          manualBibtexKey = false;
          const autoKey = deriveBibtexKey(
            draft.citation.authors,
            draft.citation.year || draft.year || draft.yearsActive,
            draft.id || draft.shortName || draft.name
          );
          draft.citation.bibtexKey = autoKey;
          const bkInput = form.querySelector('[data-bind="citation.bibtexKey"]');
          if (bkInput) bkInput.value = autoKey;
          updateValidationAndPreview();
        } else if (action === 'insert-starter') {
          const snippet = getPlatformFetchTemplate(draft.platform, {
            name: draft.name,
            shortName: draft.shortName,
            url: draft.url,
            id: draft.id,
          });
          draft.fetchSnippet = snippet;
          const codeEl = form.querySelector('[data-bind="fetchSnippet"]');
          if (codeEl) codeEl.value = snippet;
          updateValidationAndPreview();
          notify(`Inserted ${draft.platform || 'platform'} starter fetch snippet.`);
        }
      });
    }

    // Export actions
    container.querySelector('#pr-btn-copy-json')?.addEventListener('click', async () => {
      const { record, result } = evaluateCurrentDraft();
      const ok = await copyToClipboard(JSON.stringify(record, null, 2));
      if (!ok) {
        notify('Clipboard copy unavailable.', 'error');
        return;
      }
      if (!result.valid) {
        notify(
          `Copied draft JSON — warning: ${result.errors.length} validation issue${result.errors.length === 1 ? '' : 's'} remain before submission.`,
          'error'
        );
      } else {
        notify('Copied validated JSON record to clipboard.');
      }
    });

    container.querySelector('#pr-btn-download-json')?.addEventListener('click', () => {
      const { record, result } = evaluateCurrentDraft();
      const fname = `${record.id || `new-${recordType}`}.json`;
      downloadTextFile(fname, `${JSON.stringify(record, null, 2)}\n`, 'application/json;charset=utf-8');
      if (!result.valid) {
        notify(
          `Downloaded draft ${fname} — warning: ${result.errors.length} validation issue${result.errors.length === 1 ? '' : 's'} remain before submission.`,
          'error'
        );
      } else {
        notify(`Downloaded ${fname}`);
      }
    });

    container.querySelector('#pr-btn-copy-pr')?.addEventListener('click', async () => {
      const { record, result } = evaluateCurrentDraft();
      if (!result.valid) {
        notify(
          `Resolve ${result.errors.length} schema validation issue${result.errors.length === 1 ? '' : 's'} before copying a PR description.`,
          'error'
        );
        return;
      }
      const md = generatePrMarkdown(record, recordType, repoConfig, result);
      const ok = await copyToClipboard(md);
      notify(ok ? 'Copied GitHub PR description Markdown to clipboard.' : 'Clipboard copy unavailable.', ok ? 'success' : 'error');
    });

    container.querySelector('#pr-btn-github-issue')?.addEventListener('click', async () => {
      const { record, result } = evaluateCurrentDraft();
      if (!result.valid) {
        notify(
          `Resolve ${result.errors.length} schema validation issue${result.errors.length === 1 ? '' : 's'} before opening a GitHub Issue.`,
          'error'
        );
        return;
      }
      const md = generatePrMarkdown(record, recordType, repoConfig, result);
      const title = `[Registry Submission] Add ${record.shortName || record.name || record.id || recordType}`;
      const baseUrl = `https://github.com/${encodeURIComponent(repoConfig.owner)}/${encodeURIComponent(repoConfig.repo)}/issues/new`;
      const params = new URLSearchParams({
        title,
        labels: `registry-submission,${recordType}`,
        body: md,
      });
      const fullUrl = `${baseUrl}?${params.toString()}`;
      if (fullUrl.length > 7200) {
        await copyToClipboard(md);
        const shortParams = new URLSearchParams({
          title,
          labels: `registry-submission,${recordType}`,
          body: '<!-- Full validated PR Markdown was copied to your clipboard — paste below! -->\n',
        });
        window.open(`${baseUrl}?${shortParams.toString()}`, '_blank', 'noopener,noreferrer');
        notify('PR Markdown copied to clipboard (body too long for URL); paste into the GitHub Issue.');
      } else {
        window.open(fullUrl, '_blank', 'noopener,noreferrer');
      }
    });
  }

  /**
   * Build the schema-typed record from the current form draft and validate with full CI parity.
   */
  function evaluateCurrentDraft() {
    const record = draftToSchemaRecord(draft, recordType, schema);
    const result = validateRecord(record, recordType, schema, {
      existingIds,
      existingBibtexKeys: getExistingBibtexKeys(),
      enforceCuratedYearRange: true,
    });
    return { record, result };
  }

  /**
   * Run live schema validation via validateRecord() and refresh JSON preview + field errors.
   */
  function updateValidationAndPreview() {
    const { record, result } = evaluateCurrentDraft();

    // Update JSON preview
    const jsonPre = container.querySelector('#pr-json-pre');
    if (jsonPre) {
      jsonPre.innerHTML = highlightJsonHtml(JSON.stringify(record, null, 2));
    }

    // Update status banner
    const banner = container.querySelector('#pr-status-banner');
    const statusText = container.querySelector('#pr-status-text');
    const statusCount = container.querySelector('#pr-status-count');
    if (banner && statusText && statusCount) {
      banner.classList.toggle('is-valid', result.valid);
      banner.classList.toggle('is-invalid', !result.valid);
      if (result.valid) {
        statusText.textContent = 'Valid — Ready for GitHub PR';
        statusCount.textContent =
          result.warnings.length > 0 ? `${result.warnings.length} note(s)` : '0 errors';
      } else {
        statusText.textContent = 'Schema validation incomplete';
        statusCount.textContent = `${result.errors.length} issue${result.errors.length === 1 ? '' : 's'}`;
      }
    }

    // Gate PR submission actions until schema validation passes
    const invalidHint = `Resolve ${result.errors.length} schema validation issue${result.errors.length === 1 ? '' : 's'} to enable PR submission`;
    const copyPrBtn = container.querySelector('#pr-btn-copy-pr');
    const githubIssueBtn = container.querySelector('#pr-btn-github-issue');
    if (copyPrBtn instanceof HTMLButtonElement) {
      copyPrBtn.disabled = !result.valid;
      copyPrBtn.setAttribute('aria-disabled', String(!result.valid));
      copyPrBtn.title = result.valid ? 'Copy validated GitHub PR description Markdown' : invalidHint;
    }
    if (githubIssueBtn instanceof HTMLButtonElement) {
      githubIssueBtn.disabled = !result.valid;
      githubIssueBtn.setAttribute('aria-disabled', String(!result.valid));
      githubIssueBtn.title = result.valid ? 'Open pre-filled GitHub Issue with validated entry' : invalidHint;
    }

    // Clear previous per-field inline errors
    container.querySelectorAll('.pr-field.has-error').forEach((el) => el.classList.remove('has-error'));
    container.querySelectorAll('[data-error-for]').forEach((el) => {
      el.textContent = '';
      el.hidden = true;
    });

    // Map first error per field path
    const errorByField = new Map();
    for (const err of result.errors) {
      const cleanPath = String(err.path || '').replace(/\[\d+\]$/, '');
      if (!errorByField.has(cleanPath)) {
        errorByField.set(cleanPath, err.message);
      }
    }

    for (const [path, msg] of errorByField.entries()) {
      const fieldWrap = container.querySelector(`.pr-field[data-field-path="${CSS.escape(path)}"]`);
      const errSpan = container.querySelector(`[data-error-for="${CSS.escape(path)}"]`);
      if (fieldWrap) fieldWrap.classList.add('has-error');
      if (errSpan) {
        errSpan.textContent = msg;
        errSpan.hidden = false;
      }
    }

    // Populate clickable issues & warnings list
    const issuesList = container.querySelector('#pr-issues-list');
    if (issuesList) {
      const itemsHtml = [
        ...result.errors.map(
          (err) => `
            <li>
              <button type="button" class="pr-issue-btn" data-jump-path="${esc(String(err.path || '').replace(/\[\d+\]$/, ''))}">
                <span class="pr-issue-path">${esc(err.path || 'record')}</span>${esc(err.message)}
              </button>
            </li>
          `
        ),
        ...result.warnings.map(
          (warn) => `
            <li>
              <button type="button" class="pr-issue-btn is-warning" data-jump-path="${esc(String(warn.path || '').replace(/\[\d+\]$/, ''))}">
                <span class="pr-issue-path">Note · ${esc(warn.path)}</span>${esc(warn.message)}
              </button>
            </li>
          `
        ),
      ];

      issuesList.innerHTML =
        itemsHtml.length > 0
          ? itemsHtml.join('')
          : `<li class="pr-help" style="padding:4px 2px;color:var(--accent-emerald-text);">All required fields, controlled vocabularies, HTTPS URLs, and citation rules pass parity checks.</li>`;

      issuesList.querySelectorAll('[data-jump-path]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const path = btn.getAttribute('data-jump-path');
          if (!path) return;
          const fieldWrap = container.querySelector(`.pr-field[data-field-path="${CSS.escape(path)}"]`);
          if (fieldWrap) {
            fieldWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const focusable = fieldWrap.querySelector('input, select, textarea');
            if (focusable instanceof HTMLElement) focusable.focus();
          }
        });
      });
    }
  }

  // Initial mount
  if (options.initialPrefill) {
    applyPrefill(options.initialPrefill);
  } else {
    renderFull();
  }

  return {
    setRecordType(nextType) {
      const norm = normalizeRecordType(nextType);
      if (!norm) return;
      recordType = norm;
      draft = createEmptyDraft(recordType, schema);
      manualId = false;
      manualBibtexKey = false;
      manualCitYear = false;
      renderFull();
    },
    setPrefill(prefill) {
      applyPrefill(prefill);
    },
    reset() {
      draft = createEmptyDraft(recordType, schema);
      manualId = false;
      manualBibtexKey = false;
      manualCitYear = false;
      renderFull();
    },
    getRecord() {
      return draftToSchemaRecord(draft, recordType, schema);
    },
  };
}
