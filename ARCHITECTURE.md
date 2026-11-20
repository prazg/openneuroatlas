# OpenNeuroAtlas — Architecture & Technical Specification

> **OpenNeuroAtlas** is a living, PR-extensible GitHub Pages web registry cataloging open-access datasets, foundation models & clinical toolkits, and MICCAI / open benchmarks across **neurosurgery, neuroimaging, neuro-oncology, and surgical AI**.

---

## 1. Architectural Principles & Environment Constraints

1. **Zero-Build Static Web Application**: Pure HTML5, CSS3, and vanilla ES Modules (`<script type="module">`). No Node.js, npm, TypeScript compiler, Webpack/Vite bundler, or framework runtime.
2. **100% Offline & Zero Mandatory External CDNs**: All styling, fonts (refined system editorial stacks), icons (inline SVG), charts (pure SVG DOM), and logic ship inside the repository. The site runs identically on **GitHub Pages** and locally via any static HTTP server (`python -m http.server 8000`).
3. **Single Source of Truth (`schemas/registry-schema.json`)**: Controlled vocabularies, field validation rules, regexes, and PR Builder form metadata live in one machine-readable JSON schema consumed simultaneously by:
   - `tests/validate_registry.py` (Python 3.12 stdlib-only CLI & GitHub Actions CI gate)
   - `js/prBuilder.js` (in-browser live validation and dynamic form generation)
   - `js/registryEngine.js` (filter chip taxonomy & automated gap detection)
   - `js/analyticsCharts.js` (Modality × Pathology heatmap axes & access-tier buckets)
4. **Python 3.12 Stdlib-Only Validation**: CI gating and local schema checks use **only** Python 3.12 standard library modules (`json`, `re`, `sys`, `pathlib`, `urllib.parse`, `argparse`). Zero `pip install` steps.
5. **Scientific Integrity & Transparency**: Every dataset documents honest `limitations` (cohort bias, missing clinical phases, label noise), verified `https://` URLs, reproducible `fetchSnippet` code, and structured `citation` metadata for instant academic export.

---

## 2. Exact Directory Layout

```text
openneuroatlas/
├── index.html                          # Semantic single-page Atlas shell (Explorer, Analytics, PR Builder, Comparison Tray, Detail Drawer)
├── css/
│   └── styles.css                      # Editorial Scientific Atlas design system (dark-slate default + light paper theme toggle, responsive layout, SVG chart tokens)
├── js/
│   ├── app.js                          # Top-level state store, URL-hash deep-linking, theme controller, view routing, comparison tray & modal orchestration
│   ├── registryEngine.js               # Data loader, weighted full-text search index, multi-facet filtering, dynamic facet counts, sorting, analytics & gap detection
│   ├── exporters.js                    # Single & bulk BibTeX (.bib), RIS (.ris), APA 7th, GFM Markdown tables, RFC 4180 CSV, platform starter fetch snippets
│   ├── analyticsCharts.js              # Pure responsive SVG charts: Interactive Modality × Pathology Heatmap, Access-Tier & Cohort Size Bar Chart, Release Timeline
│   └── prBuilder.js                    # Schema-driven "Submit via GitHub PR" form, live validator, JSON preview/download, pre-filled GitHub Issue/PR markdown generator
├── data/
│   ├── datasets.json                   # Curated neurosurgery / neuroimaging / neuro-oncology / surgical AI datasets
│   ├── models.json                     # Open-source foundation models, segmentation frameworks, surgical vision models, neuroimaging viewers & clinical plugins
│   └── challenges.json                 # MICCAI & open benchmarks / recurring leaderboards
├── schemas/
│   └── registry-schema.json            # Single-source-of-truth controlled vocabularies, envelope spec, field rules, integrity rules & UI hints
├── tests/
│   └── validate_registry.py            # Python 3.12 stdlib-only schema & cross-record integrity validator (exits 0 on pass, 1 on failure)
├── .github/
│   └── workflows/
│       └── validate-registry.yml       # GitHub Actions CI gate running tests/validate_registry.py on every PR and push to main
├── ARCHITECTURE.md                     # This specification
├── CONTRIBUTING.md                     # Concise human PR contribution guide
└── README.md                           # Project overview, live link, local preview command, citation instructions
```

### Module Dependency Graph (Strict Acyclic ES Modules)

```text
index.html
  └── js/app.js
        ├── js/registryEngine.js   (pure data/state/analytics — zero DOM access)
        ├── js/exporters.js        (pure string/export formatters + clipboard/download helpers)
        ├── js/analyticsCharts.js  (SVG DOM renderers — receives analytics + filter callbacks)
        └── js/prBuilder.js        (PR form DOM + schema validator — imports platform snippet helpers from exporters.js)
```

> **Design rule**: `registryEngine.js` and the formatter functions in `exporters.js` have zero DOM coupling, enabling deterministic inspection and clean separation between data computation and rendering.

---

## 3. Data Files & Canonical JSON Contract

### 3.1 File Envelope (`data/datasets.json`, `data/models.json`, `data/challenges.json`)

Every registry file uses a uniform metadata envelope validated against `schemas/registry-schema.json#fileEnvelope`:

