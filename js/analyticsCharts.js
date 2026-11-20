/**
 * OpenNeuroAtlas — Pure Responsive SVG Analytics & Gap Visualizations
 *
 * Zero external charting libraries. Renders theme-aware SVG charts using CSS tokens,
 * keyboard focusability (tabindex="0", Enter/Space), floating tooltips, and
 * click-to-filter / click-to-PR callbacks.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element with attributes.
 * @param {string} tag
 * @param {Record<string, string|number>} [attrs={}]
 * @param {string} [textContent]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}, textContent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val !== undefined && val !== null) {
      el.setAttribute(key, String(val));
    }
  }
  if (textContent !== undefined && textContent !== null) {
    el.textContent = String(textContent);
  }
  return el;
}

/**
 * Escape HTML special characters for safe tooltip and card rendering.
 * @param {any} str
 * @returns {string}
 */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format compact integers (e.g., 12450 -> "12.5K", 630 -> "630").
 * @param {number} n
 * @returns {string}
 */
function formatCompact(n) {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10000) return `${(n / 1000).toFixed(0)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

/**
 * Truncate text cleanly with ellipsis.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  const s = String(str ?? '');
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

/**
 * Access-tier CSS variable fill color.
 * @param {string} tier
 * @returns {string}
 */
function tierColorVar(tier) {
  if (tier === 'Open Access') return 'var(--accent-emerald)';
  if (tier === 'Registration Required') return 'var(--accent-cyan)';
  return 'var(--accent-amber)';
}

/**
 * Shared floating tooltip controller anchored to #chart-tooltip.
 */
function getTooltipEl() {
  return document.getElementById('chart-tooltip');
}

function showTooltip(event, htmlContent) {
  const tip = getTooltipEl();
  if (!tip) return;
  tip.innerHTML = htmlContent;
  tip.hidden = false;
  positionTooltip(event, tip);
}

function positionTooltip(event, tipEl) {
  const tip = tipEl || getTooltipEl();
  if (!tip || tip.hidden) return;
  const pad = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rect = tip.getBoundingClientRect();

  let clientX;
  let clientY;
  if (event && typeof event.clientX === 'number' && (event.clientX !== 0 || event.clientY !== 0)) {
    clientX = event.clientX;
    clientY = event.clientY;
  } else if (event && event.target && typeof event.target.getBoundingClientRect === 'function') {
    const r = event.target.getBoundingClientRect();
    clientX = r.left + r.width / 2;
    clientY = r.top;
  } else {
    clientX = vw / 2;
    clientY = vh / 2;
  }

  let left = clientX + pad;
  let top = clientY + pad;

  if (left + rect.width > vw - 12) {
    left = Math.max(12, clientX - rect.width - pad);
  }
  if (top + rect.height > vh - 12) {
    top = Math.max(12, clientY - rect.height - pad);
  }

  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

export function hideChartTooltip() {
  const tip = getTooltipEl();
  if (tip) tip.hidden = true;
}

/**
 * Attach pointer + keyboard tooltip & activation handlers to an SVG interactive group.
 * @param {SVGElement} el
 * @param {() => string} getHtml
 * @param {() => void} onActivate
 */
function wireInteractiveSvgNode(el, getHtml, onActivate) {
  el.addEventListener('mouseenter', (e) => showTooltip(e, getHtml()));
  el.addEventListener('mousemove', (e) => positionTooltip(e));
  el.addEventListener('mouseleave', () => hideChartTooltip());
  el.addEventListener('focus', (e) => showTooltip(e, getHtml()));
  el.addEventListener('blur', () => hideChartTooltip());
  el.addEventListener('click', () => {
    hideChartTooltip();
    if (typeof onActivate === 'function') onActivate();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      hideChartTooltip();
      if (typeof onActivate === 'function') onActivate();
    }
  });
}

/**
 * Compute discrete 5-step heatmap color token & contrasting text color.
 * @param {number} value
 * @param {number} maxVal
 * @returns {{ fill: string, text: string, step: number }}
 */
function getHeatmapColor(value, maxVal) {
  if (!value || value <= 0) {
    return { fill: 'var(--heat-0-fill)', text: 'var(--heat-0-text)', step: 0 };
  }
  const safeMax = Math.max(maxVal || 1, 5);
  let step;
  if (value === 1) step = 1;
  else if (value === 2) step = 2;
  else if (value <= Math.max(3, Math.ceil(safeMax * 0.45))) step = 3;
  else if (value <= Math.max(5, Math.ceil(safeMax * 0.72))) step = 4;
  else step = 5;

  return {
    fill: `var(--heat-${step})`,
    text: step <= 2 ? 'var(--heat-text-low)' : 'var(--heat-text-high)',
    step,
  };
}

/**
 * 1. Interactive Modality × Pathology Open-Data Coverage Heatmap (Pure SVG)
 *
 * @param {HTMLElement} container
 * @param {object} analytics
 * @param {object} activeFilters
 * @param {{
 *   metric?: 'datasets' | 'all' | 'openAccess',
 *   byId?: Map<string, object>,
 *   onCellClick?: (modality: string, pathology: string, cell: object, value: number) => void,
 *   onAxisClick?: (axis: 'modality' | 'pathology', value: string) => void
 * }} [options={}]
 */
export function renderCoverageHeatmap(container, analytics, activeFilters = {}, options = {}) {
  if (!container) return;
  container.innerHTML = '';

  const matrix = analytics?.coverageMatrix;
  if (!matrix || !Array.isArray(matrix.pathologies) || !Array.isArray(matrix.modalities)) {
    container.innerHTML = '<p class="viz-subtitle">Coverage matrix unavailable.</p>';
    return;
  }

  const metric = options.metric || 'datasets';
  const byId = options.byId instanceof Map ? options.byId : null;
  const pathologies = matrix.pathologies;
  const modalities = matrix.modalities;

  const getCellValue = (cell) => {
    if (metric === 'all') return cell.total;
    if (metric === 'openAccess') return cell.openAccessDatasets;
    return cell.datasets;
  };

  const maxVal =
    metric === 'all'
      ? matrix.maxCount
      : metric === 'openAccess'
        ? matrix.maxOpenAccessCount
        : matrix.maxDatasetCount;

  // Geometry constants
  const marginLeft = 188;
  const marginTop = 128;
  const marginRight = 92;
  const marginBottom = 74;
  const cellW = 46;
  const cellH = 30;
  const cellGap = 4;

  const gridW = modalities.length * (cellW + cellGap);
  const multiIdx = pathologies.indexOf('Multi-Pathology');
  const multiExtraGap = multiIdx > 0 ? 10 : 0;
  const gridH = pathologies.length * (cellH + cellGap) + multiExtraGap;

  const totalW = marginLeft + gridW + marginRight;
  const totalH = marginTop + gridH + marginBottom;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${totalW} ${totalH}`,
    role: 'img',
    'aria-label': `Modality by Pathology coverage heatmap (${metric}) across ${pathologies.length} pathologies and ${modalities.length} modalities`,
  });

  const activePaths = new Set(activeFilters?.pathologies || []);
  const activeMods = new Set(activeFilters?.modalities || []);

  // Column headers (Modalities angled -36°)
  const colTotals = modalities.map((mod) => {
    let sum = 0;
    for (const path of pathologies) {
      if (path === 'Multi-Pathology') continue;
      sum += getCellValue(matrix.byPathology[path][mod]);
    }
    return sum;
  });

  const colHeaderGroups = [];
  const rowHeaderGroups = [];
  const rowBgRects = [];

  modalities.forEach((mod, colIdx) => {
    const cx = marginLeft + colIdx * (cellW + cellGap) + cellW / 2;
    const cy = marginTop - 12;
    const isModActive = activeMods.has(mod);

    const g = svgEl('g', {
      class: 'svg-axis-btn',
      tabindex: '0',
      role: 'button',
      'aria-label': `Filter catalog by modality ${mod}`,
    });

    const label = svgEl(
      'text',
      {
        x: cx,
        y: cy,
        transform: `rotate(-36 ${cx} ${cy})`,
        'text-anchor': 'start',
        fill: isModActive ? 'var(--accent-cyan-text)' : 'var(--chart-label)',
        'font-size': '11.5',
        'font-weight': isModActive ? '700' : '600',
      },
      mod
    );
    g.appendChild(label);

    wireInteractiveSvgNode(
      g,
      () => `
        <div class="tooltip-title">${esc(mod)}</div>
        <div class="tooltip-metrics"><span><strong>${colTotals[colIdx]}</strong> disease-specific intersections</span></div>
        <div class="tooltip-hint">Click column header to filter Catalog by this modality</div>
      `,
      () => options.onAxisClick?.('modality', mod)
    );
    colHeaderGroups.push(g);
    svg.appendChild(g);
  });

  // Right-side "Sum" header
  svg.appendChild(
    svgEl(
      'text',
      {
        x: marginLeft + gridW + 26,
        y: marginTop - 12,
        'text-anchor': 'middle',
        fill: 'var(--chart-axis)',
        'font-size': '10.5',
        'font-weight': '700',
        'letter-spacing': '0.04em',
      },
      'SUM'
    )
  );

  // Subtle separator line above Multi-Pathology row
  if (multiIdx > 0) {
    const sepY = marginTop + multiIdx * (cellH + cellGap) + 3;
    svg.appendChild(
      svgEl('line', {
        x1: 12,
        x2: marginLeft + gridW + marginRight - 8,
        y1: sepY,
        y2: sepY,
        stroke: 'var(--border-default)',
        'stroke-dasharray': '4 3',
        'stroke-width': '1',
      })
    );
  }

  let nonZeroDiseaseCells = 0;
  let zeroDiseaseCells = 0;

  // Render rows & cells
  pathologies.forEach((path, rowIdx) => {
    const extraY = multiIdx > 0 && rowIdx >= multiIdx ? multiExtraGap : 0;
    const y = marginTop + rowIdx * (cellH + cellGap) + extraY;
    const isPathActive = activePaths.has(path);

    // Subtle full-row crosshair band
    const rowBg = svgEl('rect', {
      class: 'svg-row-bg',
      x: 8,
      y: y - 1.5,
      width: totalW - 16,
      height: cellH + 3,
      rx: 5,
    });
    rowBgRects.push(rowBg);
    svg.appendChild(rowBg);

    // Row label (Pathology)
    const rowLabelG = svgEl('g', {
      class: 'svg-axis-btn',
      tabindex: '0',
      role: 'button',
      'aria-label': `Filter catalog by pathology ${path}`,
    });

    rowLabelG.appendChild(
      svgEl(
        'text',
        {
          x: marginLeft - 12,
          y: y + cellH / 2 + 4,
          'text-anchor': 'end',
          fill: isPathActive
            ? 'var(--accent-cyan-text)'
            : path === 'Multi-Pathology'
              ? 'var(--text-muted)'
              : 'var(--chart-label)',
          'font-size': '11.8',
          'font-weight': isPathActive ? '700' : '600',
          'font-style': path === 'Multi-Pathology' ? 'italic' : 'normal',
        },
        path
      )
    );

    const rowObj = matrix.rows[rowIdx];
    const rowSum =
      metric === 'all'
        ? rowObj.total
        : metric === 'openAccess'
          ? rowObj.openAccessDatasets
          : rowObj.datasets;

    wireInteractiveSvgNode(
      rowLabelG,
      () => `
        <div class="tooltip-title">${esc(path)}</div>
        <div class="tooltip-metrics">
          <span><strong>${rowObj.datasets}</strong> dataset intersections</span>
          <span><strong>${rowObj.openAccessDatasets}</strong> open-access</span>
        </div>
        <div class="tooltip-hint">Click row header to filter Catalog by ${esc(path)}</div>
      `,
      () => options.onAxisClick?.('pathology', path)
    );
    rowHeaderGroups.push(rowLabelG);
    svg.appendChild(rowLabelG);

    // Row cells
    modalities.forEach((mod, colIdx) => {
      const cell = matrix.byPathology[path][mod];
      const val = getCellValue(cell);
      const x = marginLeft + colIdx * (cellW + cellGap);
      const isGap = val === 0;
      const isSelected = isPathActive && activeMods.has(mod);

      if (path !== 'Multi-Pathology') {
        if (isGap) zeroDiseaseCells += 1;
        else nonZeroDiseaseCells += 1;
      }

      const color = getHeatmapColor(val, maxVal);
      const cellG = svgEl('g', {
        class: `svg-cell${isGap ? ' is-gap' : ''}${isSelected ? ' is-selected' : ''}`,
        tabindex: '0',
        role: 'button',
        'aria-label': `${mod} and ${path}: ${val} ${metric === 'all' ? 'records' : metric === 'openAccess' ? 'open-access datasets' : 'datasets'}${isGap ? ' (open-data gap)' : ''}`,
      });

      const rectAttrs = {
        class: 'cell-rect',
        x,
        y,
        width: cellW,
        height: cellH,
        rx: 5,
        fill: color.fill,
        stroke: isSelected
          ? 'var(--accent-cyan)'
          : isGap
            ? 'var(--heat-0-stroke)'
            : 'var(--heat-cell-stroke)',
        'stroke-width': isSelected ? '2.2' : '1',
      };
      if (isGap && !isSelected) {
        rectAttrs['stroke-dasharray'] = '3 2';
      }
      cellG.appendChild(svgEl('rect', rectAttrs));

      cellG.appendChild(
        svgEl(
          'text',
          {
            x: x + cellW / 2,
            y: y + cellH / 2 + 4.2,
            'text-anchor': 'middle',
            fill: color.text,
            'font-family': 'var(--font-mono)',
            'font-size': isGap ? '10.5' : '12',
            'font-weight': isGap ? '500' : '700',
          },
          String(val)
        )
      );

      const setCrosshair = (active) => {
        rowBgRects[rowIdx]?.classList.toggle('is-crosshair-row', active);
        rowHeaderGroups[rowIdx]?.classList.toggle('is-crosshair-axis', active);
        colHeaderGroups[colIdx]?.classList.toggle('is-crosshair-axis', active);
      };
      cellG.addEventListener('mouseenter', () => setCrosshair(true));
      cellG.addEventListener('mouseleave', () => setCrosshair(false));
      cellG.addEventListener('focus', () => setCrosshair(true));
      cellG.addEventListener('blur', () => setCrosshair(false));

      wireInteractiveSvgNode(
        cellG,
        () => buildHeatmapTooltipHtml(cell, val, metric, byId),
        () => options.onCellClick?.(mod, path, cell, val)
      );

      svg.appendChild(cellG);
    });

    // Right row total
    svg.appendChild(
      svgEl(
        'text',
        {
          x: marginLeft + gridW + 26,
          y: y + cellH / 2 + 4,
          'text-anchor': 'middle',
          fill: rowSum > 0 ? 'var(--text-secondary)' : 'var(--text-faint)',
          'font-family': 'var(--font-mono)',
          'font-size': '11.5',
          'font-weight': '700',
        },
        String(rowSum)
      )
    );
  });

  // Bottom Modality Column Sums Row
  const colSumY = marginTop + gridH + 17;
  svg.appendChild(
    svgEl(
      'text',
      {
        x: marginLeft - 12,
        y: colSumY,
        'text-anchor': 'end',
        fill: 'var(--chart-axis)',
        'font-size': '10.2',
        'font-weight': '700',
        'letter-spacing': '0.04em',
      },
      'DISEASE SUM'
    )
  );
  colTotals.forEach((cSum, colIdx) => {
    const cx = marginLeft + colIdx * (cellW + cellGap) + cellW / 2;
    svg.appendChild(
      svgEl(
        'text',
        {
          x: cx,
          y: colSumY,
          'text-anchor': 'middle',
          fill: cSum > 0 ? 'var(--text-secondary)' : 'var(--text-faint)',
          'font-family': 'var(--font-mono)',
          'font-size': '11',
          'font-weight': cSum > 0 ? '700' : '500',
        },
        String(cSum)
      )
    );
  });

  // Bottom Legend Bar (spans full SVG width to prevent text/swatch collision)
  const legendPadX = 14;
  const legendY = marginTop + gridH + 38;
  const legendSpanW = totalW - legendPadX * 2;
  const legendG = svgEl('g', { transform: `translate(${legendPadX}, ${legendY})` });

  // 0-gap swatch
  legendG.appendChild(
    svgEl('rect', {
      x: 0,
      y: 0,
      width: 22,
      height: 15,
      rx: 3,
      fill: 'var(--heat-0-fill)',
      stroke: 'var(--heat-0-stroke)',
      'stroke-dasharray': '3 2',
      'stroke-width': '1',
    })
  );
  legendG.appendChild(
    svgEl(
      'text',
      { x: 28, y: 11.5, fill: 'var(--accent-amber-text)', 'font-size': '11', 'font-weight': '600' },
      '0 = White-Space Open-Data Gap'
    )
  );

  // 5-step scale swatches
  const steps = [
    { step: 1, label: '1' },
    { step: 2, label: '2' },
    { step: 3, label: '3+' },
    { step: 4, label: 'High' },
    { step: 5, label: 'Peak' },
  ];
  let lx = 228;
  legendG.appendChild(
    svgEl('text', { x: lx, y: 11.5, fill: 'var(--chart-axis)', 'font-size': '11', 'font-weight': '600' }, 'Density:')
  );
  lx += 52;

  steps.forEach((s) => {
    legendG.appendChild(
      svgEl('rect', {
        x: lx,
        y: 0,
        width: 20,
        height: 15,
        rx: 3,
        fill: `var(--heat-${s.step})`,
        stroke: 'var(--heat-cell-stroke)',
        'stroke-width': '1',
      })
    );
    legendG.appendChild(
      svgEl(
        'text',
        { x: lx + 24, y: 11.5, fill: 'var(--chart-axis)', 'font-size': '10.5', 'font-family': 'var(--font-mono)' },
        s.label
      )
    );
    lx += 55;
  });

  // Summary coverage ratio on far right of legend
  const totalDiseaseCells = nonZeroDiseaseCells + zeroDiseaseCells;
  const pctCovered =
    totalDiseaseCells > 0 ? Math.round((nonZeroDiseaseCells / totalDiseaseCells) * 100) : 0;
  legendG.appendChild(
    svgEl(
      'text',
      {
        x: legendSpanW,
        y: 11.5,
        'text-anchor': 'end',
        fill: 'var(--text-muted)',
        'font-size': '11',
        'font-family': 'var(--font-mono)',
      },
      `${nonZeroDiseaseCells}/${totalDiseaseCells} populated (${pctCovered}%) · ${zeroDiseaseCells} gaps`
    )
  );

  svg.appendChild(legendG);
  container.appendChild(svg);
}

