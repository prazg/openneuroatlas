# OpenNeuroAtlas

**A living, PR-extensible open-science registry and gap-analysis observatory for neurosurgery, neuroimaging, neuro-oncology, and surgical AI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-10B981.svg)](LICENSE)
[![Schema Version](https://img.shields.io/badge/Schema-v1.0.0-22D3EE.svg)](schemas/registry-schema.json)
[![Zero Build](https://img.shields.io/badge/Architecture-Zero--Build%20Static%20Web-0891B2.svg)](ARCHITECTURE.md)
[![Validation](https://img.shields.io/badge/CI-Python%203.12%20Stdlib-F59E0B.svg)](.github/workflows/pages.yml)

---

## Overview

Research in neurosurgical AI, neuro-oncology imaging, cerebrovascular modeling, and surgical video understanding is spread across heterogeneous repositories (TCIA, Synapse, Grand Challenge, Hugging Face, OSF, Figshare, and institutional portals) with inconsistent licensing, opaque access barriers, and uneven perioperative coverage.

**OpenNeuroAtlas** consolidates three interconnected pillars into a single, machine-validated, browser-native scientific atlas:

1. **Datasets (`data/datasets.json`)** — Curated cohorts annotated with controlled pathologies, imaging/surgical/omics modalities, perioperative clinical phases (`Pre-Op`, `Intra-Op`, `Early Post-Op`, `Longitudinal`, `Pathology/Ex-Vivo`), ground-truth annotations, molecular biomarkers (`IDH`, `MGMT`, `1p/19q`, `H3K27M`, etc.), access governance tiers, reproducible download snippets, and honest documentation of cohort limitations.
2. **Foundation Models & Clinical Toolkits (`data/models.json`)** — Open-source foundation models, segmentation frameworks, surgical vision systems, and neuroimaging viewers/clinical plugins indexed by architecture, runtime framework, open-source license, checkpoint availability, and quick-start install snippets.
3. **MICCAI & Open Benchmarks (`data/challenges.json`)** — Recurring and completed community challenges indexed by organizer, active span, benchmark tasks, hosting platform, and official quantitative leaderboard metrics (`Dice`, `HD95`, `NSD`, `clDice`, `TRE`, etc.).

Every feature runs **100% client-side** in pure HTML5, CSS3, and vanilla ES Modules with **zero build tools, zero npm dependencies, and zero mandatory external CDNs**—making the Atlas trivially deployable on GitHub Pages and fully reproducible offline.

---

## Key Capabilities

### 1. Live Multi-Facet Registry Explorer
- **Weighted Full-Text Search** (`/` shortcut) indexing identifiers, names, clinical vocabularies, molecular markers, architectures, licenses, highlights, limitations, and bibliographic metadata.
- **Disjunctive Multi-Facet Filtering** across 14 pathologies, 13 modalities, 5 clinical phases, 18 AI tasks, 14 annotation types, 15 molecular markers, 3 access tiers (`Open Access`, `Registration Required`, `Controlled DUA`), hosting platforms, model categories, pretrained-weights toggle, and challenge metrics—with live dynamic counts per facet.
- **Dual Layout & Deep-Linking**: Switch cleanly between responsive **Card Grid** and dense **Table** views, open any entry in the **Detail Slide-Over Drawer** (featuring amber **Limitations & Biases** callouts), toggle Dark Editorial Slate / Light Paper themes (`t` shortcut), and share any filtered state or record via deterministic URL hashes (`#view=explorer&tab=datasets&...`).

### 2. Interactive Modality × Pathology Coverage Heatmap & Gap Observatory
- **Pure SVG 14 × 13 Coverage Heatmap** (`js/analyticsCharts.js`): Maps all 14 controlled pathologies against 13 clinical and surgical modalities with switchable metrics (**All Records** | **Datasets Only** | **Open Access Only**).
  - Clicking a **populated cell** or axis header cross-filters the Explorer directly to that slice.
  - Clicking a **`0`-count dashed gap cell** launches the **Submit via PR** builder pre-populated with that exact Pathology × Modality pair to encourage community data contributions.
- **Access-Tier & Cohort Size Charts**: Visualizes open-access share, cumulative patient counts across governance tiers, cohort size buckets (`< 50`, `50–199`, `200–999`, `1,000+`, `Unspecified / Video`), and the largest open cohorts.
- **Open-Access Release Timeline**: Stacked annual release counts overlaid with a cumulative registry growth curve.
- **Automated Open-Science Gap Detection**: Programmatically surfaces clickable gap cards for *Intraoperative & Surgical Modality Blind Spots*, *Access-Barrier Bottlenecks*, *Single-Cohort Reproducibility Risks*, *Perioperative Phase Gaps*, and *Biomarker / Benchmark Gaps*.

### 3. Side-by-Side Resource Comparator
- Select any datasets, models, or challenges into the docked **Comparison Tray** to open a structured side-by-side comparison modal inspecting modalities, clinical phases, cohort scales, ground-truth labels, molecular markers, access tiers, licenses, pretrained weights, and documented biases—designed for study design, external validation planning, and systematic review tables.

### 4. Academic Citation & Table Exporter (BibTeX, RIS, APA 7th, Markdown, CSV)
- Every record exposes structured bibliographic metadata (`citation`) powering both single-record (Detail Drawer) and bulk-selection (Comparison Tray / Toolbar) export via `js/exporters.js`:
  - **BibTeX (`.bib`)**: Automatic `@article` / `@inproceedings` / `@misc` type inference, LaTeX special-character escaping, acronym case preservation (`{GBM}`, `{MRI}`, `{BraTS}`, `{IDH}`), and automatic bulk key deduplication.
  - **RIS (`.ris`)**: Standards-compliant export ready for Zotero, EndNote, and Mendeley.
  - **APA 7th**: Clean formatted reference strings with DOI/URL fallback.
  - **GFM Markdown Tables (`.md`)**: View-tailored tables ready to paste into manuscripts, systematic reviews, or GitHub READMEs.
  - **RFC 4180 CSV (`.csv`)**: UTF-8 BOM-encoded tabular export for Excel, Python/pandas, and R.

### 5. Reproducible Starter Fetch & Install Snippets
- Every dataset includes a copy-paste CLI or Python `fetchSnippet`, complemented by built-in platform starter templates for all 7 dataset hosts:
  - **TCIA** (`tcia_utils` / NBIA Data Retriever), **Synapse** (`synapseclient`), **Hugging Face** (`huggingface-cli`), **OSF** (`osfclient`), **Figshare** (API v2), **GitHub** (`git clone` / Releases), and **Institutional Portals** (DUA checklist & BIDS/NIfTI verification stub).
- Every model/toolkit includes a copy-paste `installSnippet` (`pip`, Docker, 3D Slicer, or web runtime commands).

### 6. Schema-Driven In-App PR Builder
- The **Submit via PR** view (`js/prBuilder.js`) reads [`schemas/registry-schema.json`](schemas/registry-schema.json) directly to render controlled-vocabulary pickers, validate records live with full parity against `tests/validate_registry.py`, auto-generate slugs and `bibtexKey`s, insert platform starter snippets, and export copyable JSON, downloadable `<id>.json` files, or pre-filled GitHub Issue/PR Markdown.

---

## Architecture & Repository Layout

OpenNeuroAtlas uses [`schemas/registry-schema.json`](schemas/registry-schema.json) as a single machine-readable source of truth consumed simultaneously by the browser application and Python CI validator. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the complete technical specification.

```text
openneuroatlas/
├── index.html                               # Zero-build semantic Atlas SPA shell
├── css/
│   └── styles.css                           # Editorial Scientific Atlas design system (Dark/Light tokens)
├── js/
│   ├── app.js                               # Central state store, URL-hash deep-linking, tray & drawer orchestration
│   ├── registryEngine.js                    # Pure data loader, search index, faceting, analytics & gap detector
│   ├── exporters.js                         # BibTeX, RIS, APA 7th, GFM Markdown, CSV & platform fetch templates
│   ├── analyticsCharts.js                   # Pure responsive SVG Heatmap, Access/Cohort bars & Release Timeline
│   └── prBuilder.js                         # Schema-driven "Submit via PR" builder & live validator
├── data/
│   ├── datasets.json                        # Curated neurosurgery / neuroimaging / neuro-oncology datasets
│   ├── models.json                          # Open-source foundation models, frameworks & clinical plugins
│   └── challenges.json                      # MICCAI & open benchmarks / recurring leaderboards
├── schemas/
│   └── registry-schema.json                 # Single-source-of-truth vocabularies, field rules & integrity rules
├── tests/
│   └── validate_registry.py                 # Python 3.12 stdlib-only schema & cross-record integrity validator
├── .github/
│   ├── workflows/
│   │   └── pages.yml                        # Required CI validation on PR/main + static GitHub Pages deployment
│   └── ISSUE_TEMPLATE/
│       └── add-resource.yml                 # Structured GitHub Issue Form for researcher submissions
├── ARCHITECTURE.md                          # Complete architecture & module specification
├── CONTRIBUTING.md                          # PR workflow, PR Builder guide & local validation steps
├── CITATION.cff                             # CFF 1.2.0 citation metadata ("Cite this repository")
└── LICENSE                                  # MIT License (2026)
```

---

## Local Preview & Validation

No Node.js, bundler, or Python third-party packages are required—only **Python 3.12+**:

```bash
# 1. Clone the repository
git clone https://github.com/openneuroatlas/openneuroatlas.git
cd openneuroatlas

# 2. Validate all registry files against schemas/registry-schema.json (stdlib only)
python tests/validate_registry.py

# 3. Serve statically on http://localhost:8000
python -m http.server 8000
```

> **Note:** Open the Atlas via `http://localhost:8000` rather than double-clicking `index.html` (`file://`), as modern browsers block ES module and JSON `fetch()` requests over the `file://` protocol.

---

## Contributing

Community contributions of new datasets, foundation models, clinical toolkits, and benchmarks are warmly welcomed:

- **Fastest path (PR)**: Use the in-app **Submit via PR** builder, append the validated JSON to `data/*.json`, run `python tests/validate_registry.py`, and open a Pull Request.
- **No-Git path (Issue Form)**: Submit metadata via the [**Submit New Resource** Issue Form](.github/ISSUE_TEMPLATE/add-resource.yml).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the complete walkthrough and schema quick reference.

---

## Citing OpenNeuroAtlas

If OpenNeuroAtlas supports your systematic review, benchmark design, or clinical AI study, please cite both the individual underlying datasets/models (using the built-in BibTeX/RIS exporter) and OpenNeuroAtlas itself via [`CITATION.cff`](CITATION.cff) (or GitHub's **Cite this repository** button):

```bibtex
@software{openneuroatlas2026,
  author  = {{Prajwal Ghimire}},
  title   = {{OpenNeuroAtlas}: A Living Open-Science Registry for Neurosurgery, Neuroimaging, Neuro-Oncology, and Surgical {AI}},
  year    = {2026},
  version = {1.0.0},
  license = {MIT},
  url     = {https://github.com/openneuroatlas/openneuroatlas}
}
```

---

## License & Data Governance

- **Software & Curated Registry Metadata**: Released under the [MIT License](LICENSE) (2026).
- **External Resources**: OpenNeuroAtlas indexes public metadata, structured citations, and verified links only—it does **not** host clinical imaging files or protected health information (PHI). Each linked dataset, pretrained checkpoint, and challenge remains governed by its respective original license and Data Use Agreement (DUA).

---

<!-- PRAZG_SUITE_README_START -->
## Open Neuro & Pathology AI Suite

Part of the open-access neurosurgery, neuroimaging, neuro-oncology, and computational pathology web suite by [@prazg](https://github.com/prazg):

| Tool | Live App | Repository | Focus |
|---|---|---|---|
| **NeuroScope-RANO** | [Open App](https://prazg.github.io/neuroscope-rano/) | [`prazg/neuroscope-rano`](https://github.com/prazg/neuroscope-rano) | Zero-upload NIfTI MRI volumetrics, RANO 2.0, RANO-Resect (EOR) & AI segmentation QA |
| **OpenNeuroAtlas** *(this repo)* | [Open App](https://prazg.github.io/openneuroatlas/) | [`prazg/openneuroatlas`](https://github.com/prazg/openneuroatlas) | Living registry of 44 open neurosurgery & neuroimaging datasets, foundation models & MICCAI benchmarks |
| **CNS5-Audit** | [Open App](https://prazg.github.io/cns5-audit/) | [`prazg/cns5-audit`](https://github.com/prazg/cns5-audit) | WHO CNS5 (2021) classifier, RANO 2.0 / RANO-BM / RANO-Resect calculators & CLAIM/TRIPOD+AI leakage auditor |
| **NeuroCorridor-3D** | [Open App](https://prazg.github.io/neurocorridor-3d/) | [`prazg/neurocorridor-3d`](https://github.com/prazg/neurocorridor-3d) | Interactive 3D MNI-152 eloquent neuroanatomy, white-matter tractography & surgical corridor sandbox |
| **3D Neurosurgical Atlas** | [Open App](https://prazg.github.io/3D_Neurosurgical_Atlas/) | [`prazg/3D_Neurosurgical_Atlas`](https://github.com/prazg/3D_Neurosurgical_Atlas) | Interactive browser-based 3D atlas of craniospinal anatomy, 76 walkthroughs & neuro-oncological pathology |
| **Brain Trials Finder** | [Open App](https://prazg.github.io/brain_trials_finder/) | [`prazg/brain_trials_finder`](https://github.com/prazg/brain_trials_finder) | Discovers actively recruiting neuro-oncology clinical trials across ClinicalTrials.gov, ISRCTN, EU CTIS & WHO ICTRP |
| **Brain Radiology FM** | [Open App](https://prazg.github.io/Brain_Radiology_FM_Portal/) | [`prazg/Brain_Radiology_FM_Portal`](https://github.com/prazg/Brain_Radiology_FM_Portal) | Interactive PACS portal & GPU runner for 28 open-weight 3D Brain MRI, Head CT & fMRI foundation models |
| **Histology FM** | [Open App](https://prazg.github.io/Histology_FM_Portal/) | [`prazg/Histology_FM_Portal`](https://github.com/prazg/Histology_FM_Portal) | Graphical frontend & GPU runner for 55 open-weight clinical & preclinical histology foundation models |
| **Animal Pathology FM** | [Open App](https://prazg.github.io/Animal_Pathology_FM_Portal/) | [`prazg/Animal_Pathology_FM_Portal`](https://github.com/prazg/Animal_Pathology_FM_Portal) | Frontend & local runner for open-weight preclinical, rodent & veterinary pathology foundation models |
| **Remote DICOM Viewer** | [Open App](https://prazg.github.io/Remote_Dicom_Viewer/) | [`prazg/Remote_Dicom_Viewer`](https://github.com/prazg/Remote_Dicom_Viewer) | Secure browser-based DICOM viewer for sending scans for remote radiological reporting |

<!-- PRAZG_SUITE_README_END -->