```json
{
  "schemaVersion": "1.0.0",
  "recordType": "datasets",
  "lastUpdated": "2026-11-19",
  "records": [
    { "...": "..." }
  ]
}
```

| Envelope Field | Type | Constraints |
|---|---|---|
| `schemaVersion` | `string` | SemVer (`^\d+\.\d+\.\d+$`), must match `schemas/registry-schema.json` `schemaVersion`. |
| `recordType` | `string` | One of `"datasets"`, `"models"`, `"challenges"` — must match filename `data/<recordType>.json`. |
| `lastUpdated` | `string` | ISO 8601 date (`YYYY-MM-DD`). Rendered in the Atlas footer/header without external API calls. |
| `records` | `array` | Array of validated record objects matching `recordTypes[recordType]`. |

---

### 3.2 Shared `citation` Object Specification

Used identically across **Datasets**, **Models / Toolkits**, and **Challenges / Benchmarks** so `exporters.js` produces uniform BibTeX, RIS, and APA 7th citations:

| Field | Type | Req | Nullable | Validation Rule |
|---|---|---|---|---|
| `authors` | `string` | Yes | No | 3–600 chars. Canonical BibTeX format: `"Last, First and Last, First"` (append `" and others"` when truncating consortium author lists). Deterministic delimiter `" and "` enables lossless BibTeX, RIS (`AU  -`), and APA 7th rendering. |
| `title` | `string` | Yes | No | 5–350 chars. Canonical title of the primary reference paper, preprint, or dataset descriptor. |
| `venue` | `string` | Yes | No | 2–180 chars. Journal, conference, preprint server, or repository (e.g., `"Scientific Data"`, `"Nature Methods"`, `"IEEE TMI"`, `"MICCAI"`, `"arXiv"`). |
| `year` | `integer` | Yes | No | `1990`–`2035`. |
| `bibtexKey` | `string` | Yes | No | `^[A-Za-z][A-Za-z0-9_-]{2,63}$` (e.g., `"bakas2022upenngbm"`). Unique per collection. |
| `doi` | `string` | Yes | Yes | Bare DOI (`^10\.\d{4,9}/[-._;()/:A-Za-z0-9]+$`) with **no** `https://doi.org/` prefix, or `null` if no DOI exists. |

---

### 3.3 Record Type 1: Dataset (`data/datasets.json`)

| Field | Type | Req | Nullable | Constraints / Controlled Vocab |
|---|---|---|---|---|
| `id` | `string` | Yes | No | Globally unique slug: `^[a-z0-9]+(?:-[a-z0-9]+)*$` (2–64 chars). |
| `name` | `string` | Yes | No | Official dataset name (3–160 chars). |
| `shortName` | `string` | Yes | No | Concise badge/table label (2–40 chars, e.g., `"UPENN-GBM"`, `"ReMIND"`). |
| `year` | `integer` | Yes | No | Primary public release year (`1990`–`2035`). |
| `pathologies` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.pathologies`. |
| `modalities` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.modalities`. |
| `clinicalPhases` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.clinicalPhases`. |
| `tasks` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.tasks`. |
| `cohortSize` | `integer` | Yes | **Yes** | Patient/subject count (`1`–`10000000`) for sorting & analytics, or `null` if unreported / video-frame-only / phantom cohort. |
| `cohortDisplay` | `string` | Yes | No | Human-readable scale (2–80 chars, e.g., `"114 patients"`, `"630 patients (671 scans)"`, `"25 endoscopic videos"`). |
| `annotations` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.annotations`. |
| `molecularMarkers` | `string[]` | Yes | No | ≥0 unique items from `vocabularies.molecularMarkers` (`[]` for non-oncology or imaging-only cohorts). |
| `accessTier` | `string` | Yes | No | Exact enum `vocabularies.accessTiers`: `"Open Access"` \| `"Registration Required"` \| `"Controlled DUA"`. |
| `license` | `string` | Yes | No | Data license or terms string (2–100 chars; suggestions in `suggestions.dataLicenses`). |
| `platform` | `string` | Yes | No | Exact enum `vocabularies.datasetPlatforms`. |
| `url` | `string` | Yes | No | Verified `https://` URL to official dataset landing page (no localhost/placeholders). |
| `paperUrl` | `string` | **No** | **Yes** | Optional verified `https://` URL to publication / DOI / preprint. |
| `citation` | `object` | Yes | No | Unified `definitions.citation` object. |
| `fetchSnippet` | `string` | Yes | No | Copyable CLI/Python starter download snippet (10–2000 chars). |
| `highlights` | `string` | Yes | No | 1–2 sentence clinical & AI value summary (20–500 chars). |
| `limitations` | `string` | Yes | No | Brief, honest note on cohort biases, missing phases, protocol drift, or annotation gaps (15–500 chars). |

---

### 3.4 Record Type 2: Model / Toolkit (`data/models.json`)