/**
 * Build rich tooltip HTML for a coverage heatmap cell including exact dataset names.
 */
function buildHeatmapTooltipHtml(cell, val, metric, byId) {
  const resolveName = (id) => {
    const rec = byId?.get(id);
    if (!rec) return id;
    return rec.shortName || rec.name || id;
  };

  let targetIds = cell.datasetIds || [];
  let listTitle = 'Cataloged Datasets';

  if (metric === 'openAccess' && byId) {
    targetIds = targetIds.filter((id) => byId.get(id)?.accessTier === 'Open Access');
    listTitle = 'Open-Access Datasets';
  } else if (metric === 'all') {
    targetIds = cell.recordIds || [];
    listTitle = 'Matching Resources';
  }

  const names = targetIds.slice(0, 7).map(resolveName);
  const extraCount = Math.max(0, targetIds.length - names.length);

  const listHtml =
    names.length > 0
      ? `<div style="margin-top:4px;font-weight:600;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;">${listTitle}</div>
         <ul class="tooltip-list">${names.map((n) => `<li>${esc(n)}</li>`).join('')}${extraCount > 0 ? `<li><em>+${extraCount} more</em></li>` : ''}</ul>`
      : '';

  const patientNote =
    cell.totalPatients > 0
      ? `<span><strong>${cell.totalPatients.toLocaleString()}</strong> patients</span>`
      : '';

  const hintHtml =
    val === 0
      ? `<div class="tooltip-hint tooltip-hint-amber">White-space open-data gap — click to inspect slice &amp; contribute via PR</div>`
      : `<div class="tooltip-hint">Click to jump to Catalog filtered to ${esc(cell.modality)} &times; ${esc(cell.pathology)}</div>`;

  return `
    <div class="tooltip-title">${esc(cell.modality)} &times; ${esc(cell.pathology)}</div>
    <div class="tooltip-metrics">
      <span><strong>${cell.datasets}</strong> datasets (${cell.openAccessDatasets} Open)</span>
      <span><strong>${cell.models}</strong> models</span>
      <span><strong>${cell.challenges}</strong> challenges</span>
      ${patientNote}
    </div>
    ${listHtml}
    ${hintHtml}
  `;
}

