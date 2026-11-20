/**
 * OpenNeuroAtlas — Application Shell, State Store & Interactive Controller
 *
 * Orchestrates:
 *  - Parallel registry loading + offline/file:// protocol guard
 *  - Dark / Light editorial theme toggle (persisted in localStorage, shortcut: `t`)
 *  - URL-hash deep-linking for views, tabs, filters, and detail records
 *  - Live KPI strip, multi-facet disjunctive sidebar, instant search (`/`), Card/Table views
 *  - Pure SVG Coverage & Gap Observatory with click-to-filter & click-to-PR flows
 *  - Persistent Bottom Selection & Comparator Dock + Side-by-Side Comparison Modal (up to 4 items)
 *  - Detail Modal with metadata, limitations, copyable code snippets, and BibTeX/RIS/APA tabs
 *  - Schema-driven PR Builder mount
 */

import {
  loadRegistry,
  createInitialFilterState,
  filterAndSortRecords,
  computeFacetCounts,
  computeAnalytics,
  extractRecordYear,
} from './registryEngine.js';

import {
  toBibtex,
  toBulkBibtex,
  toRis,
  toBulkRis,
  toApa,
  toMarkdownTable,
  toCsv,
  copyToClipboard,
  downloadTextFile,
} from './exporters.js';

import {
  renderCoverageHeatmap,
  renderCohortSizeChart,
  renderAccessTierChart,
  renderReleaseTimeline,
  renderGapCallouts,
  hideChartTooltip,
} from './analyticsCharts.js';

import { mountPrBuilder } from './prBuilder.js';

const THEME_STORAGE_KEY = 'openneuroatlas-theme';
const MAX_COMPARE_ITEMS = 4;

/**
 * Central application state
 */
const state = {
  registry: null,
  analytics: null,
  activeView: 'explorer', // 'explorer' | 'analytics' | 'contribute'
  displayMode: 'cards', // 'cards' | 'table'
  filters: {
    ...createInitialFilterState(),
    tab: 'datasets',
  },
  userSelectedSort: false,
  filtersCollapsedDesktop: false,
  filtersOpenMobile: false,
  openFacetGroups: new Set([
    'accessTiers',
    'modalities',
    'pathologies',
    'clinicalPhases',
    'modelCategories',
    'challengeStatuses',
  ]),
  heatmapMetric: 'datasets', // 'datasets' | 'all' | 'openAccess'
  cohortScale: 'log', // 'log' | 'linear'
  selectedIds: new Set(),
  detailRecordId: null,
  detailCiteTab: 'bibtex', // 'bibtex' | 'ris' | 'apa'
  compareModalOpen: false,
  prBuilderCtrl: null,
  currentFilteredRecords: [],
};

/**
 * Cached DOM references
 */
const dom = {};

function cacheDom() {
  const ids = [
    'btn-theme-toggle',
    'theme-icon-sun',
    'theme-icon-moon',
    'theme-toggle-label',
    'header-schema-badge',
    'header-updated-badge',
    'kpi-datasets',
    'kpi-datasets-sub',
    'kpi-models',
    'kpi-models-sub',
    'kpi-challenges',
    'kpi-challenges-sub',
    'kpi-open-access',
    'kpi-open-access-sub',
    'kpi-longitudinal',
    'kpi-longitudinal-sub',
    'kpi-molecular',
    'kpi-molecular-sub',
    'offline-guard-banner',
    'offline-guard-message',
    'btn-copy-server-cmd',
    'view-explorer',
    'view-analytics',
    'view-contribute',
    'tab-count-datasets',
    'tab-count-models',
    'tab-count-challenges',
    'tab-count-all',
    'catalog-search',
    'btn-clear-search',
    'btn-toggle-filters',
    'filter-active-badge',
    'catalog-sort',
    'btn-layout-cards',
    'btn-layout-table',
    'btn-export-filtered-bib',
    'btn-export-filtered-csv',
    'explorer-layout',
    'mobile-filter-scrim',
    'filter-sidebar',
    'btn-close-filters-mobile',
    'btn-reset-sidebar-filters',
    'filter-facets-container',
    'active-filters-bar',
    'results-summary',
    'catalog-loading',
    'catalog-results',
    'heatmap-metric-controls',
    'chart-heatmap',
    'analytics-heatmap-subtitle',
    'cohort-scale-controls',
    'chart-cohort-bars',
    'chart-access-tier',
    'chart-timeline',
    'gap-count-badge',
    'gap-callouts-grid',
    'pr-builder-root',
    'comparator-dock',
    'dock-count-badge',
    'dock-items-list',
    'btn-dock-compare',
    'btn-dock-bib',
    'btn-dock-ris',
    'btn-dock-csv',
    'btn-dock-clear',
    'detail-modal',
    'detail-modal-badges',
    'detail-modal-title',
    'detail-modal-subtitle',
    'detail-modal-pin-btn',
    'detail-modal-close',
    'detail-modal-body',
    'compare-modal',
    'compare-modal-subtitle',
    'btn-compare-copy-md',
    'btn-compare-dl-md',
    'btn-compare-dl-csv',
    'btn-compare-dl-bib',
    'compare-modal-close',
    'compare-modal-body',
    'footer-schema-version',
    'footer-last-updated',
    'footer-record-counts',
    'toast-container',
  ];

  for (const id of ids) {
    dom[id] = document.getElementById(id);
  }
}

/* ==========================================================================
   Utilities
   ========================================================================== */

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate that a URL uses an allowed web scheme (`https:` or `http:`) before
 * placing it inside an HTML `href` attribute. Rejects `javascript:`, `data:`,
 * `vbscript:`, relative paths, and malformed URLs.
 * @param {any} url
 * @returns {string|null}
 */
function safeHref(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

function getRecordType(record) {
  if (!record) return 'datasets';
  if (record._recordType) return record._recordType;
  if ('repoUrl' in record || 'installSnippet' in record) return 'models';
  if ('yearsActive' in record || 'organizer' in record) return 'challenges';
  return 'datasets';
}

function getPrimaryUrl(record) {
  return record?.url || record?.repoUrl || record?.paperUrl || '';
}

function getAccessPillClass(accessTier) {
  if (accessTier === 'Open Access') return 'pill-open';
  if (accessTier === 'Registration Required') return 'pill-reg';
  return 'pill-dua';
}

function getModelCategoryPillClass(category) {
  if (category === 'Foundation Model') return 'pill-reg';
  if (category === 'Segmentation Framework') return 'pill-open';
  if (category === 'Surgical Vision') return 'pill-dua';
  return 'pill-neutral';
}

function showToast(message, kind = 'success') {
  const container = dom['toast-container'];
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' toast-error' : ''}`;
  el.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span>${esc(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.style.transition = 'opacity 180ms ease, transform 180ms ease';
    setTimeout(() => el.remove(), 200);
  }, 3000);
}

/* ==========================================================================
   Theme Controller (Dark Obsidian-Navy default + Crisp Light Paper mode)
   ========================================================================== */

function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(theme, persist = true) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (_) {
      // ignore storage restrictions
    }
  }
  const isDark = next === 'dark';
  if (dom['theme-icon-sun']) dom['theme-icon-sun'].hidden = !isDark;
  if (dom['theme-icon-moon']) dom['theme-icon-moon'].hidden = isDark;
  if (dom['theme-toggle-label']) dom['theme-toggle-label'].textContent = isDark ? 'Light' : 'Dark';
}

function toggleTheme() {
  const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
  showToast(`Switched to ${next === 'dark' ? 'Dark Obsidian' : 'Light Paper'} theme.`);
}

/* ==========================================================================
   URL Hash Deep-Linking
   ========================================================================== */

function hydrateStateFromHash() {
  const rawHash = window.location.hash.replace(/^#/, '');
  if (!rawHash) return;

  const params = new URLSearchParams(rawHash);
  const view = params.get('view');
  if (view === 'explorer' || view === 'analytics' || view === 'contribute') {
    state.activeView = view;
  }

  const tab = params.get('tab');
  if (tab === 'datasets' || tab === 'models' || tab === 'challenges' || tab === 'all') {
    state.filters.tab = tab;
  }

  const q = params.get('q');
  if (q) state.filters.query = q;

  const arrayKeys = [
    ['pathology', 'pathologies'],
    ['modality', 'modalities'],
    ['phase', 'clinicalPhases'],
    ['tier', 'accessTiers'],
    ['platform', 'platforms'],
    ['task', 'tasks'],
    ['marker', 'molecularMarkers'],
    ['category', 'modelCategories'],
    ['status', 'challengeStatuses'],
    ['metric', 'metrics'],
  ];

  for (const [paramName, stateKey] of arrayKeys) {
    const vals = params.getAll(paramName).filter(Boolean);
    if (vals.length > 0) {
      state.filters[stateKey] = vals;
    }
  }

  if (params.get('molecular') === '1') state.filters.hasMolecular = true;
  if (params.get('longitudinal') === '1') state.filters.hasLongitudinal = true;
  if (params.get('weights') === '1') state.filters.hasOpenWeights = true;
  if (params.get('openAccess') === '1') state.filters.openAccessOnly = true;

  const yr = params.get('year');
  if (yr && /^\d{4}$/.test(yr)) state.filters.year = Number(yr);

  const recId = params.get('record');
  if (recId) state.detailRecordId = recId;
}

function syncHashFromState() {
  const params = new URLSearchParams();
  params.set('view', state.activeView);

  if (state.activeView === 'explorer') {
    params.set('tab', state.filters.tab);
    if (state.filters.query.trim()) params.set('q', state.filters.query.trim());
    state.filters.pathologies.forEach((v) => params.append('pathology', v));
    state.filters.modalities.forEach((v) => params.append('modality', v));
    state.filters.clinicalPhases.forEach((v) => params.append('phase', v));
    state.filters.accessTiers.forEach((v) => params.append('tier', v));
    state.filters.platforms.forEach((v) => params.append('platform', v));
    state.filters.tasks.forEach((v) => params.append('task', v));
    state.filters.molecularMarkers.forEach((v) => params.append('marker', v));
    state.filters.modelCategories.forEach((v) => params.append('category', v));
    state.filters.challengeStatuses.forEach((v) => params.append('status', v));
    state.filters.metrics.forEach((v) => params.append('metric', v));
    if (state.filters.hasMolecular) params.set('molecular', '1');
    if (state.filters.hasLongitudinal) params.set('longitudinal', '1');
    if (state.filters.hasOpenWeights) params.set('weights', '1');
    if (state.filters.openAccessOnly) params.set('openAccess', '1');
    if (state.filters.year) params.set('year', String(state.filters.year));
  }

  if (state.detailRecordId) {
    params.set('record', state.detailRecordId);
  }

  const nextHash = `#${params.toString()}`;
  if (window.location.hash !== nextHash) {
    try {
      window.history.replaceState(null, '', nextHash);
    } catch (_) {
      // ignore in restricted contexts
    }
  }
}