| Field | Type | Req | Nullable | Constraints / Controlled Vocab |
|---|---|---|---|---|
| `id` | `string` | Yes | No | Globally unique slug: `^[a-z0-9]+(?:-[a-z0-9]+)*$` (2–64 chars). |
| `name` | `string` | Yes | No | Official model, framework, or clinical plugin name (2–120 chars). |
| `category` | `string` | Yes | No | Exact enum `vocabularies.modelCategories`. |
| `year` | `integer` | Yes | No | Initial or flagship release year (`1990`–`2035`). |
| `modalities` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.modalities`. |
| `pathologies` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.pathologies` (use `"Multi-Pathology"` for general frameworks/viewers). |
| `architecture` | `string` | Yes | No | Concise model backbone or engine summary (3–160 chars). |
| `weightsAvailable` | `boolean` | Yes | No | `true` if pretrained weights/checkpoints are openly downloadable; `false` otherwise. |
| `openSourceLicense` | `string` | Yes | No | SPDX/open-source license string (2–80 chars; suggestions in `suggestions.openSourceLicenses`). |
| `framework` | `string` | Yes | No | Primary runtime/platform (2–80 chars, e.g., `"PyTorch / MONAI"`, `"WebGL2 / JS"`, `"3D Slicer"`). |
| `repoUrl` | `string` | Yes | No | Verified `https://` URL to source repository. |
| `weightsUrl` | `string` | **No** | **Yes** | Optional verified `https://` URL to hosted checkpoints. Cross-field rule: if non-null, `weightsAvailable` MUST be `true`. |
| `paperUrl` | `string` | **No** | **Yes** | Optional verified `https://` URL to primary paper or preprint. |
| `citation` | `object` | Yes | No | Unified `definitions.citation` object. |
| `installSnippet` | `string` | Yes | No | Copyable install & quick-start snippet (10–2000 chars). |
| `highlights` | `string` | Yes | No | 1–2 sentence technical & clinical utility summary (20–500 chars). |

---

### 3.5 Record Type 3: Challenge / Benchmark (`data/challenges.json`)

| Field | Type | Req | Nullable | Constraints / Controlled Vocab |
|---|---|---|---|---|
| `id` | `string` | Yes | No | Globally unique slug: `^[a-z0-9]+(?:-[a-z0-9]+)*$` (2–64 chars). |
| `name` | `string` | Yes | No | Official challenge or open benchmark name (3–160 chars). |
| `organizer` | `string` | Yes | No | Organizing society, consortium, or institution (2–140 chars). |
| `yearsActive` | `string` | Yes | No | Pattern `^\d{4}(?:[–-](?:\d{4}|Present)|(?:,\s*\d{4})+)?$` (e.g., `"2012–Present"`, `"2021–2024"`, `"2023"`). First 4 digits drive timeline placement & sorting. |
| `status` | `string` | Yes | No | Exact enum `vocabularies.challengeStatuses`. |
| `modalities` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.modalities`. |
| `pathologies` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.pathologies`. |
| `tasks` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.tasks`. |
| `metrics` | `string[]` | Yes | No | ≥1 unique items from `vocabularies.metrics`. |
| `platform` | `string` | Yes | No | Exact enum `vocabularies.challengePlatforms`. |
| `url` | `string` | Yes | No | Verified `https://` URL to challenge site / leaderboard. |
| `paperUrl` | `string` | **No** | **Yes** | Optional verified `https://` URL to benchmark summary paper. |
| `citation` | `object` | Yes | No | Unified `definitions.citation` object. |
| `highlights` | `string` | Yes | No | 1–2 sentence benchmark scope & significance summary (20–500 chars). |

---

## 4. Controlled Vocabularies (Exact Canonical Strings)

All filter chips, heatmap axes, gap detectors, PR Builder pickers, and CI validation rules reference `schemas/registry-schema.json#vocabularies` **verbatim**:

### `pathologies` (14 terms — Heatmap Rows)
1. `Glioma / GBM`
2. `Brain Metastases`
3. `Meningioma`
4. `Pituitary & Sellar`
5. `Pediatric Tumors`
6. `Skull Base / Schwannoma`
7. `Stroke & ICH`
8. `Aneurysm & Vascular`
9. `Epilepsy`
10. `Neurodegenerative`
11. `Neurotrauma / TBI`
12. `Spine`
13. `Healthy / Normative`
14. `Multi-Pathology`

### `modalities` (13 terms — Heatmap Columns)
1. `Structural MRI`
2. `Diffusion MRI / DTI`
3. `Perfusion MRI`
4. `fMRI`
5. `CT / CTA`
6. `MRA / DSA`
7. `PET / Nuclear`
8. `Intra-Op Ultrasound`
9. `Surgical Video`
10. `Optical / Fluorescence`
11. `Histopathology / WSI`
12. `Electrophysiology`
13. `Genomics / Omics`

### `clinicalPhases` (5 terms — Datasets)
- `Pre-Op`
- `Intra-Op`
- `Early Post-Op`
- `Longitudinal`
- `Pathology/Ex-Vivo`

### `tasks` (18 terms — Datasets & Challenges)
- `Tumor Segmentation`
- `Anatomy / Structure Segmentation`
- `Vessel / Vascular Segmentation`
- `Lesion / Hemorrhage Detection`
- `Resection Cavity Segmentation`
- `Image Registration / Brain Shift`
- `Image Synthesis / Inpainting`
- `Super-Resolution / Reconstruction`
- `Skull Stripping / Preprocessing`
- `Survival / Outcome Prediction`
- `Molecular / Radiogenomic Prediction`
- `Tumor Classification / Grading`
- `Surgical Phase Recognition`
- `Instrument / Tool Tracking`
- `3D Scene Reconstruction / Navigation`
- `Pathology / Tissue Classification`
- `Seizure / Functional Mapping`
- `Foundation Representation / Self-Supervised`