/**
 * 2. Cohort Size Horizontal Bar Chart + Distribution Bucket Strip (Pure SVG)
 *
 * @param {HTMLElement} container
 * @param {object} analytics
 * @param {object} activeFilters
 * @param {{ scale?: 'log' | 'linear', onDatasetClick?: (id: string) => void }} [options={}]
 */
export function renderCohortSizeChart(container, analytics, activeFilters = {}, options = {}) {
  void activeFilters;
  if (!container) return;
  container.innerHTML = '';

  const bars = Array.isArray(analytics?.cohortBars) ? analytics.cohortBars.slice(0, 10) : [];
  if (bars.length === 0) {
    container.innerHTML = '<p class="viz-subtitle">No numeric patient cohorts available.</p>';
    return;
  }

  const scale = options.scale === 'linear' ? 'linear' : 'log';
  const maxCohort = Math.max(...bars.map((b) => b.cohortSize), 10);

  const marginLeft = 148;
  const marginRight = 72;
  const marginTop = 18;
  const marginBottom = 34;
  const rowH = 27;
  const barH = 16;
  const plotW = 340;
  const totalW = marginLeft + plotW + marginRight;
  const plotH = bars.length * rowH;
  const totalH = marginTop + plotH + marginBottom;

  const xScale = (val) => {
    if (scale === 'log') {
      const denom = Math.log10(maxCohort + 1);
      return denom > 0 ? (Math.log10(val + 1) / denom) * plotW : 0;
    }
    return (val / maxCohort) * plotW;
  };

  const ticks =
    scale === 'log'
      ? [10, 50, 200, 1000, 5000, 20000].filter((t) => t <= maxCohort * 1.15)
      : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxCohort * f));

  const svg = svgEl('svg', {
    viewBox: `0 0 ${totalW} ${totalH}`,
    role: 'img',
    'aria-label': `Top ${bars.length} datasets ranked by patient cohort size (${scale} scale)`,
  });

  // Gridlines & axis ticks
  ticks.forEach((t) => {
    const x = marginLeft + xScale(t);
    svg.appendChild(
      svgEl('line', {
        x1: x,
        x2: x,
        y1: marginTop - 4,
        y2: marginTop + plotH + 4,
        stroke: 'var(--chart-grid)',
        'stroke-width': '1',
        'stroke-dasharray': t === 0 ? 'none' : '2 3',
      })
    );
    svg.appendChild(
      svgEl(
        'text',
        {
          x,
          y: marginTop + plotH + 20,
          'text-anchor': 'middle',
          fill: 'var(--chart-axis)',
          'font-family': 'var(--font-mono)',
          'font-size': '10',
        },
        formatCompact(t)
      )
    );
  });

  // Scale caption
  svg.appendChild(
    svgEl(
      'text',
      {
        x: marginLeft + plotW,
        y: marginTop + plotH + 31,
        'text-anchor': 'end',
        fill: 'var(--text-faint)',
        'font-size': '9.5',
      },
      scale === 'log' ? 'Patients (log10 scale)' : 'Patients (linear scale)'
    )
  );

  // Horizontal bars
  bars.forEach((entry, idx) => {
    const y = marginTop + idx * rowH;
    const w = Math.max(4, xScale(entry.cohortSize));
    const fill = tierColorVar(entry.accessTier);

    const g = svgEl('g', {
      class: 'svg-bar-row',
      tabindex: '0',
      role: 'button',
      'aria-label': `${entry.shortName}: ${entry.cohortSize.toLocaleString()} patients, ${entry.accessTier}`,
    });

    // Hover background row
    g.appendChild(
      svgEl('rect', {
        class: 'bar-bg',
        x: 4,
        y: y + 1,
        width: totalW - 8,
        height: rowH - 2,
        rx: 4,
        fill: 'transparent',
      })
    );

    // Dataset shortName label
    g.appendChild(
      svgEl(
        'text',
        {
          x: marginLeft - 10,
          y: y + rowH / 2 + 3.8,
          'text-anchor': 'end',
          fill: 'var(--chart-label)',
          'font-size': '11.2',
          'font-weight': '600',
        },
        truncate(entry.shortName, 20)
      )
    );

    // Track
    g.appendChild(
      svgEl('rect', {
        x: marginLeft,
        y: y + (rowH - barH) / 2,
        width: plotW,
        height: barH,
        rx: 4,
        fill: 'var(--bg-elevated)',
      })
    );

    // Filled bar
    g.appendChild(
      svgEl('rect', {
        class: 'bar-fill',
        x: marginLeft,
        y: y + (rowH - barH) / 2,
        width: w,
        height: barH,
        rx: 4,
        fill,
      })
    );

    // Numeric label
    g.appendChild(
      svgEl(
        'text',
        {
          x: marginLeft + w + 7,
          y: y + rowH / 2 + 3.8,
          'text-anchor': 'start',
          fill: 'var(--text-primary)',
          'font-family': 'var(--font-mono)',
          'font-size': '10.8',
          'font-weight': '700',
        },
        entry.cohortSize.toLocaleString()
      )
    );

    wireInteractiveSvgNode(
      g,
      () => `
        <div class="tooltip-title">${esc(entry.name)}</div>
        <div class="tooltip-metrics">
          <span><strong>${esc(entry.cohortDisplay)}</strong></span>
          <span>${esc(entry.accessTier)}</span>
          ${entry.platform ? `<span>${esc(entry.platform)}</span>` : ''}
        </div>
        <div style="color:var(--text-muted);font-size:0.75rem;">${esc((entry.pathologies || []).join(', '))}</div>
        <div class="tooltip-hint">Click bar to open dataset details &amp; fetch snippet</div>
      `,
      () => options.onDatasetClick?.(entry.id)
    );

    svg.appendChild(g);
  });

  container.appendChild(svg);

  // Cohort Size Distribution Buckets Strip
  if (Array.isArray(analytics?.cohortBuckets) && analytics.cohortBuckets.length > 0) {
    const strip = document.createElement('div');
    strip.className = 'bucket-strip';
    strip.setAttribute('aria-label', 'Dataset count by cohort size bucket');
    strip.innerHTML = analytics.cohortBuckets
      .map(
        (b) => `
        <div class="bucket-pill">
          <span class="bucket-label">${esc(b.label)}</span>
          <span class="bucket-count mono">${b.count} <span style="font-weight:400;font-size:0.72rem;color:var(--text-muted);">ds</span></span>
        </div>
      `
      )
      .join('');
    container.appendChild(strip);
  }
}