/* ==========================================================================
   View Switching & KPI Strip
   ========================================================================== */

function setActiveView(viewName, { scrollToTop = false } = {}) {
  if (!['explorer', 'analytics', 'contribute'].includes(viewName)) return;
  state.activeView = viewName;
  hideChartTooltip();

  document.querySelectorAll('.nav-tab[data-view]').forEach((btn) => {
    const active = btn.getAttribute('data-view') === viewName;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  if (dom['view-explorer']) dom['view-explorer'].hidden = viewName !== 'explorer';
  if (dom['view-analytics']) dom['view-analytics'].hidden = viewName !== 'analytics';
  if (dom['view-contribute']) dom['view-contribute'].hidden = viewName !== 'contribute';

  if (viewName === 'analytics' && state.analytics) {
    renderAnalyticsDashboard();
  }
  if (viewName === 'contribute' && state.registry && !state.prBuilderCtrl) {
    initPrBuilder();
  }

  syncHashFromState();

  if (scrollToTop) {
    const main = document.getElementById('main-content');
    main?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderHeaderAndKpis() {
  if (!state.registry || !state.analytics) return;
  const { meta } = state.registry;
  const { kpis } = state.analytics;

  if (dom['header-schema-badge']) {
    dom['header-schema-badge'].textContent = `Schema v${meta.schemaVersion || '1.0.0'}`;
  }
  if (dom['header-updated-badge']) {
    dom['header-updated-badge'].textContent = meta.lastUpdated
      ? `Updated ${meta.lastUpdated}`
      : 'Live Snapshot';
  }
  if (dom['footer-schema-version']) {
    dom['footer-schema-version'].textContent = `Schema v${meta.schemaVersion || '1.0.0'}`;
  }
  if (dom['footer-last-updated']) {
    dom['footer-last-updated'].textContent = meta.lastUpdated || '—';
  }
  if (dom['footer-record-counts']) {
    dom['footer-record-counts'].textContent = `${kpis.totalDatasets} Datasets · ${kpis.totalModels} Models · ${kpis.totalChallenges} Benchmarks`;
  }

  if (dom['kpi-datasets']) dom['kpi-datasets'].textContent = String(kpis.totalDatasets);
  if (dom['kpi-datasets-sub']) {
    dom['kpi-datasets-sub'].textContent = `${kpis.totalPatients.toLocaleString()} documented patients`;
  }

  if (dom['kpi-models']) dom['kpi-models'].textContent = String(kpis.totalModels);
  if (dom['kpi-models-sub']) {
    dom['kpi-models-sub'].textContent = `${kpis.openWeightsModelCount} with open weights`;
  }

  if (dom['kpi-challenges']) dom['kpi-challenges'].textContent = String(kpis.totalChallenges);
  if (dom['kpi-challenges-sub']) {
    dom['kpi-challenges-sub'].textContent = `${kpis.activeChallengesCount} active recurring`;
  }

  if (dom['kpi-open-access']) {
    dom['kpi-open-access'].textContent = `${Math.round(kpis.openAccessPct)}%`;
  }
  if (dom['kpi-open-access-sub']) {
    dom['kpi-open-access-sub'].textContent = `${kpis.openAccessCount} of ${kpis.totalDatasets} direct open`;
  }

  if (dom['kpi-longitudinal']) dom['kpi-longitudinal'].textContent = String(kpis.longitudinalCount);
  if (dom['kpi-longitudinal-sub']) {
    dom['kpi-longitudinal-sub'].textContent = `${kpis.intraOpCount} intra-op cohorts`;
  }

  if (dom['kpi-molecular']) dom['kpi-molecular'].textContent = String(kpis.molecularAnnotatedCount);
  if (dom['kpi-molecular-sub']) {
    dom['kpi-molecular-sub'].textContent = `IDH / MGMT / 1p19q linked`;
  }
}

/* ==========================================================================
   Filter Helpers
   ========================================================================== */

function clearAllFilters({ preserveTab = true } = {}) {
  const prevTab = state.filters.tab;
  state.filters = createInitialFilterState();
  state.filters.tab = preserveTab ? prevTab : 'datasets';
  state.userSelectedSort = false;
  if (dom['catalog-search']) dom['catalog-search'].value = '';
  if (dom['catalog-sort']) dom['catalog-sort'].value = 'year-desc';
  renderCatalog();
}

function toggleArrayFilter(key, value) {
  const arr = state.filters[key];
  if (!Array.isArray(arr)) return;
  const idx = arr.indexOf(value);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(value);
  renderCatalog();
}

function countActiveFilters() {
  const f = state.filters;
  let count = 0;
  if (f.query.trim()) count += 1;
  count += f.pathologies.length;
  count += f.modalities.length;
  count += f.clinicalPhases.length;
  count += f.accessTiers.length;
  count += f.platforms.length;
  count += f.tasks.length;
  count += f.molecularMarkers.length;
  count += f.modelCategories.length;
  count += f.challengeStatuses.length;
  count += f.metrics.length;
  if (f.hasMolecular) count += 1;
  if (f.hasLongitudinal) count += 1;
  if (f.hasOpenWeights) count += 1;
  if (f.openAccessOnly) count += 1;
  if (f.year) count += 1;
  return count;
}

/**
 * Jump directly to Explore Catalog with a clean filter payload (from Heatmap, Charts, KPIs, or Gap Cards).
 */
function jumpToCatalogWithFilters(payload = {}) {
  const next = createInitialFilterState();
  next.tab = payload.tab || 'datasets';
  if (payload.query) next.query = String(payload.query);
  if (Array.isArray(payload.pathologies)) next.pathologies = [...payload.pathologies];
  if (Array.isArray(payload.modalities)) next.modalities = [...payload.modalities];
  if (Array.isArray(payload.clinicalPhases)) next.clinicalPhases = [...payload.clinicalPhases];
  if (Array.isArray(payload.accessTiers)) next.accessTiers = [...payload.accessTiers];
  if (Array.isArray(payload.platforms)) next.platforms = [...payload.platforms];
  if (payload.hasMolecular) next.hasMolecular = true;
  if (payload.hasLongitudinal) next.hasLongitudinal = true;
  if (payload.hasOpenWeights) next.hasOpenWeights = true;
  if (payload.openAccessOnly) next.openAccessOnly = true;
  if (payload.year) next.year = Number(payload.year);

  state.filters = next;
  state.userSelectedSort = false;
  if (dom['catalog-search']) dom['catalog-search'].value = next.query;
  if (dom['catalog-sort']) dom['catalog-sort'].value = next.query ? 'relevance' : 'year-desc';

  setActiveView('explorer', { scrollToTop: true });
  renderCatalog();
}

/* ==========================================================================
   Explore Catalog Rendering (Sidebar, Active Chips, Cards, Table)
   ========================================================================== */

function renderCatalog() {
  if (!state.registry) return;
  const { allRecords, schema } = state.registry;

  // Resolve effective sort mode
  const effectiveSort =
    state.filters.query.trim() && !state.userSelectedSort ? 'relevance' : state.filters.sortBy;
  const queryState = { ...state.filters, sortBy: effectiveSort };

  const filtered = filterAndSortRecords(allRecords, queryState);
  state.currentFilteredRecords = filtered;

  const facetCounts = computeFacetCounts(allRecords, queryState, schema);

  // Sync search clear button & sort dropdown
  if (dom['btn-clear-search']) {
    dom['btn-clear-search'].hidden = state.filters.query.trim().length === 0;
  }
  if (dom['catalog-sort'] && dom['catalog-sort'].value !== effectiveSort) {
    dom['catalog-sort'].value = effectiveSort;
  }

  // Update sub-tab active state & counts
  document.querySelectorAll('[data-catalog-tab]').forEach((btn) => {
    const tabKey = btn.getAttribute('data-catalog-tab');
    const isActive = tabKey === state.filters.tab;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  if (dom['tab-count-datasets']) dom['tab-count-datasets'].textContent = String(facetCounts.tabs.datasets || 0);
  if (dom['tab-count-models']) dom['tab-count-models'].textContent = String(facetCounts.tabs.models || 0);
  if (dom['tab-count-challenges']) dom['tab-count-challenges'].textContent = String(facetCounts.tabs.challenges || 0);
  if (dom['tab-count-all']) dom['tab-count-all'].textContent = String(facetCounts.tabs.all || 0);

  // Active filter count badge
  const activeCount = countActiveFilters();
  if (dom['filter-active-badge']) {
    dom['filter-active-badge'].textContent = String(activeCount);
    dom['filter-active-badge'].hidden = activeCount === 0;
  }
  if (dom['btn-reset-sidebar-filters']) {
    dom['btn-reset-sidebar-filters'].hidden = activeCount === 0;
  }

  renderFacetSidebar(facetCounts, schema);
  renderActiveFilterChips();

  // Summary line
  if (dom['results-summary']) {
    const tabLabel =
      state.filters.tab === 'datasets'
        ? 'datasets'
        : state.filters.tab === 'models'
          ? 'models & toolkits'
          : state.filters.tab === 'challenges'
            ? 'MICCAI challenges'
            : 'total resources';
    const totalInTab =
      state.filters.tab === 'datasets'
        ? state.registry.datasets.length
        : state.filters.tab === 'models'
          ? state.registry.models.length
          : state.filters.tab === 'challenges'
            ? state.registry.challenges.length
            : state.registry.allRecords.length;

    dom['results-summary'].innerHTML = `Showing <strong>${filtered.length}</strong> of <strong>${totalInTab}</strong> ${tabLabel}`;
  }

  if (dom['catalog-loading']) dom['catalog-loading'].hidden = true;

  renderResultsList(filtered);
  syncHashFromState();
}

function renderFacetSidebar(facetCounts, schema) {
  const container = dom['filter-facets-container'];
  if (!container) return;

  const tab = state.filters.tab;
  const vocab = schema?.vocabularies || {};
  const toggles = facetCounts.toggles || {};

  // Build contextual Quick Toggles
  const toggleDefs = [];
  if (tab === 'datasets' || tab === 'all') {
    toggleDefs.push(
      { key: 'hasMolecular', label: 'Molecular Markers', count: toggles.hasMolecular || 0 },
      { key: 'hasLongitudinal', label: 'Longitudinal Phase', count: toggles.hasLongitudinal || 0 },
      { key: 'openAccessOnly', label: 'Open Access Only', count: toggles.openAccessOnly || 0 }
    );
  }
  if (tab === 'models' || tab === 'all') {
    toggleDefs.push({
      key: 'hasOpenWeights',
      label: 'Open Weights Available',
      count: toggles.hasOpenWeights || 0,
    });
  }

  const togglesHtml =
    toggleDefs.length > 0
      ? `
      <div class="facet-toggles" role="group" aria-label="Quick open-science toggles">
        ${toggleDefs
          .map((t) => {
            const active = Boolean(state.filters[t.key]);
            return `
              <button type="button" class="toggle-filter-btn${active ? ' is-active' : ''}" data-toggle-key="${t.key}" aria-pressed="${active}">
                <span class="toggle-indicator">
                  <span class="switch-track" aria-hidden="true"></span>
                  <span>${esc(t.label)}</span>
                </span>
                <span class="facet-count mono">${t.count}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    `
      : '';

  // Contextual Facet Groups
  const groups = [];
  if (tab === 'datasets' || tab === 'all') {
    groups.push({
      key: 'accessTiers',
      title: 'Access Tier',
      terms: vocab.accessTiers || [],
      tierDots: true,
    });
  }
  if (tab === 'models' || tab === 'all') {
    groups.push({
      key: 'modelCategories',
      title: 'Model Category',
      terms: vocab.modelCategories || [],
    });
  }
  if (tab === 'challenges' || tab === 'all') {
    groups.push({
      key: 'challengeStatuses',
      title: 'Benchmark Status',
      terms: vocab.challengeStatuses || [],
    });
  }

  groups.push(
    { key: 'modalities', title: 'Modality', terms: vocab.modalities || [] },
    { key: 'pathologies', title: 'Pathology', terms: vocab.pathologies || [] }
  );

  if (tab === 'datasets' || tab === 'all') {
    groups.push({ key: 'clinicalPhases', title: 'Clinical Phase', terms: vocab.clinicalPhases || [] });
  }
  if (tab === 'datasets' || tab === 'challenges' || tab === 'all') {
    const platTerms =
      tab === 'challenges'
        ? vocab.challengePlatforms || []
        : tab === 'datasets'
          ? vocab.datasetPlatforms || []
          : Array.from(new Set([...(vocab.datasetPlatforms || []), ...(vocab.challengePlatforms || [])]));
    groups.push({ key: 'platforms', title: 'Hosting Platform', terms: platTerms });
    groups.push({ key: 'tasks', title: 'AI / Clinical Tasks', terms: vocab.tasks || [] });
  }
  if (tab === 'datasets') {
    groups.push({
      key: 'molecularMarkers',
      title: 'Specific Biomarkers',
      terms: vocab.molecularMarkers || [],
    });
  }
  if (tab === 'challenges') {
    groups.push({ key: 'metrics', title: 'Evaluation Metrics', terms: vocab.metrics || [] });
  }

  const groupsHtml = groups
    .map((group) => {
      const selectedList = state.filters[group.key] || [];
      const selectedSet = new Set(selectedList);
      const countsObj = facetCounts[group.key] || {};
      const isOpen = state.openFacetGroups.has(group.key) || selectedSet.size > 0;

      const optionsHtml = group.terms
        .map((term) => {
          const cnt = countsObj[term] || 0;
          const isSelected = selectedSet.has(term);
          const dotHtml = group.tierDots
            ? `<span class="tier-dot ${term === 'Open Access' ? 'tier-dot-open' : term === 'Registration Required' ? 'tier-dot-reg' : 'tier-dot-dua'}" aria-hidden="true"></span>`
            : `<span class="facet-check" aria-hidden="true">${isSelected ? '&#10003;' : ''}</span>`;
          return `
            <button
              type="button"
              class="facet-option${isSelected ? ' is-selected' : ''}${cnt === 0 ? ' is-zero' : ''}"
              data-facet-key="${group.key}"
              data-facet-value="${esc(term)}"
              aria-pressed="${isSelected}"
            >
              <span class="facet-option-label">
                ${dotHtml}
                <span class="facet-option-text" title="${esc(term)}">${esc(term)}</span>
              </span>
              <span class="facet-count mono">${cnt}</span>
            </button>
          `;
        })
        .join('');

      return `
        <details class="facet-group" data-facet-group="${group.key}"${isOpen ? ' open' : ''}>
          <summary>
            <span>${esc(group.title)}</span>
            <span class="facet-summary-right">
              ${selectedSet.size > 0 ? `<span class="facet-active-count mono">${selectedSet.size}</span>` : ''}
              <span class="facet-chevron" aria-hidden="true">&#9662;</span>
            </span>
          </summary>
          <div class="facet-options">${optionsHtml}</div>
        </details>
      `;
    })
    .join('');

  container.innerHTML = `${togglesHtml}${groupsHtml}`;

  // Track open/close state of facet accordions
  container.querySelectorAll('details.facet-group').forEach((detailsEl) => {
    detailsEl.addEventListener('toggle', () => {
      const key = detailsEl.getAttribute('data-facet-group');
      if (!key) return;
      if (detailsEl.open) state.openFacetGroups.add(key);
      else state.openFacetGroups.delete(key);
    });
  });
}

function renderActiveFilterChips() {
  const bar = dom['active-filters-bar'];
  if (!bar) return;

  const chips = [];
  const f = state.filters;

  if (f.query.trim()) {
    chips.push({ cat: 'Search', label: `"${f.query.trim()}"`, action: 'clear-query', value: '' });
  }
  if (f.year) {
    chips.push({ cat: 'Year', label: String(f.year), action: 'clear-year', value: '' });
  }
  if (f.hasMolecular) {
    chips.push({ cat: 'Toggle', label: 'Molecular Markers', action: 'clear-toggle', value: 'hasMolecular' });
  }
  if (f.hasLongitudinal) {
    chips.push({ cat: 'Toggle', label: 'Longitudinal', action: 'clear-toggle', value: 'hasLongitudinal' });
  }
  if (f.hasOpenWeights) {
    chips.push({ cat: 'Toggle', label: 'Open Weights', action: 'clear-toggle', value: 'hasOpenWeights' });
  }
  if (f.openAccessOnly) {
    chips.push({ cat: 'Toggle', label: 'Open Access Only', action: 'clear-toggle', value: 'openAccessOnly' });
  }

  const facetLabels = [
    ['accessTiers', 'Access'],
    ['modalities', 'Modality'],
    ['pathologies', 'Pathology'],
    ['clinicalPhases', 'Phase'],
    ['platforms', 'Platform'],
    ['modelCategories', 'Category'],
    ['challengeStatuses', 'Status'],
    ['tasks', 'Task'],
    ['molecularMarkers', 'Biomarker'],
    ['metrics', 'Metric'],
  ];

  for (const [key, cat] of facetLabels) {
    for (const val of f[key] || []) {
      chips.push({ cat, label: val, action: 'remove-facet', key, value: val });
    }
  }

  if (chips.length === 0) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  bar.hidden = false;
  bar.innerHTML = `
    ${chips
      .map(
        (c) => `
      <span class="active-chip">
        <span class="active-chip-cat">${esc(c.cat)}:</span>
        <span>${esc(c.label)}</span>
        <button
          type="button"
          class="active-chip-remove"
          aria-label="Remove ${esc(c.cat)} filter ${esc(c.label)}"
          data-chip-action="${c.action}"
          data-chip-key="${esc(c.key || '')}"
          data-chip-value="${esc(c.value || '')}"
        >&times;</button>
      </span>
    `
      )
      .join('')}
    <button type="button" class="clear-all-chip" data-chip-action="clear-all">Clear Filters</button>
  `;
}

function renderResultsList(records) {
  const container = dom['catalog-results'];
  if (!container) return;

  if (records.length === 0) {
    const isModPathGap =
      state.filters.modalities.length === 1 && state.filters.pathologies.length === 1;
    const mod = state.filters.modalities[0];
    const path = state.filters.pathologies[0];

    if (isModPathGap) {
      container.innerHTML = `
        <div class="empty-state is-gap-state">
          <span class="pill pill-dua">0-Count White-Space Open-Data Gap</span>
          <h3>No cataloged ${esc(state.filters.tab === 'all' ? 'resources' : state.filters.tab)} for ${esc(mod)} &times; ${esc(path)}</h3>
          <p>
            This exact Modality &times; Pathology intersection currently represents a documented open-science blind spot in OpenNeuroAtlas. Know of a public dataset, benchmark, or open-source model covering this gap?
          </p>
          <div class="empty-state-actions">
            <button type="button" class="btn btn-primary" data-empty-action="propose-gap">
              Contribute Dataset for ${esc(mod)} &times; ${esc(path)} via PR
            </button>
            <button type="button" class="btn btn-secondary" data-empty-action="clear-filters">
              Clear Filters
            </button>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <h3>No matching resources found</h3>
          <p>Try broadening your search terms, removing one or more active facet filters, or switching to the All Resources tab.</p>
          <div class="empty-state-actions">
            <button type="button" class="btn btn-primary" data-empty-action="clear-filters">Clear All Filters</button>
            <button type="button" class="btn btn-secondary" data-empty-action="switch-all">Search All Collections</button>
          </div>
        </div>
      `;
    }
    return;
  }

  if (state.displayMode === 'table') {
    container.innerHTML = renderCompactTableHtml(records);
  } else {
    container.innerHTML = `<div class="cards-grid">${records.map(renderResourceCardHtml).join('')}</div>`;
  }
}

function renderResourceCardHtml(record) {
  const type = getRecordType(record);
  const isPinned = state.selectedIds.has(record.id);
  const year = extractRecordYear(record, type);
  const sourceHref = safeHref(getPrimaryUrl(record));
  const pinLabel = isPinned ? 'Pinned' : 'Pin';

  const typeBadgeHtml =
    state.filters.tab === 'all'
      ? `<span class="pill ${type === 'datasets' ? 'pill-type-dataset' : type === 'models' ? 'pill-type-model' : 'pill-type-challenge'}">${type === 'datasets' ? 'Dataset' : type === 'models' ? 'Model' : 'Challenge'}</span>`
      : '';

  if (type === 'datasets') {
    const accessClass = getAccessPillClass(record.accessTier);
    const cohortBadge =
      typeof record.cohortSize === 'number'
        ? `${record.cohortSize.toLocaleString()} pts`
        : record.cohortDisplay?.slice(0, 26) || 'Cohort';
    const molTags = Array.isArray(record.molecularMarkers) ? record.molecularMarkers : [];

    return `
      <article class="resource-card${isPinned ? ' is-pinned' : ''}" data-record-id="${esc(record.id)}">
        <div class="card-top-row">
          <div class="card-badges-left">
            ${typeBadgeHtml}
            <span class="pill ${accessClass}">${esc(record.accessTier)}</span>
            <span class="pill pill-neutral">${esc(record.platform)}</span>
          </div>
          <div class="card-badges-right">
            <span class="pill pill-cohort" title="${esc(record.cohortDisplay)}">${esc(cohortBadge)}</span>
            <span class="pill pill-neutral mono">${year ?? '—'}</span>
          </div>
        </div>

        <div class="card-title-block">
          <h3 class="card-title">
            <button type="button" class="card-title-btn" data-card-action="details" data-id="${esc(record.id)}">
              ${esc(record.shortName || record.name)}
            </button>
          </h3>
          ${
            record.shortName && record.name && record.shortName !== record.name
              ? `<p class="card-subtitle">${esc(record.name)}</p>`
              : ''
          }
        </div>

        <div class="tag-cloud" aria-label="Modalities, pathologies and phases">
          ${(record.modalities || []).map((m) => `<span class="tag tag-modality">${esc(m)}</span>`).join('')}
          ${(record.pathologies || []).map((p) => `<span class="tag tag-pathology">${esc(p)}</span>`).join('')}
          ${(record.clinicalPhases || []).map((ph) => `<span class="tag tag-phase">${esc(ph)}</span>`).join('')}
        </div>

        ${
          molTags.length > 0
            ? `<div class="tag-cloud" aria-label="Molecular biomarkers">
                ${molTags.slice(0, 6).map((mk) => `<span class="tag tag-molecular">${esc(mk)}</span>`).join('')}
                ${molTags.length > 6 ? `<span class="tag tag-molecular">+${molTags.length - 6}</span>` : ''}
              </div>`
            : ''
        }

        <p class="card-highlights">${esc(record.highlights)}</p>

        ${
          record.limitations
            ? `<div class="card-limitations-wrap">
                <button type="button" class="limitations-toggle-btn" data-card-action="toggle-limitations" aria-expanded="false">
                  <span aria-hidden="true">&#9888;</span>
                  <span>Limitations &amp; Biases</span>
                  <span class="lim-caret" aria-hidden="true">&#9662;</span>
                </button>
                <div class="limitations-box" hidden>${esc(record.limitations)}</div>
              </div>`
            : ''
        }

        <div class="card-footer">
          <div class="card-actions-left">
            <button type="button" class="btn btn-secondary btn-xs" data-card-action="details" data-id="${esc(record.id)}">
              Details &amp; Snippet
            </button>
            <button type="button" class="btn btn-ghost btn-xs" data-card-action="cite" data-id="${esc(record.id)}">
              Cite
            </button>
            <button
              type="button"
              class="btn ${isPinned ? 'btn-pinned' : 'btn-ghost'} btn-xs"
              data-card-action="pin"
              data-id="${esc(record.id)}"
              aria-pressed="${isPinned}"
            >
              ${isPinned ? '&#10003; ' : '+ '}${pinLabel}
            </button>
          </div>
          <div class="card-actions-right">
            ${
              sourceHref
                ? `<a href="${esc(sourceHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs" title="Open official source page">
              Source &#8599;
            </a>`
                : ''
            }
          </div>
        </div>
      </article>
    `;
  }

  if (type === 'models') {
    const repoHref = safeHref(record.repoUrl);
    return `
      <article class="resource-card${isPinned ? ' is-pinned' : ''}" data-record-id="${esc(record.id)}">
        <div class="card-top-row">
          <div class="card-badges-left">
            ${typeBadgeHtml}
            <span class="pill ${getModelCategoryPillClass(record.category)}">${esc(record.category)}</span>
            <span class="pill ${record.weightsAvailable ? 'pill-open' : 'pill-neutral'}">
              ${record.weightsAvailable ? 'Open Weights' : 'Code Only'}
            </span>
          </div>
          <div class="card-badges-right">
            <span class="pill pill-neutral mono">${year ?? '—'}</span>
          </div>
        </div>

        <div class="card-title-block">
          <h3 class="card-title">
            <button type="button" class="card-title-btn" data-card-action="details" data-id="${esc(record.id)}">
              ${esc(record.name)}
            </button>
          </h3>
          <p class="card-subtitle">${esc(record.architecture)}</p>
        </div>

        <div class="card-meta-line">
          <span class="card-meta-item">Framework: <strong>${esc(record.framework)}</strong></span>
          <span class="card-meta-item">License: <strong class="mono">${esc(record.openSourceLicense)}</strong></span>
        </div>

        <div class="tag-cloud">
          ${(record.modalities || []).map((m) => `<span class="tag tag-modality">${esc(m)}</span>`).join('')}
          ${(record.pathologies || []).map((p) => `<span class="tag tag-pathology">${esc(p)}</span>`).join('')}
        </div>

        <p class="card-highlights">${esc(record.highlights)}</p>

        <div class="card-footer">
          <div class="card-actions-left">
            <button type="button" class="btn btn-secondary btn-xs" data-card-action="details" data-id="${esc(record.id)}">
              Details &amp; Install
            </button>
            <button type="button" class="btn btn-ghost btn-xs" data-card-action="cite" data-id="${esc(record.id)}">
              Cite
            </button>
            <button
              type="button"
              class="btn ${isPinned ? 'btn-pinned' : 'btn-ghost'} btn-xs"
              data-card-action="pin"
              data-id="${esc(record.id)}"
              aria-pressed="${isPinned}"
            >
              ${isPinned ? '&#10003; ' : '+ '}${pinLabel}
            </button>
          </div>
          <div class="card-actions-right">
            ${
              repoHref
                ? `<a href="${esc(repoHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">
              GitHub &#8599;
            </a>`
                : ''
            }
          </div>
        </div>
      </article>
    `;
  }

  // Challenge card
  const isActiveChal = record.status === 'Active / Recurring';
  const challengeHref = safeHref(record.url);
  return `
    <article class="resource-card${isPinned ? ' is-pinned' : ''}" data-record-id="${esc(record.id)}">
      <div class="card-top-row">
        <div class="card-badges-left">
          ${typeBadgeHtml}
          <span class="pill ${isActiveChal ? 'pill-open' : 'pill-neutral'}">${esc(record.status)}</span>
          <span class="pill pill-neutral">${esc(record.platform)}</span>
        </div>
        <div class="card-badges-right">
          <span class="pill pill-cohort">${esc(record.yearsActive)}</span>
        </div>
      </div>

      <div class="card-title-block">
        <h3 class="card-title">
          <button type="button" class="card-title-btn" data-card-action="details" data-id="${esc(record.id)}">
            ${esc(record.name)}
          </button>
        </h3>
        <p class="card-subtitle">${esc(record.organizer)}</p>
      </div>

      <div class="tag-cloud">
        ${(record.modalities || []).map((m) => `<span class="tag tag-modality">${esc(m)}</span>`).join('')}
        ${(record.pathologies || []).map((p) => `<span class="tag tag-pathology">${esc(p)}</span>`).join('')}
      </div>

      <div class="tag-cloud" aria-label="Leaderboard metrics">
        ${(record.metrics || []).map((met) => `<span class="tag tag-metric">${esc(met)}</span>`).join('')}
      </div>

      <p class="card-highlights">${esc(record.highlights)}</p>

      <div class="card-footer">
        <div class="card-actions-left">
          <button type="button" class="btn btn-secondary btn-xs" data-card-action="details" data-id="${esc(record.id)}">
            Details &amp; Metrics
          </button>
          <button type="button" class="btn btn-ghost btn-xs" data-card-action="cite" data-id="${esc(record.id)}">
            Cite
          </button>
          <button
            type="button"
            class="btn ${isPinned ? 'btn-pinned' : 'btn-ghost'} btn-xs"
            data-card-action="pin"
            data-id="${esc(record.id)}"
            aria-pressed="${isPinned}"
          >
            ${isPinned ? '&#10003; ' : '+ '}${pinLabel}
          </button>
        </div>
        <div class="card-actions-right">
          ${
            challengeHref
              ? `<a href="${esc(challengeHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">
            Portal &#8599;
          </a>`
              : ''
          }
        </div>
      </div>
    </article>
  `;
}

function renderCompactTableHtml(records) {
  const rowsHtml = records
    .map((rec) => {
      const type = getRecordType(rec);
      const isPinned = state.selectedIds.has(rec.id);
      const yr = type === 'challenges' ? rec.yearsActive : extractRecordYear(rec, type) ?? '—';
      const scaleOrDetail =
        type === 'datasets'
          ? rec.cohortDisplay
          : type === 'models'
            ? rec.architecture
            : rec.organizer;
      const tierOrLicense =
        type === 'datasets'
          ? `<span class="pill ${getAccessPillClass(rec.accessTier)}">${esc(rec.accessTier)}</span>`
          : type === 'models'
            ? `<span class="pill ${rec.weightsAvailable ? 'pill-open' : 'pill-neutral'}">${rec.weightsAvailable ? 'Open Weights' : 'Code Only'}</span>`
            : `<span class="pill ${rec.status === 'Active / Recurring' ? 'pill-open' : 'pill-neutral'}">${esc(rec.status)}</span>`;
      const primaryHref = safeHref(getPrimaryUrl(rec));

      return `
        <tr class="${isPinned ? 'is-pinned' : ''}">
          <td>
            <button
              type="button"
              class="btn ${isPinned ? 'btn-pinned' : 'btn-ghost'} btn-xs"
              data-card-action="pin"
              data-id="${esc(rec.id)}"
              aria-pressed="${isPinned}"
              title="Pin to compare"
            >${isPinned ? '&#10003;' : '+'}</button>
          </td>
          <td class="table-name-cell">
            <button type="button" class="card-title-btn" data-card-action="details" data-id="${esc(rec.id)}">
              <strong>${esc(rec.shortName || rec.name)}</strong>
              ${rec.shortName && rec.shortName !== rec.name ? `<span>${esc(rec.name)}</span>` : ''}
            </button>
          </td>
          <td class="mono">${esc(yr)}</td>
          <td>${(rec.modalities || []).map((m) => `<span class="tag tag-modality" style="margin:0 3px 3px 0;">${esc(m)}</span>`).join('')}</td>
          <td>${(rec.pathologies || []).map((p) => `<span class="tag tag-pathology" style="margin:0 3px 3px 0;">${esc(p)}</span>`).join('')}</td>
          <td>${esc(scaleOrDetail)}</td>
          <td>${tierOrLicense}</td>
          <td style="white-space:nowrap;">
            <button type="button" class="btn btn-secondary btn-xs" data-card-action="details" data-id="${esc(rec.id)}">Details</button>
            ${
              primaryHref
                ? `<a href="${esc(primaryHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">Link &#8599;</a>`
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="table-wrap">
      <table class="catalog-table">
        <thead>
          <tr>
            <th>Pin</th>
            <th>Resource</th>
            <th>Year</th>
            <th>Modalities</th>
            <th>Pathologies</th>
            <th>Cohort / Architecture / Organizer</th>
            <th>Access / Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

/* ==========================================================================
   Coverage & Gap Observatory (SVG Analytics)
   ========================================================================== */

function renderAnalyticsDashboard() {
  if (!state.analytics || !state.registry) return;

  // Sync metric pill buttons
  dom['heatmap-metric-controls']?.querySelectorAll('[data-heatmap-metric]').forEach((btn) => {
    const active = btn.getAttribute('data-heatmap-metric') === state.heatmapMetric;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  dom['cohort-scale-controls']?.querySelectorAll('[data-cohort-scale]').forEach((btn) => {
    const active = btn.getAttribute('data-cohort-scale') === state.cohortScale;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // 1. Modality × Pathology Coverage Heatmap
  renderCoverageHeatmap(dom['chart-heatmap'], state.analytics, state.filters, {
    metric: state.heatmapMetric,
    byId: state.registry.byId,
    onCellClick: (modality, pathology) => {
      const targetTab = state.heatmapMetric === 'all' ? 'all' : 'datasets';
      const payload = {
        tab: targetTab,
        modalities: [modality],
        pathologies: [pathology],
      };
      if (state.heatmapMetric === 'openAccess') {
        payload.accessTiers = ['Open Access'];
      }
      jumpToCatalogWithFilters(payload);
    },
    onAxisClick: (axis, value) => {
      const targetTab = state.heatmapMetric === 'all' ? 'all' : 'datasets';
      const payload = { tab: targetTab };
      if (axis === 'modality') payload.modalities = [value];
      if (axis === 'pathology') payload.pathologies = [value];
      if (state.heatmapMetric === 'openAccess') payload.accessTiers = ['Open Access'];
      jumpToCatalogWithFilters(payload);
    },
  });

  // 2. Cohort Size Landscape
  renderCohortSizeChart(dom['chart-cohort-bars'], state.analytics, state.filters, {
    scale: state.cohortScale,
    onDatasetClick: (id) => {
      openDetailModal(id);
    },
  });

  // 3. Access Governance Breakdown
  renderAccessTierChart(dom['chart-access-tier'], state.analytics, state.filters, {
    onTierClick: (tier) => {
      jumpToCatalogWithFilters({
        tab: 'datasets',
        accessTiers: [tier],
      });
    },
  });

  // 4. Release Timeline
  renderReleaseTimeline(dom['chart-timeline'], state.analytics, state.filters, {
    onYearClick: (year) => {
      jumpToCatalogWithFilters({
        tab: 'all',
        year,
      });
    },
  });

  // 5. Auto-Computed Open-Data Gap Callouts
  const gaps = state.analytics.dataGaps || [];
  if (dom['gap-count-badge']) {
    dom['gap-count-badge'].textContent = `${gaps.length} priority gaps detected`;
  }
  renderGapCallouts(dom['gap-callouts-grid'], gaps, {
    onInspectGap: (gap) => {
      jumpToCatalogWithFilters(gap.filterPayload || { tab: 'datasets' });
    },
    onProposeGap: (gap) => {
      launchPrBuilderWithPrefill(gap.prefillPayload || { recordType: 'datasets' });
    },
  });
}

/* ==========================================================================
   PR Builder Integration
   ========================================================================== */

function initPrBuilder(initialPrefill = null) {
  if (!state.registry || !dom['pr-builder-root']) return;
  state.prBuilderCtrl = mountPrBuilder(dom['pr-builder-root'], {
    schema: state.registry.schema,
    registry: state.registry,
    repoConfig: { owner: 'openneuroatlas', repo: 'openneuroatlas' },
    initialPrefill,
    onNotify: (msg, kind) => showToast(msg, kind),
  });
}

function launchPrBuilderWithPrefill(prefill) {
  setActiveView('contribute', { scrollToTop: true });
  if (!state.prBuilderCtrl) {
    initPrBuilder(prefill);
  } else {
    state.prBuilderCtrl.setPrefill(prefill);
  }
  const mod = prefill?.modalities?.[0];
  const path = prefill?.pathologies?.[0];
  if (mod && path) {
    showToast(`PR Builder pre-filled for ${mod} × ${path}.`);
  } else if (path) {
    showToast(`PR Builder pre-filled for ${path}.`);
  }
}

/* ==========================================================================
   Persistent Bottom Selection & Comparator Dock
   ========================================================================== */

function togglePinRecord(id) {
  if (!id || !state.registry?.byId.has(id)) return;
  const rec = state.registry.byId.get(id);
  const label = rec.shortName || rec.name || id;
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
    showToast(`Unpinned ${label}.`);
  } else {
    state.selectedIds.add(id);
    showToast(`Pinned ${label} (${state.selectedIds.size} selected).`);
  }
  renderComparatorDock();
  renderCatalog();
  if (state.detailRecordId === id) {
    syncDetailModalPinBtn();
  }
  if (state.compareModalOpen) {
    if (state.selectedIds.size === 0) closeCompareModal();
    else renderCompareModalBody();
  }
}

function getSelectedRecords() {
  if (!state.registry) return [];
  const out = [];
  for (const id of state.selectedIds) {
    const rec = state.registry.byId.get(id);
    if (rec) out.push(rec);
  }
  return out;
}

function renderComparatorDock() {
  const dock = dom['comparator-dock'];
  if (!dock) return;
  const selected = getSelectedRecords();

  if (selected.length === 0) {
    dock.hidden = true;
    document.body.classList.remove('has-dock');
    return;
  }

  dock.hidden = false;
  document.body.classList.add('has-dock');

  if (dom['dock-count-badge']) {
    const compareNote = selected.length > MAX_COMPARE_ITEMS ? ` (top 4 compare)` : '';
    dom['dock-count-badge'].textContent = `${selected.length} pinned${compareNote}`;
  }

  if (dom['dock-items-list']) {
    dom['dock-items-list'].innerHTML = selected
      .map(
        (rec) => `
        <span class="dock-chip">
          <span>${esc(rec.shortName || rec.name)}</span>
          <button
            type="button"
            class="dock-chip-remove"
            data-dock-remove="${esc(rec.id)}"
            aria-label="Remove ${esc(rec.shortName || rec.name)} from pinned items"
          >&times;</button>
        </span>
      `
      )
      .join('');
  }
}

/* ==========================================================================
   Detail Modal (Full Metadata, Limitations, Starter Snippet, Citations)
   ========================================================================== */

function openDetailModal(recordId, { focusCitations = false } = {}) {
  const record = state.registry?.byId.get(recordId);
  if (!record || !dom['detail-modal']) return;

  state.detailRecordId = recordId;
  state.detailCiteTab = 'bibtex';

  const type = getRecordType(record);
  const year = type === 'challenges' ? record.yearsActive : extractRecordYear(record, type);

  // Header badges & titles
  const badges = [];
  if (type === 'datasets') {
    badges.push(`<span class="pill ${getAccessPillClass(record.accessTier)}">${esc(record.accessTier)}</span>`);
    badges.push(`<span class="pill pill-neutral">${esc(record.platform)}</span>`);
    badges.push(`<span class="pill pill-cohort">${esc(record.cohortDisplay)}</span>`);
  } else if (type === 'models') {
    badges.push(`<span class="pill ${getModelCategoryPillClass(record.category)}">${esc(record.category)}</span>`);
    badges.push(
      `<span class="pill ${record.weightsAvailable ? 'pill-open' : 'pill-neutral'}">${record.weightsAvailable ? 'Open Weights' : 'Code Only'}</span>`
    );
    badges.push(`<span class="pill pill-neutral">${esc(record.framework)}</span>`);
  } else {
    badges.push(
      `<span class="pill ${record.status === 'Active / Recurring' ? 'pill-open' : 'pill-neutral'}">${esc(record.status)}</span>`
    );
    badges.push(`<span class="pill pill-neutral">${esc(record.platform)}</span>`);
  }
  badges.push(`<span class="pill pill-neutral mono">${esc(year ?? '—')}</span>`);

  dom['detail-modal-badges'].innerHTML = badges.join('');
  dom['detail-modal-title'].textContent = record.name || record.shortName || record.id;
  dom['detail-modal-subtitle'].textContent =
    type === 'datasets'
      ? `ID: ${record.id} · License: ${record.license}`
      : type === 'models'
        ? `ID: ${record.id} · License: ${record.openSourceLicense}`
        : `ID: ${record.id} · Organizer: ${record.organizer}`;

  syncDetailModalPinBtn();

  // Links row
  const links = [];
  const primaryUrl = safeHref(getPrimaryUrl(record));
  if (primaryUrl) {
    links.push(
      `<a href="${esc(primaryUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">Open Official ${type === 'models' ? 'Repository' : type === 'challenges' ? 'Portal' : 'Dataset'} &#8599;</a>`
    );
  }
  const weightsUrl = safeHref(record.weightsUrl);
  if (weightsUrl) {
    links.push(
      `<a href="${esc(weightsUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Pretrained Weights &#8599;</a>`
    );
  }
  const paperUrl = safeHref(record.paperUrl);
  if (paperUrl) {
    links.push(
      `<a href="${esc(paperUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Primary Publication &#8599;</a>`
    );
  }
  if (record.citation?.doi && !String(record.paperUrl || '').includes(record.citation.doi)) {
    const doiHref = safeHref(`https://doi.org/${String(record.citation.doi).trim()}`);
    if (doiHref) {
      links.push(
        `<a href="${esc(doiHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm mono">DOI: ${esc(record.citation.doi)} &#8599;</a>`
      );
    }
  }

  // Metadata cards
  const metaCards = [
    {
      label: 'Modalities',
      html: `<div class="tag-cloud">${(record.modalities || []).map((m) => `<span class="tag tag-modality">${esc(m)}</span>`).join('')}</div>`,
    },
    {
      label: 'Pathologies',
      html: `<div class="tag-cloud">${(record.pathologies || []).map((p) => `<span class="tag tag-pathology">${esc(p)}</span>`).join('')}</div>`,
    },
  ];

  if (type === 'datasets') {
    metaCards.push(
      {
        label: 'Clinical Phases',
        html: `<div class="tag-cloud">${(record.clinicalPhases || []).map((ph) => `<span class="tag tag-phase">${esc(ph)}</span>`).join('')}</div>`,
      },
      {
        label: 'Molecular Markers',
        html:
          record.molecularMarkers?.length > 0
            ? `<div class="tag-cloud">${record.molecularMarkers.map((mk) => `<span class="tag tag-molecular">${esc(mk)}</span>`).join('')}</div>`
            : `<span class="detail-meta-value" style="color:var(--text-muted);">None reported</span>`,
      },
      {
        label: 'Supported AI / Clinical Tasks',
        wide: true,
        html: `<div class="tag-cloud">${(record.tasks || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`,
      },
      {
        label: 'Annotations & Ground Truth',
        wide: true,
        html: `<div class="tag-cloud">${(record.annotations || []).map((a) => `<span class="tag">${esc(a)}</span>`).join('')}</div>`,
      }
    );
  } else if (type === 'models') {
    metaCards.push({
      label: 'Architecture / Engine',
      wide: true,
      html: `<span class="detail-meta-value">${esc(record.architecture)}</span>`,
    });
  } else {
    metaCards.push(
      {
        label: 'Official Evaluation Metrics',
        html: `<div class="tag-cloud">${(record.metrics || []).map((m) => `<span class="tag tag-metric">${esc(m)}</span>`).join('')}</div>`,
      },
      {
        label: 'Benchmark Tasks',
        html: `<div class="tag-cloud">${(record.tasks || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`,
      }
    );
  }

  const snippet = type === 'datasets' ? record.fetchSnippet : type === 'models' ? record.installSnippet : null;
  const snippetTitle =
    type === 'datasets'
      ? `Starter Fetch Snippet (${record.platform})`
      : 'Quick-Start Installation Snippet';

  const bodyHtml = `
    <div class="detail-links-row">${links.join('')}</div>

    <p class="detail-highlights">${esc(record.highlights)}</p>

    ${
      record.limitations
        ? `<div class="detail-limitations">
            <div class="detail-limitations-title">&#9888; Honest Limitations &amp; Cohort Biases</div>
            <p>${esc(record.limitations)}</p>
          </div>`
        : ''
    }

    <div class="detail-meta-grid">
      ${metaCards
        .map(
          (mc) => `
        <div class="detail-meta-card${mc.wide ? ' is-wide' : ''}">
          <span class="detail-meta-label">${esc(mc.label)}</span>
          ${mc.html}
        </div>
      `
        )
        .join('')}
    </div>

    ${
      snippet
        ? `<div class="code-card">
            <div class="code-card-header">
              <span class="code-card-title">${esc(snippetTitle)}</span>
              <button type="button" class="btn btn-secondary btn-xs" id="btn-detail-copy-snippet">Copy Snippet</button>
            </div>
            <pre class="mono">${esc(snippet)}</pre>
          </div>`
        : ''
    }

    <div class="citation-panel" id="detail-citation-section">
      <div class="citation-panel-header">
        <div class="citation-tabs" role="tablist" aria-label="Citation format">
          <button type="button" class="cite-tab-btn is-active" data-cite-tab="bibtex" role="tab" aria-selected="true">BibTeX</button>
          <button type="button" class="cite-tab-btn" data-cite-tab="ris" role="tab" aria-selected="false">RIS</button>
          <button type="button" class="cite-tab-btn" data-cite-tab="apa" role="tab" aria-selected="false">APA 7th</button>
        </div>
        <div class="citation-actions">
          <button type="button" class="btn btn-primary btn-xs" id="btn-detail-copy-cite">Copy Citation</button>
          <button type="button" class="btn btn-secondary btn-xs" id="btn-detail-dl-cite">Download</button>
        </div>
      </div>
      <pre id="detail-citation-output" class="citation-output"></pre>
    </div>
  `;

  dom['detail-modal-body'].innerHTML = bodyHtml;
  updateDetailCitationPreview(record);

  // Wire snippet & citation buttons inside modal
  dom['detail-modal-body'].querySelector('#btn-detail-copy-snippet')?.addEventListener('click', async () => {
    const ok = await copyToClipboard(snippet || '');
    showToast(ok ? 'Copied starter code snippet to clipboard.' : 'Clipboard copy failed.', ok ? 'success' : 'error');
  });

  dom['detail-modal-body'].querySelectorAll('[data-cite-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.detailCiteTab = btn.getAttribute('data-cite-tab') || 'bibtex';
      dom['detail-modal-body'].querySelectorAll('[data-cite-tab]').forEach((b) => {
        const active = b.getAttribute('data-cite-tab') === state.detailCiteTab;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });
      updateDetailCitationPreview(record);
    });
  });

  dom['detail-modal-body'].querySelector('#btn-detail-copy-cite')?.addEventListener('click', async () => {
    const text = getFormattedCitation(record, state.detailCiteTab);
    const ok = await copyToClipboard(text);
    showToast(
      ok ? `Copied ${state.detailCiteTab.toUpperCase()} citation to clipboard.` : 'Clipboard copy failed.',
      ok ? 'success' : 'error'
    );
  });

  dom['detail-modal-body'].querySelector('#btn-detail-dl-cite')?.addEventListener('click', () => {
    const tab = state.detailCiteTab;
    const text = getFormattedCitation(record, tab);
    const ext = tab === 'bibtex' ? 'bib' : tab === 'ris' ? 'ris' : 'txt';
    const fname = `${record.id || 'citation'}.${ext}`;
    downloadTextFile(fname, `${text}\n`);
    showToast(`Downloaded ${fname}`);
  });

  dom['detail-modal'].hidden = false;
  document.body.classList.add('modal-open');
  syncHashFromState();

  if (focusCitations) {
    requestAnimationFrame(() => {
      dom['detail-modal-body']
        .querySelector('#detail-citation-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  } else {
    dom['detail-modal-body'].scrollTop = 0;
  }
}

function getFormattedCitation(record, tab) {
  const type = getRecordType(record);
  if (tab === 'ris') return toRis(record, type);
  if (tab === 'apa') return toApa(record, type);
  return toBibtex(record, type);
}

function updateDetailCitationPreview(record) {
  const outEl = dom['detail-modal-body']?.querySelector('#detail-citation-output');
  const dlBtn = dom['detail-modal-body']?.querySelector('#btn-detail-dl-cite');
  if (!outEl) return;
  outEl.textContent = getFormattedCitation(record, state.detailCiteTab);
  outEl.classList.toggle('is-apa', state.detailCiteTab === 'apa');
  if (dlBtn) {
    dlBtn.textContent =
      state.detailCiteTab === 'bibtex'
        ? 'Download .bib'
        : state.detailCiteTab === 'ris'
          ? 'Download .ris'
          : 'Download .txt';
  }
}

function syncDetailModalPinBtn() {
  const btn = dom['detail-modal-pin-btn'];
  if (!btn || !state.detailRecordId) return;
  const pinned = state.selectedIds.has(state.detailRecordId);
  btn.textContent = pinned ? '✓ Pinned to Compare' : '+ Pin to Compare';
  btn.classList.toggle('btn-pinned', pinned);
  btn.classList.toggle('btn-secondary', !pinned);
}

function closeDetailModal() {
  if (!dom['detail-modal'] || dom['detail-modal'].hidden) return;
  dom['detail-modal'].hidden = true;
  state.detailRecordId = null;
  if (!state.compareModalOpen) document.body.classList.remove('modal-open');
  syncHashFromState();
}

/* ==========================================================================
   Side-by-Side Comparison Modal (Up to 4 Items + Markdown/CSV/BibTeX Export)
   ========================================================================== */

function openCompareModal() {
  const selected = getSelectedRecords();
  if (selected.length === 0 || !dom['compare-modal']) return;
  state.compareModalOpen = true;
  renderCompareModalBody();
  dom['compare-modal'].hidden = false;
  document.body.classList.add('modal-open');
}

function renderCompareModalBody() {
  const allSelected = getSelectedRecords();
  const compared = allSelected.slice(0, MAX_COMPARE_ITEMS);

  if (dom['compare-modal-subtitle']) {
    dom['compare-modal-subtitle'].textContent =
      allSelected.length > MAX_COMPARE_ITEMS
        ? `Comparing ${compared.length} of ${allSelected.length} pinned resources side-by-side (exports include all ${allSelected.length}).`
        : `Comparing ${compared.length} pinned resource${compared.length === 1 ? '' : 's'} side-by-side.`;
  }

  const rows = [
    {
      label: 'Resource Type',
      render: (r) => {
        const t = getRecordType(r);
        return t === 'datasets' ? 'Dataset' : t === 'models' ? 'Model / Toolkit' : 'MICCAI Challenge';
      },
    },
    {
      label: 'Year / Span',
      render: (r) =>
        `<span class="mono">${esc(getRecordType(r) === 'challenges' ? r.yearsActive : extractRecordYear(r) ?? '—')}</span>`,
    },
    {
      label: 'Access / License',
      render: (r) => {
        const t = getRecordType(r);
        if (t === 'datasets') {
          return `<span class="pill ${getAccessPillClass(r.accessTier)}">${esc(r.accessTier)}</span><div style="margin-top:4px;font-size:0.76rem;color:var(--text-muted);">${esc(r.license)}</div>`;
        }
        if (t === 'models') {
          return `<span class="pill ${r.weightsAvailable ? 'pill-open' : 'pill-neutral'}">${r.weightsAvailable ? 'Open Weights' : 'Code Only'}</span><div style="margin-top:4px;font-size:0.76rem;color:var(--text-muted);">${esc(r.openSourceLicense)}</div>`;
        }
        return `<span class="pill ${r.status === 'Active / Recurring' ? 'pill-open' : 'pill-neutral'}">${esc(r.status)}</span>`;
      },
    },
    {
      label: 'Cohort / Engine / Organizer',
      render: (r) => {
        const t = getRecordType(r);
        if (t === 'datasets') return `<strong>${esc(r.cohortDisplay)}</strong>`;
        if (t === 'models') return `${esc(r.architecture)} <div style="font-size:0.76rem;color:var(--text-muted);margin-top:3px;">${esc(r.framework)}</div>`;
        return esc(r.organizer);
      },
    },
    {
      label: 'Modalities',
      render: (r) =>
        `<div class="tag-cloud">${(r.modalities || []).map((m) => `<span class="tag tag-modality">${esc(m)}</span>`).join('')}</div>`,
    },
    {
      label: 'Pathologies',
      render: (r) =>
        `<div class="tag-cloud">${(r.pathologies || []).map((p) => `<span class="tag tag-pathology">${esc(p)}</span>`).join('')}</div>`,
    },
    {
      label: 'Clinical Phases / Category',
      render: (r) => {
        if (Array.isArray(r.clinicalPhases) && r.clinicalPhases.length) {
          return `<div class="tag-cloud">${r.clinicalPhases.map((p) => `<span class="tag tag-phase">${esc(p)}</span>`).join('')}</div>`;
        }
        if (r.category) return esc(r.category);
        return '—';
      },
    },
    {
      label: 'Molecular / Metrics',
      render: (r) => {
        if (Array.isArray(r.molecularMarkers) && r.molecularMarkers.length) {
          return `<div class="tag-cloud">${r.molecularMarkers.map((m) => `<span class="tag tag-molecular">${esc(m)}</span>`).join('')}</div>`;
        }
        if (Array.isArray(r.metrics) && r.metrics.length) {
          return `<div class="tag-cloud">${r.metrics.map((m) => `<span class="tag tag-metric">${esc(m)}</span>`).join('')}</div>`;
        }
        return '<span style="color:var(--text-muted);">—</span>';
      },
    },
    {
      label: 'Annotations / Tasks',
      render: (r) => {
        const list = r.annotations || r.tasks || [];
        return list.length > 0
          ? `<div class="tag-cloud">${list.map((v) => `<span class="tag">${esc(v)}</span>`).join('')}</div>`
          : '<span style="color:var(--text-muted);">—</span>';
      },
    },
    {
      label: 'Platform',
      render: (r) => esc(r.platform || r.framework || '—'),
    },
    {
      label: 'Highlights',
      render: (r) => esc(r.highlights),
    },
    {
      label: 'Limitations & Biases',
      render: (r) =>
        r.limitations
          ? `<div style="color:var(--accent-amber-text);font-size:0.8rem;">${esc(r.limitations)}</div>`
          : '<span style="color:var(--text-muted);">—</span>',
    },
    {
      label: 'Links',
      render: (r) => {
        const primaryHref = safeHref(getPrimaryUrl(r));
        const paperHref = safeHref(r.paperUrl);
        return `
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${primaryHref ? `<a href="${esc(primaryHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-xs">Source &#8599;</a>` : ''}
          ${paperHref ? `<a href="${esc(paperHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">Paper &#8599;</a>` : ''}
        </div>
      `;
      },
    },
  ];

  const overflowBanner =
    allSelected.length > MAX_COMPARE_ITEMS
      ? `<div class="compare-note">Side-by-side table displays up to 4 items. Remove a column below to swap in another pinned item, or export all ${allSelected.length} items via Markdown, CSV, or BibTeX above.</div>`
      : '';

  const colHeads = compared
    .map(
      (rec) => `
      <th>
        <div class="compare-col-head">
          <div class="compare-col-head-top">
            <span class="compare-col-title">${esc(rec.shortName || rec.name)}</span>
            <button type="button" class="btn btn-ghost btn-xs" data-compare-remove="${esc(rec.id)}" title="Remove from pinned">&times;</button>
          </div>
          ${rec.shortName && rec.shortName !== rec.name ? `<span style="font-size:0.74rem;font-weight:400;color:var(--text-muted);">${esc(rec.name)}</span>` : ''}
        </div>
      </th>
    `
    )
    .join('');

  const bodyRows = rows
    .map(
      (row) => `
      <tr>
        <th class="compare-attr-col" scope="row">${esc(row.label)}</th>
        ${compared.map((rec) => `<td>${row.render(rec)}</td>`).join('')}
      </tr>
    `
    )
    .join('');

  dom['compare-modal-body'].innerHTML = `
    ${overflowBanner}
    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead>
          <tr>
            <th class="compare-attr-col">Attribute</th>
            ${colHeads}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

function closeCompareModal() {
  if (!dom['compare-modal'] || dom['compare-modal'].hidden) return;
  dom['compare-modal'].hidden = true;
  state.compareModalOpen = false;
  if (!state.detailRecordId) document.body.classList.remove('modal-open');
}

/* ==========================================================================
   Filter Sidebar Responsive Drawer Helpers
   ========================================================================== */

function isMobileViewport() {
  return window.matchMedia('(max-width: 960px)').matches;
}

function toggleFilterSidebar() {
  if (isMobileViewport()) {
    state.filtersOpenMobile = !state.filtersOpenMobile;
    dom['filter-sidebar']?.classList.toggle('is-mobile-open', state.filtersOpenMobile);
    if (dom['mobile-filter-scrim']) dom['mobile-filter-scrim'].hidden = !state.filtersOpenMobile;
    dom['btn-toggle-filters']?.setAttribute('aria-expanded', String(state.filtersOpenMobile));
  } else {
    state.filtersCollapsedDesktop = !state.filtersCollapsedDesktop;
    dom['explorer-layout']?.classList.toggle('filters-collapsed', state.filtersCollapsedDesktop);
    dom['btn-toggle-filters']?.setAttribute('aria-expanded', String(!state.filtersCollapsedDesktop));
  }
}

function closeMobileFilterDrawer() {
  state.filtersOpenMobile = false;
  dom['filter-sidebar']?.classList.remove('is-mobile-open');
  if (dom['mobile-filter-scrim']) dom['mobile-filter-scrim'].hidden = true;
}

/* ==========================================================================
   Global Event Wiring
   ========================================================================== */

function wireGlobalEvents() {
  // Theme toggle
  dom['btn-theme-toggle']?.addEventListener('click', toggleTheme);

  // Copy local server command in offline banner
  dom['btn-copy-server-cmd']?.addEventListener('click', async () => {
    const ok = await copyToClipboard('python -m http.server 8000');
    showToast(ok ? 'Copied `python -m http.server 8000` to clipboard.' : 'Copy failed.', ok ? 'success' : 'error');
  });

  // Primary View Navigation
  document.querySelectorAll('.nav-tab[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      if (target) setActiveView(target);
    });
  });

  // Interactive KPI strip clicks
  document.querySelectorAll('.kpi-card[data-kpi-action]').forEach((card) => {
    card.addEventListener('click', () => {
      const action = card.getAttribute('data-kpi-action');
      if (action === 'datasets') jumpToCatalogWithFilters({ tab: 'datasets' });
      else if (action === 'models') jumpToCatalogWithFilters({ tab: 'models' });
      else if (action === 'challenges') jumpToCatalogWithFilters({ tab: 'challenges' });
      else if (action === 'open-access') {
        jumpToCatalogWithFilters({ tab: 'datasets', accessTiers: ['Open Access'] });
      } else if (action === 'longitudinal') {
        jumpToCatalogWithFilters({ tab: 'datasets', hasLongitudinal: true });
      } else if (action === 'molecular') {
        jumpToCatalogWithFilters({ tab: 'datasets', hasMolecular: true });
      }
    });
  });

  // Brand link returns cleanly to Explore Catalog
  document.querySelector('.brand-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveView('explorer', { scrollToTop: true });
    state.filters.tab = 'datasets';
    renderCatalog();
  });

  // Catalog sub-tabs (preserve shared query/modality/pathology/year; clear incompatible collection-only facets)
  document.querySelectorAll('[data-catalog-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-catalog-tab');
      if (!tab || tab === state.filters.tab) return;
      state.filters.tab = tab;
      if (tab === 'datasets') {
        state.filters.modelCategories = [];
        state.filters.hasOpenWeights = false;
        state.filters.challengeStatuses = [];
        state.filters.metrics = [];
      } else if (tab === 'models') {
        state.filters.accessTiers = [];
        state.filters.clinicalPhases = [];
        state.filters.platforms = [];
        state.filters.tasks = [];
        state.filters.molecularMarkers = [];
        state.filters.hasMolecular = false;
        state.filters.hasLongitudinal = false;
        state.filters.openAccessOnly = false;
        state.filters.challengeStatuses = [];
        state.filters.metrics = [];
      } else if (tab === 'challenges') {
        state.filters.accessTiers = [];
        state.filters.clinicalPhases = [];
        state.filters.molecularMarkers = [];
        state.filters.hasMolecular = false;
        state.filters.hasLongitudinal = false;
        state.filters.openAccessOnly = false;
        state.filters.modelCategories = [];
        state.filters.hasOpenWeights = false;
      }
      renderCatalog();
    });
  });

  // Instant search
  dom['catalog-search']?.addEventListener('input', (e) => {
    state.filters.query = e.target.value;
    if (!state.filters.query.trim() && !state.userSelectedSort) {
      state.filters.sortBy = 'year-desc';
    }
    renderCatalog();
  });

  dom['btn-clear-search']?.addEventListener('click', () => {
    state.filters.query = '';
    if (dom['catalog-search']) {
      dom['catalog-search'].value = '';
      dom['catalog-search'].focus();
    }
    if (!state.userSelectedSort) state.filters.sortBy = 'year-desc';
    renderCatalog();
  });

  // Sort selector
  dom['catalog-sort']?.addEventListener('change', (e) => {
    state.filters.sortBy = e.target.value;
    state.userSelectedSort = true;
    renderCatalog();
  });

  // Filter collapse / mobile drawer
  dom['btn-toggle-filters']?.addEventListener('click', toggleFilterSidebar);
  dom['btn-close-filters-mobile']?.addEventListener('click', closeMobileFilterDrawer);
  dom['mobile-filter-scrim']?.addEventListener('click', closeMobileFilterDrawer);
  dom['btn-reset-sidebar-filters']?.addEventListener('click', () => clearAllFilters({ preserveTab: true }));

  // Layout switcher (Cards vs Table)
  dom['btn-layout-cards']?.addEventListener('click', () => {
    state.displayMode = 'cards';
    dom['btn-layout-cards']?.classList.add('is-active');
    dom['btn-layout-cards']?.setAttribute('aria-pressed', 'true');
    dom['btn-layout-table']?.classList.remove('is-active');
    dom['btn-layout-table']?.setAttribute('aria-pressed', 'false');
    renderResultsList(state.currentFilteredRecords);
  });

  dom['btn-layout-table']?.addEventListener('click', () => {
    state.displayMode = 'table';
    dom['btn-layout-table']?.classList.add('is-active');
    dom['btn-layout-table']?.setAttribute('aria-pressed', 'true');
    dom['btn-layout-cards']?.classList.remove('is-active');
    dom['btn-layout-cards']?.setAttribute('aria-pressed', 'false');
    renderResultsList(state.currentFilteredRecords);
  });

  // Export filtered view (.bib / .csv)
  dom['btn-export-filtered-bib']?.addEventListener('click', () => {
    if (state.currentFilteredRecords.length === 0) {
      showToast('No filtered records to export.', 'error');
      return;
    }
    const bib = toBulkBibtex(state.currentFilteredRecords);
    downloadTextFile(`openneuroatlas-${state.filters.tab}.bib`, `${bib}\n`, 'application/x-bibtex;charset=utf-8');
    showToast(`Exported ${state.currentFilteredRecords.length} citations to .bib.`);
  });

  dom['btn-export-filtered-csv']?.addEventListener('click', () => {
    if (state.currentFilteredRecords.length === 0) {
      showToast('No filtered records to export.', 'error');
      return;
    }
    const csv = toCsv(state.currentFilteredRecords, state.filters.tab, { includeBom: true });
    downloadTextFile(`openneuroatlas-${state.filters.tab}.csv`, csv, 'text/csv;charset=utf-8');
    showToast(`Exported ${state.currentFilteredRecords.length} records to .csv.`);
  });

  // Delegated facet sidebar clicks
  dom['filter-facets-container']?.addEventListener('click', (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;

    const toggleBtn = target.closest('[data-toggle-key]');
    if (toggleBtn) {
      const key = toggleBtn.getAttribute('data-toggle-key');
      if (key && key in state.filters) {
        state.filters[key] = !state.filters[key];
        renderCatalog();
      }
      return;
    }

    const facetBtn = target.closest('[data-facet-key]');
    if (facetBtn) {
      const key = facetBtn.getAttribute('data-facet-key');
      const val = facetBtn.getAttribute('data-facet-value');
      if (key && val) toggleArrayFilter(key, val);
    }
  });

  // Delegated active filter chip removal
  dom['active-filters-bar']?.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-chip-action]') : null;
    if (!btn) return;
    const action = btn.getAttribute('data-chip-action');
    const key = btn.getAttribute('data-chip-key');
    const val = btn.getAttribute('data-chip-value');

    if (action === 'clear-all') {
      clearAllFilters({ preserveTab: true });
    } else if (action === 'clear-query') {
      state.filters.query = '';
      if (dom['catalog-search']) dom['catalog-search'].value = '';
      if (!state.userSelectedSort) state.filters.sortBy = 'year-desc';
      renderCatalog();
    } else if (action === 'clear-year') {
      state.filters.year = null;
      renderCatalog();
    } else if (action === 'clear-toggle' && val) {
      state.filters[val] = false;
      renderCatalog();
    } else if (action === 'remove-facet' && key && val) {
      toggleArrayFilter(key, val);
    }
  });

  // Delegated catalog card / table / empty-state actions
  dom['catalog-results']?.addEventListener('click', (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;

    const emptyBtn = target.closest('[data-empty-action]');
    if (emptyBtn) {
      const action = emptyBtn.getAttribute('data-empty-action');
      if (action === 'clear-filters') {
        clearAllFilters({ preserveTab: true });
      } else if (action === 'switch-all') {
        state.filters.tab = 'all';
        renderCatalog();
      } else if (action === 'propose-gap') {
        launchPrBuilderWithPrefill({
          recordType: 'datasets',
          modalities: [...state.filters.modalities],
          pathologies: [...state.filters.pathologies],
        });
      }
      return;
    }

    const cardBtn = target.closest('[data-card-action]');
    if (!cardBtn) return;

    const action = cardBtn.getAttribute('data-card-action');
    const id = cardBtn.getAttribute('data-id');

    if (action === 'details' && id) {
      openDetailModal(id);
    } else if (action === 'cite' && id) {
      openDetailModal(id, { focusCitations: true });
    } else if (action === 'pin' && id) {
      togglePinRecord(id);
    } else if (action === 'toggle-limitations') {
      const wrap = cardBtn.closest('.card-limitations-wrap');
      const box = wrap?.querySelector('.limitations-box');
      if (box) {
        const nextHidden = !box.hidden;
        box.hidden = nextHidden;
        cardBtn.setAttribute('aria-expanded', String(!nextHidden));
        const caret = cardBtn.querySelector('.lim-caret');
        if (caret) caret.innerHTML = nextHidden ? '&#9662;' : '&#9652;';
      }
    }
  });

  // Analytics metric & scale switchers
  dom['heatmap-metric-controls']?.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-heatmap-metric]') : null;
    if (!btn) return;
    const metric = btn.getAttribute('data-heatmap-metric');
    if (metric && metric !== state.heatmapMetric) {
      state.heatmapMetric = metric;
      renderAnalyticsDashboard();
    }
  });

  dom['cohort-scale-controls']?.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-cohort-scale]') : null;
    if (!btn) return;
    const scale = btn.getAttribute('data-cohort-scale');
    if (scale && scale !== state.cohortScale) {
      state.cohortScale = scale;
      renderAnalyticsDashboard();
    }
  });

  // Bottom Comparator Dock actions
  dom['dock-items-list']?.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-dock-remove]') : null;
    const id = btn?.getAttribute('data-dock-remove');
    if (id) togglePinRecord(id);
  });

  dom['btn-dock-compare']?.addEventListener('click', openCompareModal);

  dom['btn-dock-bib']?.addEventListener('click', () => {
    const selected = getSelectedRecords();
    if (!selected.length) return;
    const bib = toBulkBibtex(selected);
    downloadTextFile('openneuroatlas-selected.bib', `${bib}\n`, 'application/x-bibtex;charset=utf-8');
    showToast(`Downloaded BibTeX for ${selected.length} pinned item${selected.length === 1 ? '' : 's'}.`);
  });

  dom['btn-dock-ris']?.addEventListener('click', () => {
    const selected = getSelectedRecords();
    if (!selected.length) return;
    const ris = toBulkRis(selected);
    downloadTextFile('openneuroatlas-selected.ris', `${ris}\n`, 'application/x-research-info-systems;charset=utf-8');
    showToast(`Downloaded RIS for ${selected.length} pinned item${selected.length === 1 ? '' : 's'}.`);
  });

  dom['btn-dock-csv']?.addEventListener('click', () => {
    const selected = getSelectedRecords();
    if (!selected.length) return;
    const csv = toCsv(selected, undefined, { includeBom: true });
    downloadTextFile('openneuroatlas-selected.csv', csv, 'text/csv;charset=utf-8');
    showToast(`Downloaded CSV for ${selected.length} pinned item${selected.length === 1 ? '' : 's'}.`);
  });

  dom['btn-dock-clear']?.addEventListener('click', () => {
    state.selectedIds.clear();
    renderComparatorDock();
    renderCatalog();
    closeCompareModal();
    showToast('Cleared pinned selection.');
  });

  // Detail Modal controls
  dom['detail-modal-close']?.addEventListener('click', closeDetailModal);
  dom['detail-modal-pin-btn']?.addEventListener('click', () => {
    if (state.detailRecordId) togglePinRecord(state.detailRecordId);
  });
  dom['detail-modal']?.addEventListener('click', (e) => {
    if (e.target === dom['detail-modal']) closeDetailModal();
  });

  // Compare Modal controls
  dom['compare-modal-close']?.addEventListener('click', closeCompareModal);
  dom['compare-modal']?.addEventListener('click', (e) => {
    if (e.target === dom['compare-modal']) closeCompareModal();
  });
  dom['compare-modal-body']?.addEventListener('click', (e) => {
    const btn = e.target instanceof HTMLElement ? e.target.closest('[data-compare-remove]') : null;
    const id = btn?.getAttribute('data-compare-remove');
    if (id) togglePinRecord(id);
  });

  dom['btn-compare-copy-md']?.addEventListener('click', async () => {
    const selected = getSelectedRecords();
    const md = toMarkdownTable(selected);
    const ok = await copyToClipboard(md);
    showToast(ok ? 'Copied GFM Markdown comparison table to clipboard.' : 'Clipboard copy failed.', ok ? 'success' : 'error');
  });

  dom['btn-compare-dl-md']?.addEventListener('click', () => {
    const selected = getSelectedRecords();
    const md = toMarkdownTable(selected);
    downloadTextFile('openneuroatlas-comparison.md', `${md}\n`, 'text/markdown;charset=utf-8');
    showToast('Downloaded openneuroatlas-comparison.md');
  });

  dom['btn-compare-dl-csv']?.addEventListener('click', () => {
    const selected = getSelectedRecords();
    const csv = toCsv(selected, undefined, { includeBom: true });
    downloadTextFile('openneuroatlas-comparison.csv', csv, 'text/csv;charset=utf-8');
    showToast('Downloaded openneuroatlas-comparison.csv');
  });

  dom['btn-compare-dl-bib']?.addEventListener('click', () => {
    const selected = getSelectedRecords();
    const bib = toBulkBibtex(selected);
    downloadTextFile('openneuroatlas-comparison.bib', `${bib}\n`, 'application/x-bibtex;charset=utf-8');
    showToast('Downloaded openneuroatlas-comparison.bib');
  });

  // Global Keyboard Shortcuts: `/` search, `Escape` close modal/drawer, `t` theme toggle
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    const isTyping =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      document.activeElement?.isContentEditable;

    if (e.key === 'Escape') {
      if (state.compareModalOpen) {
        closeCompareModal();
      } else if (state.detailRecordId) {
        closeDetailModal();
      } else if (state.filtersOpenMobile) {
        closeMobileFilterDrawer();
      }
      return;
    }

    if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '/') {
      e.preventDefault();
      if (state.activeView !== 'explorer') {
        setActiveView('explorer');
      }
      dom['catalog-search']?.focus();
      dom['catalog-search']?.select();
    } else if (e.key === 't' || e.key === 'T') {
      toggleTheme();
    }
  });
}