### `annotations` (14 terms — Datasets)
- `Voxel-wise Tumor Sub-regions`
- `Voxel-wise Lesion / Infarct Masks`
- `Voxel-wise Anatomy / Parcellation`
- `Vessel / Centerline Masks`
- `Bounding Boxes / Detection`
- `Anatomical Landmarks / Fiducials`
- `Surgical Phase / Step Timestamps`
- `Instrument / Anatomy Polygons`
- `Clinical Outcomes / Survival`
- `Molecular / Genetic Labels`
- `Histopathology / Region Labels`
- `Radiomics / Tabular Features`
- `Clinical Reports / Structured EHR`
- `Unlabeled / Self-Supervised`

### `molecularMarkers` (15 terms — Datasets, optional empty array `[]`)
- `IDH`, `MGMT`, `1p/19q`, `ATRX`, `TERT`, `EGFR`, `TP53`, `BRAF`, `H3K27M`, `CDKN2A/B`, `Ki-67`, `WHO Grade`, `DNA Methylation`, `RNA-Seq`, `WES / WGS`

### `accessTiers` (3 terms — Datasets)
- `Open Access`
- `Registration Required`
- `Controlled DUA`

### `datasetPlatforms` (7 terms — Datasets)
- `TCIA`, `Synapse`, `OSF`, `Hugging Face`, `Figshare`, `GitHub`, `Institutional Portal`

### `challengePlatforms` (9 terms — Challenges)
- `Synapse`, `Grand Challenge`, `Codabench`, `Kaggle`, `TCIA`, `OSF`, `Hugging Face`, `GitHub`, `Institutional Portal`

### `modelCategories` (4 terms — Models / Toolkits)
- `Foundation Model`
- `Segmentation Framework`
- `Surgical Vision`
- `Neuroimaging Viewer / Clinical Plugin`

### `challengeStatuses` (2 terms — Challenges)
- `Active / Recurring`
- `Completed (Open Benchmark)`

### `metrics` (18 terms — Challenges)
- `Dice`, `Lesion-wise Dice`, `HD95`, `Lesion-wise HD95`, `NSD`, `clDice`, `Betti Error`, `IoU`, `TRE`, `mAP`, `F1`, `AUROC`, `Accuracy / Balanced Accuracy`, `Sensitivity / Specificity`, `C-Index`, `MAE / RMSE`, `PSNR / SSIM`, `Runtime / Efficiency`

---

## 5. Module-by-Module Technical Specification

### 5.1 `js/registryEngine.js` — Data, Search, Faceting, Analytics & Gap Engine

#### Public API
```js
export async function loadRegistry(basePath = '.')
// Returns:
// {
//   schema,
//   meta: { schemaVersion, lastUpdated },
//   datasets: IndexedRecord[],
//   models: IndexedRecord[],
//   challenges: IndexedRecord[],
//   allRecords: IndexedRecord[],
//   byId: Map<string, IndexedRecord>
// }

export function createInitialFilterState()
export function filterAndSortRecords(records, filterState)
export function computeFacetCounts(records, filterState, schema)
export function computeAnalytics(registry)
export function detectOpenScienceGaps(analytics, registry)
```

#### Core Mechanics
- **Loading & Normalization**:
  - Fetches `schemas/registry-schema.json`, `data/datasets.json`, `data/models.json`, and `data/challenges.json` in parallel via `Promise.all`.
  - Attaches internal non-enumerable or prefixed metadata properties to each loaded record:
    - `_type`: `'dataset' | 'model' | 'challenge'`
    - `_year`: integer (`record.year` for datasets/models; `parseInt(record.yearsActive.slice(0, 4), 10)` for challenges)
    - `_searchFields`: pre-lowercased weighted buckets (`tier1`: `id`, `shortName`, `name`; `tier2`: `pathologies`, `modalities`, `tasks`, `molecularMarkers`, `annotations`, `architecture`, `organizer`, `platform`, `category`, `metrics`; `tier3`: `highlights`, `limitations`, `license`, `openSourceLicense`, `framework`, `citation.authors`, `citation.title`, `citation.venue`, `citation.doi`).
- **Instant Full-Text Search**:
  - Splits query into lowercase whitespace tokens; every token must match at least one bucket (boolean AND across tokens).
  - Weighted relevance score: exact match in `tier1` (+100), prefix match in `tier1` (+50), substring in `tier1` (+30), match in `tier2` (+15), match in `tier3` (+5).
- **Multi-Facet Filtering**:
  - Supports active tab (`all` | `datasets` | `models` | `challenges`) plus facets: `pathologies[]`, `modalities[]`, `clinicalPhases[]`, `tasks[]`, `annotations[]`, `molecularMarkers[]`, `accessTiers[]`, `platforms[]`, `modelCategories[]`, `weightsOnly` (`boolean`), `challengeStatuses[]`, `metrics[]`, `yearMin`, `yearMax`, `cohortMin`.
  - **Semantics**: Logical **OR** within a single facet (e.g., selecting `Glioma / GBM` + `Meningioma` matches either), logical **AND** across distinct facets (e.g., `Glioma / GBM` AND `Intra-Op Ultrasound` AND `Open Access`).
  - **Dynamic Facet Counts**: For each facet `F`, evaluates record counts using all active filters *except* `F` (disjunctive faceting), so users can see exact counts before clicking an alternative chip in the same group.
