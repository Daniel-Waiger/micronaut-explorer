import { buildSpectralViewModel } from '../engine/spectralView.js';

const spectralViewSvgNs = 'http://www.w3.org/2000/svg';
const spectralViewWidth = 720;
const spectralViewHeight = 316;
const spectralViewPlot = { left: 58, right: 18, top: 64, bottom: 50 };
const spectralViewSeriesCount = 8;

function spectralViewElement(name, className, text) {
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function spectralViewSvgElement(name, attributes, className, text) {
  const element = document.createElementNS(spectralViewSvgNs, name);
  if (className) element.setAttribute('class', className);
  for (const [key, value] of Object.entries(attributes || {})) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function spectralViewScale(value, domainMin, domainMax, rangeMin, rangeMax) {
  return rangeMin + ((value - domainMin) / (domainMax - domainMin)) * (rangeMax - rangeMin);
}

function spectralViewPath(curve, model) {
  const plotWidth = spectralViewWidth - spectralViewPlot.left - spectralViewPlot.right;
  const plotHeight = spectralViewHeight - spectralViewPlot.top - spectralViewPlot.bottom;
  return curve.points
    .map((point, index) => {
      const x = spectralViewScale(
        point.wavelengthNm,
        model.domain.minNm,
        model.domain.maxNm,
        spectralViewPlot.left,
        spectralViewPlot.left + plotWidth
      );
      const y = spectralViewPlot.top + (1 - point.intensity) * plotHeight;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function spectralViewSeriesClass(index) {
  return `spectral-view-series-${index % spectralViewSeriesCount}`;
}

function spectralViewFilterSeriesIndex(filter, model, fallbackIndex) {
  const matched = model.curves.findIndex(
    (curve) =>
      (filter.channelId && curve.channelId === filter.channelId) ||
      (!filter.channelId && filter.token && curve.token === filter.token)
  );
  return matched >= 0 ? matched : fallbackIndex;
}

function spectralViewItemKey(kind, item, index) {
  if (item.channelId) return `${kind}:channel:${item.channelId}`;
  const identity = item.canonical || item.token || `item-${index}`;
  const value = kind === 'curve' ? item.emissionPeakNm : `${item.centerNm}/${item.bandwidthNm}`;
  return `${kind}:${identity}:${value}`;
}

/** Create interaction state that survives renderer refreshes in one Color-panel visit. */
export function spectralViewCreateState() {
  return { hiddenCurves: new Set(), hiddenFilters: new Set() };
}

function spectralViewStateSet(state, kind) {
  const key = kind === 'curve' ? 'hiddenCurves' : 'hiddenFilters';
  if (!state || !(state[key] instanceof Set)) return null;
  return state[key];
}

function spectralViewCurveRecords(model) {
  return model.curves.map((curve, index) => ({
    kind: 'curve',
    key: spectralViewItemKey('curve', curve, index),
    item: curve,
    seriesIndex: index,
    name: curve.token,
    summary: `Emission peak ${curve.emissionPeakNm} nm · schematic width ${curve.fwhmNm} nm.`,
  }));
}

function spectralViewFilterRecords(model) {
  return model.filters.map((filter, index) => {
    const token = filter.token.trim() || 'Unresolved channel';
    const clipped = filter.clipped ? ' · band clipped to the plotted range' : '';
    return {
      kind: 'filter',
      key: spectralViewItemKey('filter', filter, index),
      item: filter,
      seriesIndex: spectralViewFilterSeriesIndex(filter, model, index),
      name: `${token} filter`,
      summary:
        `${filter.centerNm}/${filter.bandwidthNm} nm center/bandwidth · ` +
        `${filter.startNm}–${filter.endNm} nm passband${clipped}.`,
    };
  });
}

function spectralViewAppendAxis(svg, model) {
  const plotBottom = spectralViewHeight - spectralViewPlot.bottom;
  const plotRight = spectralViewWidth - spectralViewPlot.right;
  svg.append(
    spectralViewSvgElement(
      'line',
      { x1: spectralViewPlot.left, y1: plotBottom, x2: plotRight, y2: plotBottom },
      'spectral-view-axis'
    )
  );
  for (let wavelength = 300; wavelength <= 900; wavelength += 100) {
    const x = spectralViewScale(
      wavelength,
      model.domain.minNm,
      model.domain.maxNm,
      spectralViewPlot.left,
      plotRight
    );
    svg.append(
      spectralViewSvgElement(
        'line',
        { x1: x, y1: spectralViewPlot.top, x2: x, y2: plotBottom },
        'spectral-view-grid'
      ),
      spectralViewSvgElement(
        'line',
        { x1: x, y1: plotBottom, x2: x, y2: plotBottom + 5 },
        'spectral-view-axis'
      ),
      spectralViewSvgElement(
        'text',
        { x, y: plotBottom + 20, 'text-anchor': 'middle' },
        'spectral-view-tick',
        `${wavelength}`
      )
    );
  }
  svg.append(
    spectralViewSvgElement(
      'text',
      { x: spectralViewWidth / 2, y: spectralViewHeight - 8, 'text-anchor': 'middle' },
      'spectral-view-axis-label',
      'Emission wavelength (nm)'
    )
  );
}

function spectralViewAppendFilters(svg, model, records) {
  const plotRight = spectralViewWidth - spectralViewPlot.right;
  const plotBottom = spectralViewHeight - spectralViewPlot.bottom;
  const labelLaneRightEdges = [];
  for (const record of records) {
    const filter = record.item;
    const x = spectralViewScale(
      filter.startNm,
      model.domain.minNm,
      model.domain.maxNm,
      spectralViewPlot.left,
      plotRight
    );
    const endX = spectralViewScale(
      filter.endNm,
      model.domain.minNm,
      model.domain.maxNm,
      spectralViewPlot.left,
      plotRight
    );
    const centerX = (x + endX) / 2;
    const labelText = `${filter.centerNm}/${filter.bandwidthNm} nm`;
    const labelHalfWidth = Math.max(24, labelText.length * 3.2);
    const labelX = Math.min(
      Math.max(centerX, spectralViewPlot.left + labelHalfWidth),
      plotRight - labelHalfWidth
    );
    const labelLeft = labelX - labelHalfWidth;
    const labelRight = labelX + labelHalfWidth;
    let labelLane = labelLaneRightEdges.findIndex((rightEdge) => labelLeft > rightEdge + 6);
    if (labelLane < 0) labelLane = labelLaneRightEdges.length;
    labelLaneRightEdges[labelLane] = labelRight;
    const group = spectralViewSvgElement(
      'g',
      {
        tabindex: 0,
        role: 'button',
        'aria-label': `${record.name}, ${record.summary} Press Enter or Space to toggle.`,
        'aria-pressed': 'true',
        'data-spectral-key': record.key,
      },
      `spectral-view-data spectral-view-filter-group ${spectralViewSeriesClass(record.seriesIndex)}`
    );
    group.append(
      spectralViewSvgElement('title', {}, '', `${record.name}: ${record.summary}`),
      spectralViewSvgElement(
        'rect',
        { x, y: spectralViewPlot.top, width: Math.max(0, endX - x), height: plotBottom - spectralViewPlot.top },
        'spectral-view-filter'
      ),
      spectralViewSvgElement(
        'text',
        { x: labelX, y: spectralViewPlot.top + 17 + labelLane * 16, 'text-anchor': 'middle' },
        'spectral-view-filter-label',
        labelText
      )
    );
    record.group = group;
    svg.append(group);
  }
}

function spectralViewAppendCurves(svg, model, records) {
  const plotBottom = spectralViewHeight - spectralViewPlot.bottom;
  const plotRight = spectralViewWidth - spectralViewPlot.right;
  for (const [index, record] of records.entries()) {
    const curve = record.item;
    const seriesClass = spectralViewSeriesClass(record.seriesIndex);
    const peakX = spectralViewScale(
      curve.emissionPeakNm,
      model.domain.minNm,
      model.domain.maxNm,
      spectralViewPlot.left,
      plotRight
    );
    const group = spectralViewSvgElement(
      'g',
      {
        tabindex: 0,
        role: 'button',
        'aria-label': `${record.name}, ${record.summary} Press Enter or Space to toggle.`,
        'aria-pressed': 'true',
        'data-spectral-key': record.key,
      },
      `spectral-view-data spectral-view-curve-group ${seriesClass}`
    );
    const label = spectralViewSvgElement(
      'text',
      { x: peakX, y: 18 + (index % 3) * 15, 'text-anchor': 'middle' },
      'spectral-view-peak-label'
    );
    label.append(
      spectralViewSvgElement('tspan', { x: peakX }, 'spectral-view-peak-name', curve.token),
      spectralViewSvgElement(
        'tspan',
        { x: peakX, dy: 12 },
        'spectral-view-peak-value',
        `${curve.emissionPeakNm} nm`
      )
    );
    group.append(
      spectralViewSvgElement('title', {}, '', `${record.name}: ${record.summary}`),
      spectralViewSvgElement('path', { d: spectralViewPath(curve, model) }, 'spectral-view-curve'),
      spectralViewSvgElement(
        'line',
        { x1: peakX, y1: spectralViewPlot.top, x2: peakX, y2: plotBottom },
        'spectral-view-peak'
      ),
      label
    );
    record.group = group;
    svg.append(group);
  }
}

function spectralViewAppendLegend(wrapper, records) {
  const legend = spectralViewElement('ul', 'spectral-view-legend');
  legend.setAttribute('aria-label', 'Spectrum visibility controls');
  for (const record of records) {
    const item = spectralViewElement('li', 'spectral-view-legend-item');
    const button = spectralViewElement('button', 'spectral-view-legend-button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('data-spectral-key', record.key);
    const sampleClass =
      record.kind === 'curve' ? 'spectral-view-legend-sample' : 'spectral-view-filter-sample';
    const sample = spectralViewElement(
      'span',
      `${sampleClass} ${spectralViewSeriesClass(record.seriesIndex)}`
    );
    sample.setAttribute('aria-hidden', 'true');
    const label =
      record.kind === 'curve'
        ? `${record.name} · ${record.item.emissionPeakNm} nm peak`
        : `${record.name} · ${record.item.centerNm}/${record.item.bandwidthNm} nm`;
    const state = spectralViewElement('span', 'spectral-view-legend-state', 'On');
    button.append(sample, spectralViewElement('span', 'spectral-view-legend-text', label), state);
    item.append(button);
    legend.append(item);
    record.button = button;
    record.stateLabel = state;
  }
  wrapper.append(legend);
}

function spectralViewWireInteractions(chart, records, details, tooltip, state) {
  const defaultName = 'Explore the spectrum';
  const defaultSummary = 'Hover, focus, or select a curve or filter. Click it to turn that element on or off.';
  const detailsName = details.querySelector('.spectral-view-details-name');
  const detailsSummary = details.querySelector('.spectral-view-details-summary');
  const tooltipName = tooltip.querySelector('.spectral-view-tooltip-name');
  const tooltipSummary = tooltip.querySelector('.spectral-view-tooltip-summary');
  let hoveredRecord = null;
  let focusedRecord = null;

  function setDetails(record) {
    detailsName.textContent = record ? record.name : defaultName;
    detailsSummary.textContent = record
      ? `${record.summary} ${spectralViewRecordIsHidden(record, state) ? 'Currently off.' : 'Currently on.'}`
      : defaultSummary;
  }

  function refreshActive() {
    const activeRecord = hoveredRecord || focusedRecord;
    for (const other of records) {
      const active = other === activeRecord;
      other.group.classList.toggle('spectral-view-active', active);
      other.button.classList.toggle('spectral-view-active', active);
      const muted = Boolean(activeRecord) && !active && !spectralViewRecordIsHidden(other, state);
      other.group.classList.toggle('spectral-view-muted', muted);
      other.button.classList.toggle('spectral-view-muted', muted);
    }
    setDetails(activeRecord);
  }

  function setHovered(record) {
    hoveredRecord = record;
    refreshActive();
  }

  function setFocused(record) {
    focusedRecord = record;
    refreshActive();
  }

  function showTooltip(record, event) {
    tooltipName.textContent = record.name;
    tooltipSummary.textContent = record.summary;
    tooltip.hidden = false;
    moveTooltip(event);
  }

  function moveTooltip(event) {
    if (tooltip.hidden || typeof event.clientX !== 'number') return;
    const bounds = chart.getBoundingClientRect();
    const left = Math.min(Math.max(event.clientX - bounds.left + 12, 8), Math.max(8, bounds.width - 250));
    const top = Math.min(Math.max(event.clientY - bounds.top + 12, 8), Math.max(8, bounds.height - 74));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function updateVisibility(record) {
    const hidden = spectralViewRecordIsHidden(record, state);
    record.group.classList.toggle('spectral-view-off', hidden);
    record.button.classList.toggle('spectral-view-off', hidden);
    record.group.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    record.button.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    record.stateLabel.textContent = hidden ? 'Off' : 'On';
    record.button.title = `${hidden ? 'Turn on' : 'Turn off'} ${record.name}`;
  }

  function toggle(record) {
    const hiddenSet = spectralViewStateSet(state, record.kind);
    if (hiddenSet) {
      if (hiddenSet.has(record.key)) hiddenSet.delete(record.key);
      else hiddenSet.add(record.key);
    }
    updateVisibility(record);
    setDetails(record);
  }

  for (const record of records) {
    updateVisibility(record);
    record.group.addEventListener('pointerenter', (event) => {
      setHovered(record);
      showTooltip(record, event);
    });
    record.group.addEventListener('pointermove', moveTooltip);
    record.group.addEventListener('pointerleave', () => {
      tooltip.hidden = true;
      if (hoveredRecord === record) setHovered(null);
    });
    record.group.addEventListener('focus', () => setFocused(record));
    record.group.addEventListener('blur', () => {
      if (focusedRecord === record) setFocused(null);
    });
    record.group.addEventListener('click', () => toggle(record));
    record.group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle(record);
      }
    });
    record.button.addEventListener('pointerenter', () => setHovered(record));
    record.button.addEventListener('pointerleave', () => {
      if (hoveredRecord === record) setHovered(null);
    });
    record.button.addEventListener('focus', () => setFocused(record));
    record.button.addEventListener('blur', () => {
      if (focusedRecord === record) setFocused(null);
    });
    record.button.addEventListener('click', () => toggle(record));
  }
  setDetails(null);
}

function spectralViewRecordIsHidden(record, state) {
  const hiddenSet = spectralViewStateSet(state, record.kind);
  return hiddenSet ? hiddenSet.has(record.key) : false;
}

/** Render a self-contained, schematic spectral comparison without network requests. */
export function renderSpectralView(container, entries, overlapRules, interactionState) {
  if (!container || typeof container.replaceChildren !== 'function') return;
  const state = interactionState || spectralViewCreateState();
  const model = buildSpectralViewModel(entries, overlapRules);
  const curveRecords = spectralViewCurveRecords(model);
  const filterRecords = spectralViewFilterRecords(model);
  const records = [...curveRecords, ...filterRecords];
  const section = spectralViewElement('section', 'spectral-view');
  section.append(spectralViewElement('h2', 'spectral-view-heading', 'Spectral view'));
  section.append(
    spectralViewElement(
      'p',
      'spectral-view-caption',
      'Normalized Gaussian curves are schematic from each emission peak plus one draft global width -- not measured spectra or quantitative bleed-through. Filter bands are user-entered.'
    )
  );

  if (!records.length) {
    section.append(
      spectralViewElement(
        'p',
        'spectral-view-empty',
        'Add a fluorophore with a known emission peak or enter a complete detection filter to display the spectrum view.'
      )
    );
    container.replaceChildren(section);
    return;
  }

  const chart = spectralViewElement('div', 'spectral-view-chart');
  const svg = spectralViewSvgElement(
    'svg',
    {
      viewBox: `0 0 ${spectralViewWidth} ${spectralViewHeight}`,
      role: 'group',
      'aria-labelledby': 'spectral-view-title spectral-view-description',
    },
    'spectral-view-svg'
  );
  svg.append(
    spectralViewSvgElement('title', { id: 'spectral-view-title' }, '', 'Interactive schematic emission curves and detection filters'),
    spectralViewSvgElement(
      'desc',
      { id: 'spectral-view-description' },
      '',
      `Normalized schematic emission curves for ${model.curves.length} fluorophore${
        model.curves.length === 1 ? '' : 's'
      } and ${model.filters.length} user-entered detection filter${
        model.filters.length === 1 ? '' : 's'
      }, across 300 to 900 nanometers. Each curve and filter can be focused and toggled.`
    )
  );
  spectralViewAppendFilters(svg, model, filterRecords);
  spectralViewAppendAxis(svg, model);
  spectralViewAppendCurves(svg, model, curveRecords);
  const tooltip = spectralViewElement('div', 'spectral-view-tooltip');
  tooltip.hidden = true;
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.append(
    spectralViewElement('strong', 'spectral-view-tooltip-name'),
    spectralViewElement('span', 'spectral-view-tooltip-summary')
  );
  chart.append(svg, tooltip);
  section.append(chart);

  const details = spectralViewElement('div', 'spectral-view-details');
  details.setAttribute('role', 'status');
  details.setAttribute('aria-live', 'polite');
  details.setAttribute('aria-atomic', 'true');
  details.append(
    spectralViewElement('strong', 'spectral-view-details-name'),
    spectralViewElement('span', 'spectral-view-details-summary')
  );
  section.append(details);
  spectralViewAppendLegend(section, records);
  spectralViewWireInteractions(chart, records, details, tooltip, state);
  container.replaceChildren(section);
}