/* ==========================================================================
   Bootstrap
   ========================================================================== */

async function boot() {
  cacheDom();
  applyTheme(getCurrentTheme(), false);
  wireGlobalEvents();
  hydrateStateFromHash();

  try {
    const registry = await loadRegistry('./');
    state.registry = registry;
    state.analytics = computeAnalytics(registry);

    renderHeaderAndKpis();

    if (dom['catalog-search'] && state.filters.query) {
      dom['catalog-search'].value = state.filters.query;
    }

    renderCatalog();
    renderComparatorDock();
    setActiveView(state.activeView);

    if (state.detailRecordId && registry.byId.has(state.detailRecordId)) {
      openDetailModal(state.detailRecordId);
    } else {
      state.detailRecordId = null;
    }
  } catch (err) {
    if (dom['catalog-loading']) dom['catalog-loading'].hidden = true;
    if (dom['offline-guard-banner']) dom['offline-guard-banner'].hidden = false;
    if (dom['offline-guard-message']) {
      const detail = err instanceof Error ? err.message : String(err);
      const isFile = window.location.protocol === 'file:';
      dom['offline-guard-message'].innerHTML = isFile
        ? `Browsers block <code>fetch()</code> and ES modules over <code>file://</code>. Start a local static server from the repository root and visit <code>http://localhost:8000</code>:`
        : `Failed to fetch registry data (${esc(detail)}). Serve the repository root over HTTP (e.g., <code>http://localhost:8000</code>):`;
    }
    if (dom['results-summary']) {
      dom['results-summary'].textContent = 'Registry offline — see server instructions above.';
    }
  }
}

boot();