- **Sorting**:
  - `relevance` (automatic default when search query is non-empty), `year-desc` (default when no query), `year-asc`, `cohort-desc` (nulls placed last), `name-asc`, `openness` (`Open Access` → `Registration Required` → `Controlled DUA`).
- **Analytics Aggregation (`computeAnalytics`)**:
  - **Modality × Pathology Coverage Matrix**: 2D structure indexed over `schema.vocabularies.pathologies` × `schema.vocabularies.modalities` (excluding `"Multi-Pathology"` from gap alerts while still showing it as the bottom aggregate row). Each cell stores `{ total, datasets, models, challenges, openAccessDatasets, totalPatients, recordIds }`.
  - **Access-Tier Distribution**: For each tier in `vocabularies.accessTiers`, computes `{ tier, datasetCount, sharePct, totalPatients }`.
  - **Cohort Size Distribution**: Buckets datasets into `['< 50', '50–199', '200–999', '1,000+', 'Unspecified / Video']` plus `topCohorts` (top 8 datasets sorted by `cohortSize`).
  - **Release Timeline**: Continuous yearly series from `minYear` to `maxYear`: `{ year, datasets, models, challenges, openAccessDatasets, total, cumulativeDatasets, cumulativeAll }`.
- **Automated Open-Science Gap Detection (`detectOpenScienceGaps`)**:
  Generates structured, clickable insight cards sorted by severity:
  1. **Intraoperative & Surgical Modality Blind Spots** (`Critical Gap`): High-impact oncology/vascular pathologies with `0` datasets in `Intra-Op Ultrasound`, `Surgical Video`, or `Optical / Fluorescence`.
  2. **Access-Barrier Bottlenecks** (`Access Bottleneck`): Pathology × Modality cells or entire pathologies where `datasets > 0` yet `openAccessDatasets === 0` (locked solely behind registration or DUA).
  3. **Single-Cohort Reproducibility Risks** (`Sparse Coverage`): Pathology × Modality intersections with exactly `1` public dataset (no external validation cohort).
  4. **Perioperative Phase Gaps** (`Phase Gap`): Oncology pathologies missing `"Intra-Op"`, `"Early Post-Op"`, or `"Longitudinal"` datasets.
  5. **Biomarker & Benchmark Gaps** (`Biomarker / Benchmark Gap`): Oncology pathologies lacking `IDH`/`MGMT` molecularly annotated cohorts, or pathologies with `≥ 2` datasets and `0` open challenges.
  Each gap exposes a `filterPayload` so clicking a gap card filters the Atlas directly to inspect nearby resources.

---

### 5.2 `js/exporters.js` — Academic Citations, Tables, CSV & Starter Code

#### Public API
```js
export function toBibtex(record)
export function toBulkBibtex(records)
export function toRis(record)
export function toBulkRis(records)
export function toApa(record)
export function toBulkApa(records)
export function toMarkdownTable(records, viewType = 'datasets')
export function toCsv(records, viewType = 'datasets')
export function getPlatformFetchTemplate(platform, { name, shortName, url, id } = {})
export function copyToClipboard(text)
export function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8')
```

#### Format Rules
- **BibTeX (`.bib`)**:
  - Infers entry type cleanly: `@inproceedings` when `venue` matches conference markers (`MICCAI`, `CVPR`, `NeurIPS`, `IPMI`, `ISBI`, `MIDL`, `ICCV`, `ICLR`), `@misc` when `venue` is a repository/preprint (`arXiv`, `TCIA`, `Synapse`, `GitHub`, `OSF`, `Hugging Face`, `Zenodo`), else `@article`.
  - Escapes LaTeX special chars (`&`, `%`, `#`, `_`) in `title`/`venue` while wrapping uppercase acronyms (`GBM`, `MRI`, `CT`, `BraTS`, `3D`, `IDH`, `MGMT`) in `{...}` to protect capitalization.
  - Deduplicates colliding `bibtexKey`s during bulk export (`key`, `key_2`, ...).
- **RIS (`.ris`)**:
  - Maps `TY  - CONF` / `JOUR` / `DATA` / `COMP`, splits `citation.authors` on `/\s+and\s+/i` into individual `AU  -` lines (ignoring `"others"`), emits `TI`, `PY`, `JO`/`T2`, `DO`, `UR`, `KW` (pathologies + modalities), `N1` (highlights), and `ER  -`.
- **APA 7th**:
  - Converts `"Last, First Middle"` → `"Last, F. M."`, joins with `, ` and `& ` before final author (or `et al.` when `"others"` is present), appends `(Year). Title. Venue. https://doi.org/<doi>` (falling back to primary `url`/`repoUrl` if `doi` is `null`).
- **Markdown Table (`.md`)**:
  - Produces GFM pipe-escaped tables tailored per view (`datasets`, `models`, `challenges`, or `all`), ready to drop directly into manuscripts, systematic reviews, or GitHub READMEs.