/**
 * 3. Access Tier Breakdown Donut + Horizontal Bars Chart (Pure SVG)
 *
 * @param {HTMLElement} container
 * @param {object} analytics
 * @param {object} activeFilters
 * @param {{ onTierClick?: (tier: string) => void }} [options={}]
 */
export function renderAccessTierChart(container, analytics, activeFilters = {}, options = {}) {
  if (!container) return;
  container.innerHTML = '';

  const breakdown = Array.isArray(analytics?.accessBreakdown) ? analytics.accessBreakdown : [];
  const totalDatasets = analytics?.kpis?.totalDatasets || 0;
  if (breakdown.length === 0 || totalDatasets === 0) {
    container.innerHTML = '<p class="viz-subtitle">No access-tier breakdown available.</p>';
    return;
  }

  const activeTiers = new Set(activeFilters?.accessTiers || []);
  const W = 560;
  const H = 264;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': 'Access tier distribution donut chart and dataset share breakdown',
  });

  // Left: Donut Chart
  const cx = 112;
  const cy = 132;
  const r = 74;
  const strokeW = 24;
  const circumference = 2 * Math.PI * r;

  // Base donut track
  svg.appendChild(
    svgEl('circle', {
      cx,
      cy,
      r,
      fill: 'none',
      stroke: 'var(--bg-elevated)',
      'stroke-width': strokeW,
    })
  );

  let offset = 0;
  breakdown.forEach((item) => {
    if (item.count <= 0) return;
    const fraction = item.count / totalDatasets;
    const segLen = Math.max(2, fraction * circumference - 2.5);
    const color = tierColorVar(item.tier);
    const isActive = activeTiers.has(item.tier);

    const segG = svgEl('g', {
      class: 'svg-tier-item',
      tabindex: '0',
      role: 'button',
      'aria-label': `${item.tier}: ${item.count} datasets (${item.sharePct}%)`,
    });

    segG.appendChild(
      svgEl('circle', {
        cx,
        cy,
        r,
        fill: 'none',
        stroke: color,
        'stroke-width': isActive ? strokeW + 4 : strokeW,
        'stroke-dasharray': `${segLen} ${circumference}`,
        'stroke-dashoffset': -offset,
        transform: `rotate(-90 ${cx} ${cy})`,
      })
    );

    wireInteractiveSvgNode(
      segG,
      () => `
        <div class="tooltip-title">${esc(item.tier)}</div>
        <div class="tooltip-metrics">
          <span><strong>${item.count}</strong> datasets (${item.sharePct}%)</span>
          <span><strong>${item.totalPatients.toLocaleString()}</strong> patients</span>
        </div>
        <div class="tooltip-hint">Click to filter Catalog to ${esc(item.tier)}</div>
      `,
      () => options.onTierClick?.(item.tier)
    );

    svg.appendChild(segG);
    offset += fraction * circumference;
  });

  // Center Donut Metric
  const openPct = analytics?.kpis?.openAccessPct ?? 0;
  svg.appendChild(
    svgEl(
      'text',
      {
        x: cx,
        y: cy - 3,
        'text-anchor': 'middle',
        fill: 'var(--text-primary)',
        'font-family': 'var(--font-mono)',
        'font-size': '23',
        'font-weight': '700',
      },
      `${Math.round(openPct)}%`
    )
  );
  svg.appendChild(
    svgEl(
      'text',
      {
        x: cx,
        y: cy + 16,
        'text-anchor': 'middle',
        fill: 'var(--accent-emerald-text)',
        'font-size': '10.5',
        'font-weight': '700',
        'letter-spacing': '0.03em',
      },
      'OPEN ACCESS'
    )
  );
  svg.appendChild(
    svgEl(
      'text',
      {
        x: cx,
        y: cy + 32,
        'text-anchor': 'middle',
        fill: 'var(--text-muted)',
        'font-family': 'var(--font-mono)',
        'font-size': '10',
      },
      `${totalDatasets} datasets`
    )
  );

  // Right: Horizontal Tier Breakdown Bars
  const rx = 230;
  const barMaxW = 308;
  const blockH = 70;
  const startY = 30;

  breakdown.forEach((item, idx) => {
    const y = startY + idx * blockH;
    const color = tierColorVar(item.tier);
    const barW = totalDatasets > 0 ? Math.max(4, (item.count / totalDatasets) * barMaxW) : 0;
    const isActive = activeTiers.has(item.tier);

    const rowG = svgEl('g', {
      class: 'svg-tier-item',
      tabindex: '0',
      role: 'button',
      'aria-label': `Filter by ${item.tier}: ${item.count} datasets`,
    });

    // Subtle card backing
    rowG.appendChild(
      svgEl('rect', {
        x: rx - 10,
        y: y - 8,
        width: barMaxW + 24,
        height: 58,
        rx: 8,
        fill: isActive ? 'var(--accent-cyan-soft)' : 'var(--bg-surface-2)',
        stroke: isActive ? 'var(--accent-cyan-border)' : 'var(--border-subtle)',
        'stroke-width': '1',
      })
    );

    // Color dot + tier title
    rowG.appendChild(svgEl('circle', { cx: rx + 4, cy: y + 8, r: 4.5, fill: color }));
    rowG.appendChild(
      svgEl(
        'text',
        {
          x: rx + 15,
          y: y + 12,
          fill: 'var(--text-primary)',
          'font-size': '12',
          'font-weight': '700',
        },
        item.tier
      )
    );

    // Right stat label
    rowG.appendChild(
      svgEl(
        'text',
        {
          x: rx + barMaxW,
          y: y + 12,
          'text-anchor': 'end',
          fill: 'var(--text-secondary)',
          'font-family': 'var(--font-mono)',
          'font-size': '11.2',
          'font-weight': '700',
        },
        `${item.count} (${item.sharePct}%)`
      )
    );

    // Progress bar track + fill
    rowG.appendChild(
      svgEl('rect', {
        x: rx,
        y: y + 22,
        width: barMaxW,
        height: 9,
        rx: 4.5,
        fill: 'var(--bg-elevated)',
      })
    );
    if (item.count > 0) {
      rowG.appendChild(
        svgEl('rect', {
          x: rx,
          y: y + 22,
          width: barW,
          height: 9,
          rx: 4.5,
          fill: color,
        })
      );
    }

    // Patient volume sub-label
    rowG.appendChild(
      svgEl(
        'text',
        {
          x: rx,
          y: y + 44,
          fill: 'var(--text-muted)',
          'font-family': 'var(--font-mono)',
          'font-size': '10.2',
        },
        `${item.totalPatients.toLocaleString()} documented patients`
      )
    );

    wireInteractiveSvgNode(
      rowG,
      () => `
        <div class="tooltip-title">${esc(item.tier)}</div>
        <div class="tooltip-metrics">
          <span><strong>${item.count}</strong> of ${totalDatasets} datasets (${item.sharePct}%)</span>
          <span><strong>${item.totalPatients.toLocaleString()}</strong> cumulative patients</span>
        </div>
        <div class="tooltip-hint">Click to filter Catalog by ${esc(item.tier)}</div>
      `,
      () => options.onTierClick?.(item.tier)
    );

    svg.appendChild(rowG);
  });

  container.appendChild(svg);
}

