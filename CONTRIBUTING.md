# Contributing to OpenNeuroAtlas

Thank you for helping grow **OpenNeuroAtlas**—a living, community-curated, zero-build open-science registry for **neurosurgery, neuroimaging, neuro-oncology, and surgical AI**.

Every record in the Atlas lives as structured, schema-validated JSON in `data/*.json`, governed by a single machine-readable contract in [`schemas/registry-schema.json`](schemas/registry-schema.json) and gated automatically on every Pull Request by `tests/validate_registry.py`.

---

## Table of Contents

- [What We Accept](#what-we-accept)
- [Scientific Integrity Standards](#scientific-integrity-standards)
- [Two Ways to Contribute](#two-ways-to-contribute)
- [Step-by-Step Pull Request Workflow](#step-by-step-pull-request-workflow)
  - [1. Build & Validate Your Record in the In-App JSON PR Builder](#1-build--validate-your-record-in-the-in-app-json-pr-builder)
  - [2. Edit the Target `data/*.json` File](#2-edit-the-target-datajson-file)
  - [3. Run `python tests/validate_registry.py` Locally](#3-run-python-testsvalidate_registrypy-locally)
  - [4. Preview Locally & Open Your Pull Request](#4-preview-locally--open-your-pull-request)
- [Schema & Formatting Quick Reference](#schema--formatting-quick-reference)
- [Proposing New Controlled Vocabulary Terms](#proposing-new-controlled-vocabulary-terms)
- [Updating Existing Records & Reporting Broken Links](#updating-existing-records--reporting-broken-links)
- [Community Standards](#community-standards)

---

## What We Accept

| Record Type | Target File | Scope |
|---|---|---|
| **Dataset** | `data/datasets.json` | Publicly discoverable neuroimaging, neuro-oncology, vascular, spine, epilepsy, intraoperative, surgical video, pathology, or radiogenomic cohorts (`Open Access`, `Registration Required`, or `Controlled DUA`). |
| **Model / Toolkit** | `data/models.json` | Open-source foundation models, segmentation frameworks, surgical vision pipelines, and neuroimaging viewers or clinical plugins. |
| **Challenge / Benchmark** | `data/challenges.json` | MICCAI, RSNA/ASNR, and open community benchmarks with documented evaluation tasks and quantitative leaderboard metrics. |

---

## Scientific Integrity Standards

To keep OpenNeuroAtlas trustworthy for systematic reviews, clinical AI benchmarking, and method development, all submissions must meet four principles:

1. **Verified Official Links**: Every URL (`url`, `paperUrl`, `repoUrl`, `weightsUrl`) must use `https://` and resolve to the official repository, publication/DOI, or challenge portal. Localhost URLs, link shorteners, and placeholder domains are automatically rejected.
2. **Honest Documentation of Limitations (Datasets)**: Every dataset record requires a transparent `limitations` note documenting single-center/geographic bias, missing clinical phases, protocol heterogeneity, automated-mask noise, or sample-size constraints.
3. **Reproducible Access Snippets**: Datasets require a concise, copyable `fetchSnippet` (CLI/Python download starter or DUA verification steps); models require an `installSnippet`.
4. **Clean Bibliographic Attribution**: Every record includes a structured `citation` object so researchers can immediately export accurate BibTeX (`.bib`), RIS (`.ris`), and APA 7th references.

---

## Two Ways to Contribute

- **Option A — Pull Request (Fastest, Recommended)**: Use the in-app **Submit via PR** builder to create a validated JSON record, append it to `data/*.json`, run `python tests/validate_registry.py` locally, and open a PR.
- **Option B — Structured GitHub Issue (No Git Required)**: Open a [**Submit New Resource** issue](.github/ISSUE_TEMPLATE/add-resource.yml) (or click **Open Pre-filled GitHub Issue** directly inside the in-app PR Builder). Maintainers will review the metadata and turn it into a Pull Request with you credited.

---

## Step-by-Step Pull Request Workflow

### 1. Build & Validate Your Record in the In-App JSON PR Builder

You do not need to memorize field names or controlled vocabulary strings by hand. OpenNeuroAtlas ships a schema-driven **Submit via PR** builder (`js/prBuilder.js`) that enforces the exact same validation rules as our CI gate:

1. Open the live OpenNeuroAtlas GitHub Pages site (or launch it locally via `python -m http.server 8000`).
2. Navigate to the **Submit via PR** view—or click any `0`-count dashed gap cell in the **Coverage & Gaps** heatmap to launch the builder pre-populated with that exact Pathology × Modality pair.
3. Select the resource type: **Dataset**, **Model / Toolkit**, or **Challenge / Benchmark**.
4. Complete the four guided sections:
   - **Core Identity**: Use the auto-slugified `id` (or unlock to customize).
   - **Clinical & Technical Scope**: Pick terms directly from the controlled-vocabulary chip grids (`pathologies`, `modalities`, `clinicalPhases`, `tasks`, `annotations`, `molecularMarkers`, `metrics`).
   - **Access & Code**: For datasets, select the hosting `platform` and click **Insert Platform Starter Snippet** to generate a ready-to-edit template for TCIA, Synapse, Hugging Face, OSF, Figshare, GitHub, or Institutional Portals.
   - **Citation & Notes**: Fill bibliographic fields (an auto-generated `bibtexKey` is offered), highlights, and—for datasets—known limitations.
5. Watch the live status badge until it turns emerald: **`Valid — Ready for PR`**. (If any issues remain, click any diagnostic item to jump straight to that field.)
6. Click **Copy Record JSON** (or **Download `<id>.json`**), and optionally click **Copy GitHub PR / Issue Markdown** to grab a formatted summary table for your PR description.

### 2. Edit the Target `data/*.json` File

1. Fork the repository and clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/openneuroatlas.git
   cd openneuroatlas
   git checkout -b add/<record-id>
   ```
2. Open the collection file matching your submission:
   - `data/datasets.json`
   - `data/models.json`
   - `data/challenges.json`
3. Append your copied JSON object to the `"records"` array (using 2-space indentation and valid JSON with no trailing commas), and update the top-level `"lastUpdated"` date (`YYYY-MM-DD`):

   ```json
   {
     "schemaVersion": "1.0.0",
     "recordType": "datasets",
     "lastUpdated": "2026-11-19",
     "records": [
       { "...existing records..." },
       {
         "id": "your-new-dataset-slug",
         "name": "Full Official Dataset Name",
         "shortName": "SHORT-NAME",
         "year": 2026
       }
     ]
   }
   ```

   > **Important:** Do not change `"schemaVersion"` or `"recordType"`. The validator checks that `"schemaVersion"` matches `schemas/registry-schema.json` and that `"recordType"` matches the filename (`data/<recordType>.json`).

### 3. Run `python tests/validate_registry.py` Locally

Validation requires **Python 3.12+** using only the Python standard library—no virtual environment, no `pip install`, and no Node.js toolchain:

```bash
python tests/validate_registry.py
```

The validator performs the complete CI check suite:
- Parses `schemas/registry-schema.json` and all three `data/*.json` files.
- Verifies file envelopes (`schemaVersion`, `recordType`, ISO `lastUpdated`) and rejects any unknown keys (`additionalProperties: false`).
- Enforces required fields, JSON types, nullability, string lengths, numeric ranges, regex patterns, and exact membership in every controlled vocabulary.
- Checks cross-record integrity: globally unique `id` across all three collections, unique `bibtexKey` per collection, valid `https://` URLs with no forbidden/localhost hosts, bare DOI syntax (`10.xxxx/...` or `null`), and `weightsUrl` → `weightsAvailable: true` consistency on models.

If any error is reported, the validator prints the exact file, record index, `id`, field path, and reason, and exits with status code `1`. Fix the flagged fields and re-run until it exits with status code `0`.

### 4. Preview Locally & Open Your Pull Request

1. Start a lightweight local static server from the repository root (browsers block ES module and JSON `fetch()` over `file://`):
   ```bash
   python -m http.server 8000
   ```
   Open `http://localhost:8000` in your browser and verify that your new entry renders properly in search results, facet filters, the Detail Slide-Over Drawer, the Coverage Heatmap, and the BibTeX/RIS exporter.
2. Commit your changes and push your branch:
   ```bash
   git add data/
   git commit -m "Add <record-id> to <datasets|models|challenges> registry"
   git push -u origin add/<record-id>
   ```
3. Open a Pull Request targeting `main`. Paste the Markdown summary from the PR Builder (optional, helpful for reviewers) and confirm that the **`Validate Registry Schema & Integrity`** GitHub Actions check passes.
4. Once approved and merged into `main`, `.github/workflows/pages.yml` automatically validates and deploys the updated static Atlas to GitHub Pages with zero build step.

---

## Schema & Formatting Quick Reference

All authoritative rules live in [`schemas/registry-schema.json`](schemas/registry-schema.json). Common details to double-check:

| Field | Rule / Example |
|---|---|
| `id` | Globally unique lowercase kebab-case slug (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–64 chars), e.g., `upenn-gbm`, `nnunet-v2`, `brats-challenge`. |
| `citation.authors` | BibTeX `"Last, First and Last, First"` format; append `" and others"` when truncating large consortia. Enables lossless BibTeX, RIS, and APA 7th export. |
| `citation.bibtexKey` | Unique per collection (`^[A-Za-z][A-Za-z0-9_-]{2,63}$`), e.g., `bakas2022upenngbm`. |
| `citation.doi` | Bare DOI starting with `10.` (e.g., `"10.1038/s41597-022-01560-7"`) with **no** `https://doi.org/` prefix, or `null` if no DOI exists. |
| `cohortSize` *(datasets)* | Integer patient/subject count (`1`–`10000000`), or `null` if unreported / video-frame-only / phantom cohort (always pair with human-readable `cohortDisplay`). |
| `molecularMarkers` *(datasets)* | Array of controlled biomarkers (`IDH`, `MGMT`, `1p/19q`, etc.), or empty array `[]` when not applicable. |
| `weightsAvailable` / `weightsUrl` *(models)* | If `weightsUrl` is a non-null `https://` URL, `weightsAvailable` **must** be `true`. |
| `yearsActive` *(challenges)* | Matches `^\d{4}(?:[–-](?:\d{4}|Present)|(?:,\s*\d{4})+)?$`, e.g., `"2012–Present"`, `"2021–2024"`, `"2023"`. |
| Controlled Vocabularies | Strings must match `schemas/registry-schema.json#vocabularies` verbatim (case- and punctuation-sensitive). |

---

## Proposing New Controlled Vocabulary Terms

Because `schemas/registry-schema.json` powers the validator, search facet taxonomy, Coverage Heatmap axes, automated gap detector, and in-app PR Builder simultaneously, new controlled vocabulary terms (e.g., a new modality, pathology, task, or metric) should be proposed deliberately:

1. Open an issue describing the clinical/technical need and listing ≥ 2 existing or planned resources that require the new term.
2. When approved, update `schemas/registry-schema.json` in the same PR as the new records and verify with `python tests/validate_registry.py` and a visual check of the Heatmap layout in `http://localhost:8000`.

---

## Updating Existing Records & Reporting Broken Links

- **Corrections & New Releases**: Submit a small PR editing the affected record in `data/*.json` (for example, updating a cohort size after a new data release, adding a peer-reviewed DOI replacing a preprint, or updating a challenge's `status` and `yearsActive`).
- **Broken URLs or Governance Changes**: Open an issue or PR noting the record `id` and updated canonical `https://` URL or access tier.

---

## Community Standards

OpenNeuroAtlas is an open-science community resource. Please interact respectfully and constructively in issues and Pull Requests, give accurate credit to dataset creators and model authors, and never submit or upload protected health information (PHI) or proprietary data files to this repository.