- **CSV (`.csv`)**:
  - RFC 4180 escaping with optional UTF-8 BOM (`\uFEFF`) for clean Excel opening; array fields joined with `"; "`; citation flattened to `citation_bibtex_key`, `citation_year`, `citation_doi`.
- **Platform Starter Fetch Snippets (`getPlatformFetchTemplate`)**:
  - Every dataset provides a bespoke `fetchSnippet`, and `exporters.js` exposes copy-paste platform templates (also powering PR Builder's "Insert Platform Starter" button) for all 7 dataset platforms:
    - **TCIA**: `pip install tcia_utils` + `nbia.downloadSeries(...)` / NBIA Data Retriever CLI note
    - **Synapse**: `pip install synapseclient` + `synapse login` + `synapse get -r synXXXXXXXX`
    - **Hugging Face**: `pip install huggingface_hub` + `huggingface-cli download <org>/<dataset> --repo-type dataset --local-dir ./data/<id>`
    - **OSF**: `pip install osfclient` + `osf -p <project_id> clone ./data/<id>`
    - **Figshare**: `curl -L` / Figshare API v2 Python download loop
    - **GitHub**: `git clone --depth 1 <repo_url>` / GitHub Release asset fetch
    - **Institutional Portal**: Structured portal URL, DUA checklist, and post-download BIDS/NIfTI verification stub

---

### 5.3 `js/analyticsCharts.js` — Pure Responsive SVG Visualizations

Zero external charting libraries. All charts render crisp `<svg viewBox="...">` elements styled via CSS variables (automatically adapting to Dark & Light themes) with shared floating tooltips, keyboard focusability (`tabindex="0"`, `Enter`/`Space` activation), and ARIA descriptions.

#### Public API
```js
export function renderCoverageHeatmap(container, analytics, activeFilters, options)
// options: { metric: 'all' | 'datasets' | 'openAccess', onCellClick(modality, pathology), onAxisClick(axis, value) }

export function renderAccessCohortChart(container, analytics, activeFilters, options)
// options: { mode: 'access' | 'cohorts', onTierClick(accessTier), onDatasetClick(id) }

export function renderReleaseTimeline(container, analytics, activeFilters, options)
// options: { onYearClick(year) }
```

#### Visual Specifications
1. **Interactive Modality × Pathology Coverage Heatmap**:
   - **Axes**: Rows = `vocabularies.pathologies` (14), Columns = `vocabularies.modalities` (13) with rotated `-38°` column headers.
   - **Encoding**:
     - `0` records: Recessed dashed gap cell (`stroke-dasharray: 2 2`) with subtle amber hover border highlighting an open-science gap.
     - `≥ 1` records: Discrete 5-step perceptually uniform Emerald/Cyan intensity ramp scaled to dataset/record max, displaying exact numeric count centered inside the cell in tabular monospace font.
   - **Interactivity**:
     - Clicking any populated cell toggles `(modality, pathology)` filter in `app.js` and updates the registry explorer immediately (with a visual active selection ring + filter pill banner).
     - Clicking a zero-count cell opens the PR Builder pre-populated with that exact `modality` and `pathology` ("Contribute a dataset to fill this gap!") or shows gap info!
     - Clicking a row or column header filters by that entire pathology or modality.
     - Metric switcher pill: `All Records` | `Datasets Only` | `Open Access Only`.
2. **Access-Tier & Cohort Size Bar Chart**:
   - Toggleable or side-by-side two-panel responsive SVG:
     - **Access-Tier Breakdown**: Horizontal bars for `Open Access` (emerald), `Registration Required` (cyan), and `Controlled DUA` (amber) displaying both dataset counts, percentage share, and cumulative patients. Clicking a bar filters the registry by `accessTier`.
     - **Cohort Size Landscape**: Bucket histogram (`< 50`, `50–199`, `200–999`, `1,000+`, `Unspecified / Video`) plus clickable Top-8 largest open cohorts horizontal bar chart.
3. **Open-Access Release Timeline**:
   - Stacked vertical bars by release year (`Datasets` = emerald, `Models / Toolkits` = cyan, `Challenges` = amber) overlaid with a smooth SVG polyline showing cumulative registry growth on a secondary right axis.
   - Hovering a year highlights the column and reveals exact yearly & cumulative totals; clicking a year filters the registry to that release year.

---

### 5.4 `js/prBuilder.js` — Schema-Driven "Submit via GitHub PR" Builder

#### Public API
```js
export function validateRecordAgainstSchema(record, recordType, schema, existingIds = new Set())
// Returns: { valid: boolean, errors: Array<{ path, message }>, warnings: Array<{ path, message }> }

export function generatePrMarkdown(record, recordType, repoConfig)
export function mountPrBuilder(container, { schema, registry, repoConfig, initialPrefill })
```

#### Capabilities
1. **100% Schema-Driven Form Rendering**: Reads `schema.recordTypes[type].properties`, `schema.definitions.citation`, `schema.vocabularies`, and `schema.suggestions` to render grouped form sections (`Core Identity`, `Clinical & Technical Scope`, `Access & Code`, `Citation & Notes`) with multi-select chip grids, `<select>` dropdowns, `<datalist>` suggestions, and code textareas.
2. **Parity With CI Validator**: `validateRecordAgainstSchema()` enforces the exact same type, required, nullability, length, range, regex, vocabulary, forbidden host, `weightsUrl`→`weightsAvailable`, and duplicate ID checks as `tests/validate_registry.py`.
3. **Productivity Helpers**:
   - Auto-slugify `id` from `shortName`/`name` (unlockable for manual edits)
   - Auto-generate `bibtexKey` from first author surname + `year` + short slug
   - "Insert Platform Starter Snippet" button populating `fetchSnippet` from `exporters.getPlatformFetchTemplate(platform, ...)`
   - Optional prefill support (e.g., when clicking a gap cell in the Heatmap to propose a missing dataset)
4. **Live JSON Preview & Actions**:
   - Pure CSS/JS syntax-highlighted JSON preview updating on every input event
   - Live status badge (`Valid — Ready for PR` in emerald vs `N issues remaining` in amber/rose with clickable jump-to-field links)
   - Action bar:
     - **Copy Record JSON** (ready to append into `data/<type>.json` → `"records"`)
     - **Download `<id>.json`**
     - **Copy GitHub PR / Issue Markdown** (structured summary table, verification checklist, target file path, and fenced JSON block)
     - **Open Pre-filled GitHub Issue** (builds `https://github.com/<owner>/<repo>/issues/new?title=...&labels=registry-submission,<type>&body=...` with URL-length guard so long snippets gracefully prompt pasting from clipboard)

---

### 5.5 `js/app.js`, `index.html`, `css/styles.css` — Application Shell & State

#### State & Deep-Linking Architecture
- Central state object held in `js/app.js`:
  - `activeView`: `'explorer' | 'analytics' | 'contribute'`
  - `activeTab`: `'datasets' | 'models' | 'challenges' | 'all'`
  - `displayMode`: `'cards' | 'table'`
  - `filters`: filter state object from `registryEngine.createInitialFilterState()`
  - `sortBy`: `'year-desc' | 'year-asc' | 'cohort-desc' | 'name-asc' | 'openness' | 'relevance'`
  - `selectedIds`: `Set<string>` (Comparison & Bulk Export basket)
  - `drawerRecordId`: `string | null` (open Detail Slide-Over Drawer)
  - `theme`: `'dark' | 'light'` (persisted in `localStorage['openneuroatlas-theme']`, defaulting to dark editorial slate unless user explicitly toggled light)
- **URL Hash Serialization**: Encodes active view, tab, search query, and active filter arrays into `location.hash` (e.g., `#view=explorer&tab=datasets&pathology=Glioma+%2F+GBM&modality=Intra-Op+Ultrasound&record=remind-2023`) so every filtered view or specific record is shareable via direct URL without server-side routing!
- **Comparison Tray & Bulk Export Bar**: Appears docked at the bottom whenever `selectedIds.size > 0`, letting researchers open a side-by-side comparison modal or one-click export all selected records as `.bib`, `.ris`, APA list, Markdown comparison table, or `.csv`.
- **Detail Slide-Over Drawer**: Displays complete record metadata, clinical-phase progression pills, molecular marker chips, verified primary & paper links, amber **Limitations & Biases** callout box, syntax-tinted copyable `fetchSnippet`/`installSnippet` code card, and tabbed **BibTeX / RIS / APA** citation copier.
- **Keyboard Shortcuts**: `/` focuses search bar, `Escape` closes detail drawer or modal, `t` (when not typing in an input) toggles dark/light theme.
- **Offline / `file://` Guard**: If `fetch('./data/datasets.json')` fails due to browser `file://` CORS restrictions, renders a clean, actionable inline banner instructing `python -m http.server 8000` (zero silent blank screens).

---

## 6. Aesthetic Direction — Editorial Scientific Atlas

OpenNeuroAtlas adopts a **crisp editorial scientific atlas** aesthetic — inspired by *Nature Methods* and *PapersWithCode* meets a modern medical AI observatory, deliberately distinct from a clinical DICOM workstation.

### 6.1 Theme Tokens (`css/styles.css` Custom Properties)

| Semantic Token | Dark Theme (Default — Refined Slate) | Light Theme (Editorial Paper) | Usage |
|---|---|---|---|
| `--bg-canvas` | `#0B1120` | `#F8FAFC` | Page canvas |
| `--bg-surface` | `#111827` | `#FFFFFF` | Cards, panels, drawers, tables |
| `--bg-elevated` | `#162033` | `#F1F5F9` | Hover surfaces, filter wells, code headers |
| `--bg-code` | `#070C17` | `#0F172A` | Fetch/install snippets & JSON preview |
| `--border-subtle` | `rgba(148, 163, 184, 0.16)` | `#E2E8F0` | Hairline card/table dividers |
| `--border-strong` | `rgba(148, 163, 184, 0.30)` | `#CBD5E1` | Interactive control borders |
| `--text-primary` | `#F1F5F9` | `#0F172A` | Headlines, record titles |
| `--text-secondary` | `#CBD5E1` | `#334155` | Body copy, highlights |
| `--text-muted` | `#94A3B8` | `#64748B` | Captions, axis labels, metadata keys |
| `--accent-emerald` | `#10B981` | `#059669` | Open Access, Datasets, heatmap peak, valid status |
| `--accent-cyan` | `#22D3EE` | `#0891B2` | Models / Toolkits, active filters, interactive links |
| `--accent-amber` | `#F59E0B` | `#D97706` | Controlled DUA, Challenges, open-science gaps, limitations |
| `--accent-rose` | `#FB7185` | `#E11D48` | Validation errors, critical gap badges |

### 6.2 Zero-CDN Typography Stack
- **Editorial Display / Masthead (`--font-serif`)**: `'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, ui-serif, serif` — gives the masthead, analytics section titles, and record drawer headlines unmistakable scientific-journal gravitas.
- **UI & Body (`--font-sans`)**: `'Inter', 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif` — clean legibility at `14px–15px` for dense metadata tables and filter panels.
- **Data, Codes & Citations (`--font-mono`)**: `'Cascadia Code', 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace` with `font-variant-numeric: tabular-nums` — crisp alignment for cohort counts, years, DOIs, heatmap counts, BibTeX, and CLI snippets.

### 6.3 Layout & Interaction Grammar
- **Masthead + KPI Observatory Strip**: Slim top bar with brand emblem, view switcher (`Registry Explorer`, `Coverage & Gaps`, `Submit via PR`), live KPI counters (Datasets, Models, Challenges, Total Open Patients, Open-Access %), and Light/Dark theme toggle.
- **Explorer Workspace**: Collapsible left filter rail (`272px` on desktop, slide-over drawer on mobile `< 960px`) + sticky search/sort/export toolbar + Active Filter chip bar + responsive Card Grid or dense Comparison Table view.
- **Accessibility & Motion**: High-contrast WCAG AA text ratios in both themes, visible `2px solid var(--accent-cyan)` `:focus-visible` outlines, semantic landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`), `aria-live="polite"` result count announcements, and `@media (prefers-reduced-motion: reduce)` support.

---

## 7. Schema Validation & CI Gating

### 7.1 `tests/validate_registry.py` (Python 3.12 Stdlib Only)

Runs via:
```bash
python tests/validate_registry.py --strict
```

#### Validation Pipeline
1. **Schema Self-Check**: Loads `schemas/registry-schema.json`, verifies required top-level keys (`schemaVersion`, `fileEnvelope`, `vocabularies`, `definitions`, `recordTypes`, `integrityRules`), and pre-compiles every regex pattern.
2. **File Envelope Check**: Loads `data/datasets.json`, `data/models.json`, and `data/challenges.json`; checks JSON syntax, envelope keys, `schemaVersion` match, `recordType` filename match, and ISO date `lastUpdated`.
3. **Per-Record Schema Check**:
   - Rejects unknown fields (`additionalProperties: false`).
   - Enforces all `required` fields, exact JSON types (`isinstance(val, bool)` guarded separately from `int` in Python!), `nullable` rules, `minLength`/`maxLength`, `minimum`/`maximum`, `minItems`, `uniqueItems`, regex `pattern`s, and `vocabRef` membership against `schema.vocabularies`.
   - Recursively validates nested `citation` object against `definitions.citation`.
4. **Cross-Record Integrity Rules**:
   - Unique `id` within each collection AND globally across all three data files.
   - Unique `bibtexKey` within each collection.
   - All URL fields (`url`, `paperUrl`, `repoUrl`, `weightsUrl`) parsed via `urllib.parse.urlparse`: must use `https`, have a valid host containing `.`, and not match `integrityRules.forbiddenUrlHosts`.
   - Logical consistency: on `models`, if `weightsUrl` is non-null, `weightsAvailable` MUST be `true`.
5. **Optional Live Link Check (`--check-urls`)**: Opt-in flag (for scheduled weekly health checks, **not** blocking offline runs) performing polite HTTP HEAD/GET verification via `urllib.request`.
6. **Exit Codes & Reporting**: Prints structured per-collection summary counts and exact `[ERROR] file[index] (id=<slug>) -> <field>: <reason>` diagnostics; exits `0` on full pass, `1` on any error.

### 7.2 GitHub Actions Workflow (`.github/workflows/validate-registry.yml`)

- Triggers on `pull_request` and `push` to `main` touching `data/**`, `schemas/**`, `tests/**`.
- Checks out repo, sets up Python `3.12` (`actions/setup-python@v5`), executes `python tests/validate_registry.py --strict` with zero external package installs.
- Guarantees that malformed records, typos in controlled vocabularies, duplicate IDs, or non-HTTPS URLs can never merge into `main`.

---

## 8. End-to-End PR Contribution Lifecycle

1. Contributor opens **Submit via PR** tab inside the live GitHub Pages site (or clicks a `0`-count gap cell in the Coverage Heatmap).
2. `prBuilder.js` dynamically renders controlled-vocabulary pickers and runs live validation against `schemas/registry-schema.json`.
3. Contributor copies the validated JSON record (or opens a pre-filled GitHub Issue) and appends it to `records` in `data/datasets.json`, `data/models.json`, or `data/challenges.json` via Pull Request.
4. GitHub Actions automatically executes `python tests/validate_registry.py --strict`.
5. Upon green CI and maintainer review/merge, GitHub Pages immediately serves the updated living atlas — updating search, filters, coverage heatmap, gap analysis, and citation exporters automatically with zero build step.