/**
 * Compatibility wrapper matching ARCHITECTURE.md Section 5.3 signature.
 */
export function renderAccessCohortChart(container, analytics, activeFilters = {}, options = {}) {
  if (options?.mode === 'cohorts') {
    return renderCohortSizeChart(container, analytics, activeFilters, options);
  }
  return renderAccessTierChart(container, analytics, activeFilters, options);
}

/**
 * 4. Open-Science Release Timeline (Stacked Yearly Bars + Cumulative Curve, Pure SVG)
 *
 * @param {HTMLElement} container
 * @param {object} analytics
 * @param {object} activeFilters
 * @param {{ onYearClick?: (year: number) => void }} [options={}]
 */
export function renderReleaseTimeline(container, analytics, activeFilters = {}, options = {}) {
  if (!container) return;
  container.innerHTML = '';

  const series = Array.isArray(analytics?.timeline) ? analytics.timeline : [];
  if (series.length === 0) {
    container.innerHTML = '<p class="viz-subtitle">Timeline data unavailable.</p>';
    return;
  }

  const activeYear = activeFilters?.year ? Number(activeFilters.year) : null;

  const W = 980;
  const H = 268;
  const marginLeft = 46;
  const marginRight = 56;
  const marginTop = 34;
  const marginBottom = 42;
  const plotW = W - marginLeft - marginRight;
  const plotH = H - marginTop - marginBottom;

  const maxYearly = Math.max(...series.map((d) => d.total), 4);
  const maxCum = Math.max(...series.map((d) => d.cumulativeAll), 10);

  const yLeft = (v) => marginTop + plotH - (v / maxYearly) * plotH;
  const yRight = (v) => marginTop + plotH - (v / maxCum) * plotH;

  const colSlot = plotW / series.length;
  const barW = Math.max(10, Math.min(34, colSlot * 0.6));

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Annual releases and cumulative growth from ${series[0].year} to ${series[series.length - 1].year}`,
  });

  // Top Legend
  const legendItems = [
    { label: 'Datasets', color: 'var(--accent-emerald)', kind: 'rect' },
    { label: 'Models & Toolkits', color: 'var(--accent-cyan)', kind: 'rect' },
    { label: 'Challenges', color: 'var(--accent-amber)', kind: 'rect' },
    { label: 'Cumulative Total (right axis)', color: 'var(--text-primary)', kind: 'line' },
  ];
  let lx = marginLeft;
  legendItems.forEach((li) => {
    if (li.kind === 'rect') {
      svg.appendChild(svgEl('rect', { x: lx, y: 8, width: 12, height: 10, rx: 2, fill: li.color }));
    } else {
      svg.appendChild(
        svgEl('line', { x1: lx, x2: lx + 16, y1: 13, y2: 13, stroke: li.color, 'stroke-width': 2.2 })
      );
      svg.appendChild(svgEl('circle', { cx: lx + 8, cy: 13, r: 3, fill: li.color }));
    }
    svg.appendChild(
      svgEl(
        'text',
        { x: lx + (li.kind === 'line' ? 22 : 17), y: 17, fill: 'var(--chart-label)', 'font-size': '11' },
        li.label
      )
    );
    lx += li.label.length * 6.5 + 38;
  });

  // Horizontal gridlines + Left & Right Y ticks
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i += 1) {
    const frac = i / yTicks;
    const y = marginTop + plotH - frac * plotH;
    svg.appendChild(
      svgEl('line', {
        x1: marginLeft,
        x2: marginLeft + plotW,
        y1: y,
        y2: y,
        stroke: 'var(--chart-grid)',
        'stroke-width': '1',
        'stroke-dasharray': i === 0 ? 'none' : '2 3',
      })
    );
    svg.appendChild(
      svgEl(
        'text',
        {
          x: marginLeft - 8,
          y: y + 3.5,
          'text-anchor': 'end',
          fill: 'var(--chart-axis)',
          'font-family': 'var(--font-mono)',
          'font-size': '10.2',
        },
        String(Math.round(maxYearly * frac))
      )
    );
    svg.appendChild(
      svgEl(
        'text',
        {
          x: marginLeft + plotW + 8,
          y: y + 3.5,
          'text-anchor': 'start',
          fill: 'var(--chart-axis)',
          'font-family': 'var(--font-mono)',
          'font-size': '10.2',
        },
        String(Math.round(maxCum * frac))
      )
    );
  }

  // Axis captions
  svg.appendChild(
    svgEl(
      'text',
      { x: 10, y: marginTop - 8, fill: 'var(--text-faint)', 'font-size': '9.5', 'font-weight': '600' },
      'Yearly'
    )
  );
  svg.appendChild(
    svgEl(
      'text',
      {
        x: W - 8,
        y: marginTop - 8,
        'text-anchor': 'end',
        fill: 'var(--text-faint)',
        'font-size': '9.5',
        'font-weight': '600',
      },
      'Cumulative'
    )
  );

  // Stacked bars per year
  const linePoints = [];
  const labelStride = series.length > 14 ? 2 : 1;

  series.forEach((pt, idx) => {
    const cx = marginLeft + idx * colSlot + colSlot / 2;
    const xBar = cx - barW / 2;
    const isSelected = activeYear === pt.year;

    const colG = svgEl('g', {
      class: 'svg-year-col',
      tabindex: '0',
      role: 'button',
      'aria-label': `Year ${pt.year}: ${pt.datasets} datasets, ${pt.models} models, ${pt.challenges} challenges. Cumulative total: ${pt.cumulativeAll}.`,
    });

    // Hover highlight track
    colG.appendChild(
      svgEl('rect', {
        class: 'year-hover-band',
        x: marginLeft + idx * colSlot + 2,
        y: marginTop,
        width: Math.max(4, colSlot - 4),
        height: plotH,
        rx: 4,
        fill: 'var(--accent-cyan-soft)',
        opacity: isSelected ? '0.9' : undefined,
      })
    );

    if (isSelected) {
      colG.appendChild(
        svgEl('rect', {
          x: marginLeft + idx * colSlot + 2,
          y: marginTop,
          width: Math.max(4, colSlot - 4),
          height: plotH,
          rx: 4,
          fill: 'var(--accent-cyan-soft)',
          stroke: 'var(--accent-cyan-border)',
          'stroke-width': '1',
        })
      );
    }

    // Stacked segments: Datasets -> Models -> Challenges
    let stackBase = 0;
    const segments = [
      { count: pt.datasets, fill: 'var(--accent-emerald)' },
      { count: pt.models, fill: 'var(--accent-cyan)' },
      { count: pt.challenges, fill: 'var(--accent-amber)' },
    ];
    segments.forEach((seg) => {
      if (seg.count <= 0) return;
      const yTop = yLeft(stackBase + seg.count);
      const yBot = yLeft(stackBase);
      const h = Math.max(2, yBot - yTop);
      colG.appendChild(
        svgEl('rect', {
          x: xBar,
          y: yTop,
          width: barW,
          height: h,
          rx: 2,
          fill: seg.fill,
        })
      );
      stackBase += seg.count;
    });

    // Year X-axis tick label
    if (idx % labelStride === 0 || idx === series.length - 1 || isSelected) {
      colG.appendChild(
        svgEl(
          'text',
          {
            x: cx,
            y: marginTop + plotH + 18,
            'text-anchor': 'middle',
            fill: isSelected ? 'var(--accent-cyan-text)' : 'var(--chart-axis)',
            'font-family': 'var(--font-mono)',
            'font-size': '10.5',
            'font-weight': isSelected ? '700' : '500',
          },
          String(pt.year)
        )
      );
    }

    const py = yRight(pt.cumulativeAll);
    linePoints.push({ x: cx, y: py, pt });

    wireInteractiveSvgNode(
      colG,
      () => `
        <div class="tooltip-title">Release Year ${pt.year}</div>
        <div class="tooltip-metrics">
          <span><strong>${pt.datasets}</strong> datasets (${pt.openAccessDatasets} Open)</span>
          <span><strong>${pt.models}</strong> models</span>
          <span><strong>${pt.challenges}</strong> challenges</span>
        </div>
        <div style="color:var(--text-secondary);font-size:0.77rem;">
          Yearly total: <strong>${pt.total}</strong> &middot; Cumulative registry: <strong>${pt.cumulativeAll}</strong>
        </div>
        <div class="tooltip-hint">Click year column to filter Catalog to ${pt.year}</div>
      `,
      () => options.onYearClick?.(pt.year)
    );

    svg.appendChild(colG);
  });

  // Cumulative smooth polyline overlay
  if (linePoints.length > 1) {
    const pathD = linePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    svg.appendChild(
      svgEl('path', {
        d: pathD,
        fill: 'none',
        stroke: 'var(--text-primary)',
        'stroke-width': '2',
        'stroke-opacity': '0.85',
        'pointer-events': 'none',
      })
    );
    linePoints.forEach((p) => {
      svg.appendChild(
        svgEl('circle', {
          cx: p.x,
          cy: p.y,
          r: 3.2,
          fill: 'var(--bg-surface)',
          stroke: 'var(--text-primary)',
          'stroke-width': '2',
          'pointer-events': 'none',
        })
      );
    });
  }

  container.appendChild(svg);
}

/**
 * 5. Auto-Computed Open-Data Gap Callouts Grid
 *
 * @param {HTMLElement} container
 * @param {Array<object>} dataGaps
 * @param {{
 *   onInspectGap?: (gap: object) => void,
 *   onProposeGap?: (gap: object) => void
 * }} [options={}]
 */
export function renderGapCallouts(container, dataGaps = [], options = {}) {
  if (!container) return;
  container.innerHTML = '';

  if (!Array.isArray(dataGaps) || dataGaps.length === 0) {
    container.innerHTML = '<p class="viz-subtitle">No critical open-science coverage gaps detected.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  dataGaps.forEach((gap) => {
    const card = document.createElement('article');
    const sevClass =
      gap.severity === 'critical'
        ? 'severity-critical'
        : gap.severity === 'high'
          ? 'severity-high'
          : 'severity-medium';
    card.className = `gap-card ${sevClass}`;

    card.innerHTML = `
      <div class="gap-card-top">
        <span class="gap-cat-pill">${esc(gap.category)}</span>
        <span class="gap-metric-pill mono">${esc(gap.metricLabel || '')}</span>
      </div>
      <h4 class="gap-card-title">${esc(gap.title)}</h4>
      <p class="gap-card-desc">${esc(gap.description)}</p>
      <div class="gap-card-actions">
        <button type="button" class="btn btn-secondary btn-xs" data-gap-action="inspect">Inspect in Catalog</button>
        <button type="button" class="btn btn-primary btn-xs" data-gap-action="propose">Contribute via PR</button>
      </div>
    `;

    card.querySelector('[data-gap-action="inspect"]')?.addEventListener('click', () => {
      options.onInspectGap?.(gap);
    });
    card.querySelector('[data-gap-action="propose"]')?.addEventListener('click', () => {
      options.onProposeGap?.(gap);
    });

    fragment.appendChild(card);
  });

  container.appendChild(fragment);
}
