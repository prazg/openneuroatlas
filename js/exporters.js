/**
 * OpenNeuroAtlas — Academic Citation, Table, CSV & Starter-Code Exporters
 *
 * Zero-dependency ES Module providing:
 *  - Single & bulk BibTeX (.bib) with LaTeX special-char escaping & acronym brace protection
 *  - Single & bulk RIS (.ris) for Zotero, EndNote, Mendeley, and Paperpile
 *  - Single & bulk APA 7th Edition references
 *  - GFM Markdown comparison tables tailored per record type
 *  - RFC 4180 compliant CSV export with flattened citation columns
 *  - Platform starter download/fetch snippets for all 7 dataset repositories
 *  - Clipboard & browser file-download utilities
 *
 * Design invariant: all formatting functions are pure and have zero DOM coupling.
 */

const RECORD_TYPE_MAP = Object.freeze({
  dataset: 'datasets',
  datasets: 'datasets',
  model: 'models',
  models: 'models',
  challenge: 'challenges',
  challenges: 'challenges',
  all: 'all',
});

const CONFERENCE_VENUE_REGEX =
  /\b(MICCAI|CVPR|ICCV|ECCV|NeurIPS|NIPS|ICLR|ICML|IPMI|ISBI|MIDL|SPIE|AAAI|RSNA|ISMRM|AANS|CNS|WFNS)\b|proceedings|conference|workshop|symposium/i;

const REPO_PREPRINT_VENUE_REGEX =
  /\b(arXiv|medRxiv|bioRxiv|TCIA|The Cancer Imaging Archive|Synapse|GitHub|GitLab|OSF|Open Science Framework|Hugging Face|Zenodo|Figshare|Grand Challenge|Codabench|Kaggle)\b/i;

const BIBTEX_SPECIAL_REGEX = /[\\{}&%#_$~^]/g;

const CSV_FORMULA_TRIGGER_REGEX = /^[=+\-@\t\r]/;

/**
 * Normalize plural/singular record type string.
 * @param {string|undefined|null} recordType
 * @returns {'datasets'|'models'|'challenges'|'all'|null}
 */
function normalizeRecordType(recordType) {
  if (typeof recordType !== 'string') return null;
  return RECORD_TYPE_MAP[recordType.trim().toLowerCase()] || null;
}

/**
 * Infer canonical plural record type from an item when not explicitly provided.
 * @param {object} item
 * @param {string} [explicitType]
 * @returns {'datasets'|'models'|'challenges'}
 */
function resolveItemType(item, explicitType) {
  const norm = normalizeRecordType(explicitType);
  if (norm && norm !== 'all') return norm;
  if (item && typeof item === 'object') {
    const fromMeta = normalizeRecordType(item._recordType || item._type);
    if (fromMeta && fromMeta !== 'all') return fromMeta;
    if ('repoUrl' in item || 'installSnippet' in item || 'weightsAvailable' in item) {
      return 'models';
    }
    if ('yearsActive' in item || 'organizer' in item || 'metrics' in item) {
      return 'challenges';
    }
  }
  return 'datasets';
}

/**
 * Collapse internal newlines/tabs into clean single spaces.
 * @param {any} value
 * @returns {string}
 */
function normalizeInlineText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Check whether curly braces `{` and `}` are properly balanced in a string.
 * @param {string} str
 * @returns {boolean}
 */
function hasBalancedBraces(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Escape LaTeX / BibTeX special characters safely while preserving brace balance.
 * @param {any} value
 * @returns {string}
 */
export function escapeBibtexText(value) {
  const text = normalizeInlineText(value);
  if (!text) return '';
  const balanced = hasBalancedBraces(text);
  return text.replace(BIBTEX_SPECIAL_REGEX, (ch) => {
    switch (ch) {
      case '\\':
        return '\\textbackslash{}';
      case '{':
        return balanced ? '\\{' : '\\textbraceleft{}';
      case '}':
        return balanced ? '\\}' : '\\textbraceright{}';
      case '&':
        return '\\&';
      case '%':
        return '\\%';
      case '#':
        return '\\#';
      case '_':
        return '\\_';
      case '$':
        return '\\$';
      case '~':
        return '\\textasciitilde{}';
      case '^':
        return '\\textasciicircum{}';
      default:
        return ch;
    }
  });
}

/**
 * Determine whether a title word token contains acronyms or mixed-case symbols
 * that should be brace-protected from BibTeX lowercasing.
 * @param {string} core
 * @returns {boolean}
 */
function shouldProtectBibtexCapitalization(core) {
  if (!core || /[\\{}]/.test(core)) return false;
  const upperMatches = core.match(/[A-Z]/g);
  if (upperMatches && upperMatches.length >= 2) return true;
  if (/[a-z][A-Z]/.test(core)) return true;
  if (/\d[A-Z]/.test(core)) return true;
  if (/^[A-Z]-[A-Za-z]/.test(core)) return true;
  return false;
}

/**
 * Escape a BibTeX title while wrapping technical acronyms (GBM, MRI, BraTS, 3D, fMRI, etc.)
 * in `{...}` to preserve intended capitalization across BibTeX styles.
 * @param {any} rawTitle
 * @returns {string}
 */
function formatBibtexTitle(rawTitle) {
  const text = normalizeInlineText(rawTitle);
  if (!text) return '';

  const tokens = text.split(/(\s+)/);
  return tokens
    .map((token) => {
      if (!token || /^\s+$/.test(token)) return token;
      const match = token.match(/^([(\["'“‘]*)(.*?)([)\]"'”’.,;:!?]*)$/);
      if (!match) return escapeBibtexText(token);
      const [, leading, core, trailing] = match;
      const escapedLeading = escapeBibtexText(leading);
      const escapedTrailing = escapeBibtexText(trailing);
      if (!core) return `${escapedLeading}${escapedTrailing}`;

      const escapedCore = escapeBibtexText(core);
      if (shouldProtectBibtexCapitalization(core)) {
        return `${escapedLeading}{${escapedCore}}${escapedTrailing}`;
      }
      return `${escapedLeading}${escapedCore}${escapedTrailing}`;
    })
    .join('');
}

/**
 * Escape BibTeX author field while preserving canonical `" and "` author separators.
 * @param {any} rawAuthors
 * @returns {string}
 */
function formatBibtexAuthors(rawAuthors) {
  const text = normalizeInlineText(rawAuthors);
  if (!text) return 'Unknown';
  return text
    .split(/\s+and\s+/i)
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return '';
      if (trimmed.toLowerCase() === 'others') return 'others';
      return escapeBibtexText(trimmed);
    })
    .filter(Boolean)
    .join(' and ');
}

/**
 * Sanitize a BibTeX citation key to valid ASCII key characters.
 * @param {string|undefined} key
 * @param {object} item
 * @returns {string}
 */
function sanitizeBibtexKey(key, item) {
  const raw = typeof key === 'string' && key.trim() ? key.trim() : '';
  const cleaned = raw.replace(/[^A-Za-z0-9_:-]/g, '');
  if (cleaned && /^[A-Za-z]/.test(cleaned)) return cleaned;

  const fallbackId = String(item?.id || item?.shortName || item?.name || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  const year = extractCitationYear(item) || 'nd';
  const base = `${fallbackId || 'openneuroatlas'}${year}`;
  return /^[A-Za-z]/.test(base) ? base : `ref${base}`;
}

/**
 * Sanitize a URL for safe inclusion inside BibTeX `url = {...}` without breaking braces.
 * @param {any} url
 * @returns {string}
 */
function sanitizeBibtexUrl(url) {
  const clean = normalizeInlineText(url);
  if (!clean) return '';
  return clean.replace(/\{/g, '%7B').replace(/\}/g, '%7D');
}

/**
 * Sanitize a verbatim DOI identifier for safe inclusion inside BibTeX `doi = {...}`
 * without LaTeX-escaping valid DOI characters such as `_`.
 * @param {any} doi
 * @returns {string}
 */
function sanitizeBibtexDoi(doi) {
  const clean = normalizeInlineText(doi).replace(/\s+/g, '');
  if (!clean) return '';
  return clean.replace(/\{/g, '%7B').replace(/\}/g, '%7D');
}

/**
 * Extract best citation year from record metadata.
 * @param {object} item
 * @returns {number|string}
 */
function extractCitationYear(item) {
  if (item?.citation && typeof item.citation.year === 'number') return item.citation.year;
  if (typeof item?.year === 'number') return item.year;
  if (typeof item?.yearsActive === 'string') {
    const m = item.yearsActive.match(/^(\d{4})/);
    if (m) return parseInt(m[1], 10);
  }
  return '';
}

/**
 * Extract the primary landing/repository URL for any record type.
 * @param {object} item
 * @returns {string}
 */
function getPrimaryUrl(item) {
  if (!item || typeof item !== 'object') return '';
  return normalizeInlineText(item.url || item.repoUrl || item.paperUrl || '');
}

/**
 * Infer BibTeX entry type (`inproceedings`, `misc`, or `article`) from venue & recordType.
 * @param {string} venue
 * @param {'datasets'|'models'|'challenges'} recordType
 * @returns {'inproceedings'|'misc'|'article'}
 */
function inferBibtexEntryType(venue, recordType) {
  const v = normalizeInlineText(venue);
  if (CONFERENCE_VENUE_REGEX.test(v)) return 'inproceedings';
  if (REPO_PREPRINT_VENUE_REGEX.test(v)) return 'misc';
  if (!v && (recordType === 'models' || recordType === 'datasets')) return 'misc';
  return 'article';
}

/**
 * Format a single registry record as a standards-compliant BibTeX entry.
 *
 * @param {object} item
 * @param {string} [recordType]
 * @param {string} [overrideKey]
 * @returns {string}
 */
export function toBibtexEntry(item, recordType, overrideKey) {
  if (!item || typeof item !== 'object') return '';
  const type = resolveItemType(item, recordType);
  const citation = item.citation && typeof item.citation === 'object' ? item.citation : {};

  const key = sanitizeBibtexKey(overrideKey || citation.bibtexKey, item);
  const title = citation.title || item.name || item.shortName || item.id || 'Untitled';
  const venue = normalizeInlineText(citation.venue || item.platform || '');
  const year = extractCitationYear(item);
  const doi = sanitizeBibtexDoi(citation.doi);
  const primaryUrl = sanitizeBibtexUrl(getPrimaryUrl(item));
  const entryType = inferBibtexEntryType(venue, type);

  const fields = [];
  fields.push(`  author = {${formatBibtexAuthors(citation.authors)}}`);
  fields.push(`  title = {${formatBibtexTitle(title)}}`);

  if (entryType === 'inproceedings') {
    if (venue) fields.push(`  booktitle = {${escapeBibtexText(venue)}}`);
  } else if (entryType === 'misc') {
    if (venue) fields.push(`  howpublished = {${escapeBibtexText(venue)}}`);
  } else if (venue) {
    fields.push(`  journal = {${escapeBibtexText(venue)}}`);
  }

  if (year !== '') {
    fields.push(`  year = {${year}}`);
  }
  if (doi) {
    fields.push(`  doi = {${doi}}`);
  }
  if (primaryUrl) {
    fields.push(`  url = {${primaryUrl}}`);
  }

  const noteParts = [];
  if (type === 'datasets' && item.platform) {
    noteParts.push(`Dataset hosted on ${item.platform}`);
  } else if (type === 'models' && item.category) {
    noteParts.push(`${item.category} (${item.openSourceLicense || 'Open Source'})`);
  } else if (type === 'challenges' && item.organizer) {
    noteParts.push(`Benchmark organized by ${item.organizer}`);
  }
  if (noteParts.length > 0 && entryType === 'misc') {
    fields.push(`  note = {${escapeBibtexText(noteParts.join('; '))}}`);
  }

  return `@${entryType}{${key},\n${fields.join(',\n')}\n}`;
}

/**
 * Alias for toBibtexEntry matching ARCHITECTURE.md Section 5.2.
 * @param {object} record
 * @param {string} [recordType]
 * @returns {string}
 */
export function toBibtex(record, recordType) {
  return toBibtexEntry(record, recordType);
}

/**
 * Unpack flexible bulk-export element shapes:
 *  - plain record object
 *  - `{ item, recordType }` or `{ record, recordType }`
 *  - `[item, recordType]` tuple
 *
 * @param {any} entry
 * @returns {{ item: object|null, recordType: string|undefined }}
 */
function unpackItemWithType(entry) {
  if (!entry) return { item: null, recordType: undefined };
  if (Array.isArray(entry)) {
    return { item: entry[0] || null, recordType: entry[1] };
  }
  if (typeof entry === 'object' && ('item' in entry || 'record' in entry)) {
    return {
      item: entry.item || entry.record || null,
      recordType: entry.recordType || entry.type,
    };
  }
  return { item: entry, recordType: undefined };
}

/**
 * Format multiple records as a deduplicated BibTeX bundle (`.bib`).
 * Automatically disambiguates colliding `bibtexKey`s (`key`, `key_2`, `key_3`, ...).
 *
 * Accepts either `[{ item, recordType }, ...]`, `[[item, recordType], ...]`, or `[record, ...]`.
 *
 * @param {Array<object|Array>} itemsWithTypes
 * @returns {string}
 */
export function toBibtexBundle(itemsWithTypes) {
  if (!Array.isArray(itemsWithTypes) || itemsWithTypes.length === 0) return '';

  const usedKeysLower = new Set();
  const entries = [];

  for (const rawEntry of itemsWithTypes) {
    const { item, recordType } = unpackItemWithType(rawEntry);
    if (!item || typeof item !== 'object') continue;

    const baseKey = sanitizeBibtexKey(item.citation?.bibtexKey, item);
    let candidate = baseKey;
    let suffix = 2;
    while (usedKeysLower.has(candidate.toLowerCase())) {
      candidate = `${baseKey}_${suffix}`;
      suffix += 1;
    }
    usedKeysLower.add(candidate.toLowerCase());
    entries.push(toBibtexEntry(item, recordType, candidate));
  }

  return entries.join('\n\n');
}

/**
 * Alias for toBibtexBundle matching ARCHITECTURE.md Section 5.2.
 * @param {Array<object|Array>} records
 * @returns {string}
 */
export function toBulkBibtex(records) {
  return toBibtexBundle(records);
}

/**
 * Infer RIS reference type (`TY`) tag for a registry record.
 * @param {string} venue
 * @param {'datasets'|'models'|'challenges'} recordType
 * @returns {'CONF'|'DATA'|'COMP'|'JOUR'}
 */
function inferRisType(venue, recordType) {
  const v = normalizeInlineText(venue);
  if (CONFERENCE_VENUE_REGEX.test(v)) return 'CONF';
  if (recordType === 'datasets' && REPO_PREPRINT_VENUE_REGEX.test(v)) return 'DATA';
  if (recordType === 'models' && REPO_PREPRINT_VENUE_REGEX.test(v)) return 'COMP';
  return 'JOUR';
}

/**
 * Format a single registry record as an RIS reference entry (`.ris`).
 *
 * @param {object} item
 * @param {string} [recordType]
 * @returns {string}
 */
export function toRisEntry(item, recordType) {
  if (!item || typeof item !== 'object') return '';
  const type = resolveItemType(item, recordType);
  const citation = item.citation && typeof item.citation === 'object' ? item.citation : {};

  const venue = normalizeInlineText(citation.venue || item.platform || '');
  const ty = inferRisType(venue, type);
  const title = normalizeInlineText(citation.title || item.name || item.shortName || item.id);
  const year = extractCitationYear(item);
  const doi = typeof citation.doi === 'string' && citation.doi.trim() ? citation.doi.trim() : null;
  const primaryUrl = getPrimaryUrl(item);
  const paperUrl = normalizeInlineText(item.paperUrl || '');

  const lines = [`TY  - ${ty}`];

  const authors = normalizeInlineText(citation.authors || '')
    .split(/\s+and\s+/i)
    .map((a) => a.trim())
    .filter((a) => a && a.toLowerCase() !== 'others' && a.toLowerCase() !== 'et al.');

  for (const author of authors) {
    lines.push(`AU  - ${author}`);
  }

  if (title) lines.push(`TI  - ${title}`);
  if (year !== '') lines.push(`PY  - ${year}`);
  if (venue) {
    lines.push(`${ty === 'JOUR' ? 'JO' : 'T2'}  - ${venue}`);
  }
  if (doi) lines.push(`DO  - ${doi}`);
  if (primaryUrl) lines.push(`UR  - ${primaryUrl}`);
  if (paperUrl && paperUrl !== primaryUrl) lines.push(`L2  - ${paperUrl}`);

  const keywords = new Set();
  if (Array.isArray(item.pathologies)) {
    for (const p of item.pathologies) {
      if (typeof p === 'string' && p.trim()) keywords.add(p.trim());
    }
  }
  if (Array.isArray(item.modalities)) {
    for (const m of item.modalities) {
      if (typeof m === 'string' && m.trim()) keywords.add(m.trim());
    }
  }
  for (const kw of keywords) {
    lines.push(`KW  - ${kw}`);
  }

  const highlights = normalizeInlineText(item.highlights || '');
  if (highlights) {
    lines.push(`N1  - ${highlights}`);
  }

  lines.push('ER  - ');
  return lines.join('\n');
}

/**
 * Alias for toRisEntry matching ARCHITECTURE.md Section 5.2.
 * @param {object} record
 * @param {string} [recordType]
 * @returns {string}
 */
export function toRis(record, recordType) {
  return toRisEntry(record, recordType);
}

/**
 * Format multiple records as a combined RIS document (`.ris`).
 * @param {Array<object|Array>} itemsWithTypes
 * @returns {string}
 */
export function toBulkRis(itemsWithTypes) {
  if (!Array.isArray(itemsWithTypes) || itemsWithTypes.length === 0) return '';
  return itemsWithTypes
    .map((entry) => {
      const { item, recordType } = unpackItemWithType(entry);
      return item ? toRisEntry(item, recordType) : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Convert a single BibTeX author name ("Last, First Middle") to APA 7th format ("Last, F. M.").
 * Consortium / corporate names without commas are preserved verbatim.
 * @param {string} rawAuthor
 * @returns {string}
 */
function formatSingleApaAuthor(rawAuthor) {
  const clean = normalizeInlineText(rawAuthor);
  if (!clean) return '';

  const commaIdx = clean.indexOf(',');
  if (commaIdx === -1) {
    // Corporate / consortium author (e.g., "BraTS Consortium")
    return clean;
  }

  const lastName = clean.slice(0, commaIdx).trim();
  const givenRaw = clean.slice(commaIdx + 1).trim();
  if (!givenRaw) return lastName;

  const initials = givenRaw
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.includes('-')) {
        return part
          .split('-')
          .filter(Boolean)
          .map((seg) => `${seg.replace(/\.+$/, '').charAt(0).toUpperCase()}.`)
          .join('-');
      }
      const stripped = part.replace(/\.+$/, '');
      if (!stripped) return '';
      return `${stripped.charAt(0).toUpperCase()}.`;
    })
    .filter(Boolean)
    .join(' ');

  return initials ? `${lastName}, ${initials}` : lastName;
}

/**
 * Format a BibTeX-delimited author string into APA 7th author list syntax.
 * @param {string} authorsRaw
 * @returns {string}
 */
function formatApaAuthorList(authorsRaw) {
  const text = normalizeInlineText(authorsRaw);
  if (!text) return 'Unknown Author';

  const rawParts = text
    .split(/\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  let hasOthers = false;
  const formatted = [];

  for (const part of rawParts) {
    if (part.toLowerCase() === 'others' || part.toLowerCase() === 'et al.') {
      hasOthers = true;
      continue;
    }
    const apa = formatSingleApaAuthor(part);
    if (apa) formatted.push(apa);
  }

  if (formatted.length === 0) return 'Unknown Author';
  if (hasOthers) {
    return `${formatted.join(', ')}, et al.`;
  }
  if (formatted.length === 1) {
    return formatted[0];
  }
  if (formatted.length === 2) {
    return `${formatted[0]}, & ${formatted[1]}`;
  }
  if (formatted.length <= 20) {
    return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
  }
  return `${formatted.slice(0, 19).join(', ')}, ... ${formatted[formatted.length - 1]}`;
}

/**
 * Format a single registry record as an APA 7th Edition citation string.
 *
 * @param {object} item
 * @param {string} [recordType]
 * @returns {string}
 */
export function toApaCitation(item, recordType) {
  void recordType;
  if (!item || typeof item !== 'object') return '';
  const citation = item.citation && typeof item.citation === 'object' ? item.citation : {};

  const authors = formatApaAuthorList(citation.authors || item.organizer || 'OpenNeuroAtlas');
  const year = extractCitationYear(item) || 'n.d.';
  const title = normalizeInlineText(citation.title || item.name || item.shortName || item.id);
  const titleWithPeriod = /[.?!]$/.test(title) ? title : `${title}.`;
  const venue = normalizeInlineText(citation.venue || item.platform || '');
  const venueSegment = venue ? (/\.$/u.test(venue) ? ` ${venue}` : ` ${venue}.`) : '';

  const doi = typeof citation.doi === 'string' && citation.doi.trim() ? citation.doi.trim() : null;
  const link = doi ? `https://doi.org/${doi}` : getPrimaryUrl(item);
  const linkSegment = link ? ` ${link}` : '';

  return `${authors} (${year}). ${titleWithPeriod}${venueSegment}${linkSegment}`.trim();
}

/**
 * Alias for toApaCitation matching ARCHITECTURE.md Section 5.2.
 * @param {object} record
 * @param {string} [recordType]
 * @returns {string}
 */
export function toApa(record, recordType) {
  return toApaCitation(record, recordType);
}

/**
 * Format multiple records as a double-spaced list of APA 7th citations.
 * @param {Array<object|Array>} itemsWithTypes
 * @returns {string}
 */
export function toBulkApa(itemsWithTypes) {
  if (!Array.isArray(itemsWithTypes) || itemsWithTypes.length === 0) return '';
  return itemsWithTypes
    .map((entry) => {
      const { item, recordType } = unpackItemWithType(entry);
      return item ? toApaCitation(item, recordType) : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Escape text safely for a GFM Markdown table cell.
 * @param {any} value
 * @returns {string}
 */
function escapeMarkdownCell(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value
      .map((v) => normalizeInlineText(v).replace(/\|/g, '\\|'))
      .join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return normalizeInlineText(value).replace(/\|/g, '\\|');
}

/**
 * Format a safe Markdown link `[label](url)` with scheme validation and escaped parentheses.
 * @param {string} label
 * @param {string|null|undefined} url
 * @returns {string}
 */
function formatMarkdownLink(label, url) {
  const cleanUrl = normalizeInlineText(url);
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) return escapeMarkdownCell(label);
  const safeUrl = cleanUrl.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `[${escapeMarkdownCell(label)}](${safeUrl})`;
}

/**
 * Resolve table schema (`datasets`, `models`, `challenges`, or `all`) from explicit type or items.
 * @param {object[]} items
 * @param {string} [recordType]
 * @returns {'datasets'|'models'|'challenges'|'all'}
 */
function resolveCollectionViewType(items, recordType) {
  const explicit = normalizeRecordType(recordType);
  if (explicit) return explicit;
  if (!Array.isArray(items) || items.length === 0) return 'datasets';

  const detected = new Set(items.map((it) => resolveItemType(it)));
  if (detected.size === 1) {
    return detected.values().next().value;
  }
  return 'all';
}

/**
 * Generate a GFM Markdown comparison table tailored to the selected record type.
 *
 * @param {object[]} items
 * @param {'datasets'|'models'|'challenges'|'all'|'dataset'|'model'|'challenge'} [recordType]
 * @returns {string}
 */
export function toComparisonMarkdown(items, recordType) {
  const safeItems = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  const viewType = resolveCollectionViewType(safeItems, recordType);

  let headers;
  let rowBuilder;

  if (viewType === 'models') {
    headers = [
      'Model / Toolkit',
      'Category',
      'Year',
      'Pathologies',
      'Modalities',
      'Architecture',
      'Open Weights',
      'License',
      'Framework',
      'Repository',
    ];
    rowBuilder = (m) => [
      escapeMarkdownCell(m.name),
      escapeMarkdownCell(m.category),
      escapeMarkdownCell(m.year),
      escapeMarkdownCell(m.pathologies),
      escapeMarkdownCell(m.modalities),
      escapeMarkdownCell(m.architecture),
      escapeMarkdownCell(m.weightsAvailable),
      escapeMarkdownCell(m.openSourceLicense),
      escapeMarkdownCell(m.framework),
      formatMarkdownLink('Repo', m.repoUrl),
    ];
  } else if (viewType === 'challenges') {
    headers = [
      'Challenge / Benchmark',
      'Organizer',
      'Years Active',
      'Status',
      'Pathologies',
      'Modalities',
      'Tasks',
      'Metrics',
      'Platform',
      'Link',
    ];
    rowBuilder = (c) => [
      escapeMarkdownCell(c.name),
      escapeMarkdownCell(c.organizer),
      escapeMarkdownCell(c.yearsActive),
      escapeMarkdownCell(c.status),
      escapeMarkdownCell(c.pathologies),
      escapeMarkdownCell(c.modalities),
      escapeMarkdownCell(c.tasks),
      escapeMarkdownCell(c.metrics),
      escapeMarkdownCell(c.platform),
      formatMarkdownLink('Portal', c.url),
    ];
  } else if (viewType === 'all') {
    headers = [
      'Name',
      'Type',
      'Year',
      'Pathologies',
      'Modalities',
      'Scale / Architecture / Status',
      'Access / License',
      'Link',
    ];
    rowBuilder = (rec) => {
      const rType = resolveItemType(rec);
      const typeLabel =
        rType === 'datasets' ? 'Dataset' : rType === 'models' ? 'Model / Toolkit' : 'Challenge';
      const detail =
        rType === 'datasets'
          ? rec.cohortDisplay
          : rType === 'models'
            ? rec.architecture
            : `${rec.status || ''} (${rec.organizer || ''})`.trim();
      const access =
        rType === 'datasets'
          ? `${rec.accessTier || ''} (${rec.license || ''})`.trim()
          : rType === 'models'
            ? rec.openSourceLicense
            : rec.platform;
      return [
        escapeMarkdownCell(rec.shortName || rec.name),
        typeLabel,
        escapeMarkdownCell(extractCitationYear(rec)),
        escapeMarkdownCell(rec.pathologies),
        escapeMarkdownCell(rec.modalities),
        escapeMarkdownCell(detail),
        escapeMarkdownCell(access),
        formatMarkdownLink('Open', getPrimaryUrl(rec)),
      ];
    };
  } else {
    headers = [
      'Dataset',
      'Year',
      'Pathologies',
      'Modalities',
      'Clinical Phases',
      'Cohort',
      'Molecular Markers',
      'Access Tier',
      'License',
      'Platform',
      'Link',
    ];
    rowBuilder = (d) => [
      escapeMarkdownCell(d.shortName ? `${d.shortName} — ${d.name}` : d.name),
      escapeMarkdownCell(d.year),
      escapeMarkdownCell(d.pathologies),
      escapeMarkdownCell(d.modalities),
      escapeMarkdownCell(d.clinicalPhases),
      escapeMarkdownCell(d.cohortDisplay),
      escapeMarkdownCell(d.molecularMarkers),
      escapeMarkdownCell(d.accessTier),
      escapeMarkdownCell(d.license),
      escapeMarkdownCell(d.platform),
      formatMarkdownLink(d.platform || 'Portal', d.url),
    ];
  }

  const headerLine = `| ${headers.join(' | ')} |`;
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;

  if (safeItems.length === 0) {
    const emptyCells = headers.map((_, idx) => (idx === 0 ? '_No records selected._' : '—'));
    return `${headerLine}\n${sepLine}\n| ${emptyCells.join(' | ')} |`;
  }

  const rows = safeItems.map((item) => `| ${rowBuilder(item).join(' | ')} |`);
  return [headerLine, sepLine, ...rows].join('\n');
}

/**
 * Alias for toComparisonMarkdown matching ARCHITECTURE.md Section 5.2.
 * Automatically detects the table schema (`datasets`, `models`, `challenges`, or `all`)
 * when `viewType` is omitted.
 * @param {object[]} records
 * @param {'datasets'|'models'|'challenges'|'all'|'dataset'|'model'|'challenge'} [viewType]
 * @returns {string}
 */
export function toMarkdownTable(records, viewType) {
  return toComparisonMarkdown(records, viewType);
}

/**
 * Escape a single cell value according to RFC 4180 CSV rules, with spreadsheet
 * formula-injection neutralization (prefixes `'` when non-numeric string cells
 * begin with `=`, `+`, `-`, `@`, `\t`, or `\r`).
 * Joins array values with `"; "`, doubles internal quotes, and wraps values containing
 * commas, quotes, or line breaks in double quotes.
 *
 * @param {any} value
 * @returns {string}
 */
export function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const isNumeric = typeof value === 'number';
  let str;
  if (Array.isArray(value)) {
    str = value.map((v) => (v === null || v === undefined ? '' : String(v))).join('; ');
  } else if (typeof value === 'boolean') {
    str = value ? 'true' : 'false';
  } else {
    str = String(value);
  }
  if (!isNumeric && CSV_FORMULA_TRIGGER_REGEX.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export records as an RFC 4180 compliant CSV string with flattened citation columns.
 *
 * @param {object[]} items
 * @param {'datasets'|'models'|'challenges'|'all'|'dataset'|'model'|'challenge'} [recordType]
 * @param {{ includeBom?: boolean }} [options={}]
 * @returns {string}
 */
export function toCsv(items, recordType, options = {}) {
  const safeItems = Array.isArray(items) ? items.filter((it) => it && typeof it === 'object') : [];
  const viewType = resolveCollectionViewType(safeItems, recordType);

  let columns;
  if (viewType === 'models') {
    columns = [
      { header: 'id', get: (r) => r.id },
      { header: 'name', get: (r) => r.name },
      { header: 'category', get: (r) => r.category },
      { header: 'year', get: (r) => r.year },
      { header: 'pathologies', get: (r) => r.pathologies },
      { header: 'modalities', get: (r) => r.modalities },
      { header: 'architecture', get: (r) => r.architecture },
      { header: 'weightsAvailable', get: (r) => r.weightsAvailable },
      { header: 'openSourceLicense', get: (r) => r.openSourceLicense },
      { header: 'framework', get: (r) => r.framework },
      { header: 'repoUrl', get: (r) => r.repoUrl },
      { header: 'weightsUrl', get: (r) => r.weightsUrl ?? '' },
      { header: 'paperUrl', get: (r) => r.paperUrl ?? '' },
      { header: 'citation_authors', get: (r) => r.citation?.authors ?? '' },
      { header: 'citation_title', get: (r) => r.citation?.title ?? '' },
      { header: 'citation_venue', get: (r) => r.citation?.venue ?? '' },
      { header: 'citation_year', get: (r) => r.citation?.year ?? '' },
      { header: 'citation_bibtex_key', get: (r) => r.citation?.bibtexKey ?? '' },
      { header: 'citation_doi', get: (r) => r.citation?.doi ?? '' },
      { header: 'highlights', get: (r) => r.highlights },
    ];
  } else if (viewType === 'challenges') {
    columns = [
      { header: 'id', get: (r) => r.id },
      { header: 'name', get: (r) => r.name },
      { header: 'organizer', get: (r) => r.organizer },
      { header: 'yearsActive', get: (r) => r.yearsActive },
      { header: 'status', get: (r) => r.status },
      { header: 'pathologies', get: (r) => r.pathologies },
      { header: 'modalities', get: (r) => r.modalities },
      { header: 'tasks', get: (r) => r.tasks },
      { header: 'metrics', get: (r) => r.metrics },
      { header: 'platform', get: (r) => r.platform },
      { header: 'url', get: (r) => r.url },
      { header: 'paperUrl', get: (r) => r.paperUrl ?? '' },
      { header: 'citation_authors', get: (r) => r.citation?.authors ?? '' },
      { header: 'citation_title', get: (r) => r.citation?.title ?? '' },
      { header: 'citation_venue', get: (r) => r.citation?.venue ?? '' },
      { header: 'citation_year', get: (r) => r.citation?.year ?? '' },
      { header: 'citation_bibtex_key', get: (r) => r.citation?.bibtexKey ?? '' },
      { header: 'citation_doi', get: (r) => r.citation?.doi ?? '' },
      { header: 'highlights', get: (r) => r.highlights },
    ];
  } else if (viewType === 'all') {
    columns = [
      { header: 'id', get: (r) => r.id },
      { header: 'recordType', get: (r) => resolveItemType(r) },
      { header: 'name', get: (r) => r.name },
      { header: 'shortName', get: (r) => r.shortName ?? '' },
      { header: 'year', get: (r) => extractCitationYear(r) },
      { header: 'pathologies', get: (r) => r.pathologies },
      { header: 'modalities', get: (r) => r.modalities },
      {
        header: 'details',
        get: (r) => r.cohortDisplay || r.architecture || r.organizer || '',
      },
      {
        header: 'accessOrLicense',
        get: (r) => r.accessTier || r.openSourceLicense || r.status || '',
      },
      {
        header: 'platformOrFramework',
        get: (r) => r.platform || r.framework || '',
      },
      { header: 'url', get: (r) => getPrimaryUrl(r) },
      { header: 'paperUrl', get: (r) => r.paperUrl ?? '' },
      { header: 'citation_bibtex_key', get: (r) => r.citation?.bibtexKey ?? '' },
      { header: 'citation_year', get: (r) => r.citation?.year ?? '' },
      { header: 'citation_doi', get: (r) => r.citation?.doi ?? '' },
      { header: 'highlights', get: (r) => r.highlights },
    ];
  } else {
    columns = [
      { header: 'id', get: (r) => r.id },
      { header: 'name', get: (r) => r.name },
      { header: 'shortName', get: (r) => r.shortName },
      { header: 'year', get: (r) => r.year },
      { header: 'pathologies', get: (r) => r.pathologies },
      { header: 'modalities', get: (r) => r.modalities },
      { header: 'clinicalPhases', get: (r) => r.clinicalPhases },
      { header: 'tasks', get: (r) => r.tasks },
      { header: 'cohortSize', get: (r) => r.cohortSize ?? '' },
      { header: 'cohortDisplay', get: (r) => r.cohortDisplay },
      { header: 'annotations', get: (r) => r.annotations },
      { header: 'molecularMarkers', get: (r) => r.molecularMarkers },
      { header: 'accessTier', get: (r) => r.accessTier },
      { header: 'license', get: (r) => r.license },
      { header: 'platform', get: (r) => r.platform },
      { header: 'url', get: (r) => r.url },
      { header: 'paperUrl', get: (r) => r.paperUrl ?? '' },
      { header: 'citation_authors', get: (r) => r.citation?.authors ?? '' },
      { header: 'citation_title', get: (r) => r.citation?.title ?? '' },
      { header: 'citation_venue', get: (r) => r.citation?.venue ?? '' },
      { header: 'citation_year', get: (r) => r.citation?.year ?? '' },
      { header: 'citation_bibtex_key', get: (r) => r.citation?.bibtexKey ?? '' },
      { header: 'citation_doi', get: (r) => r.citation?.doi ?? '' },
      { header: 'highlights', get: (r) => r.highlights },
      { header: 'limitations', get: (r) => r.limitations },
    ];
  }

  const headerRow = columns.map((col) => escapeCsvCell(col.header)).join(',');
  const dataRows = safeItems.map((item) =>
    columns.map((col) => escapeCsvCell(col.get(item))).join(',')
  );

  const csvBody = [headerRow, ...dataRows].join('\n');
  return options?.includeBom ? `\uFEFF${csvBody}` : csvBody;
}

/**
 * Generate a reproducible starter fetch/download snippet for any of the 7 supported
 * OpenNeuroAtlas dataset hosting platforms (used in PR Builder & detail helpers).
 *
 * @param {string} platform
 * @param {{ name?: string, shortName?: string, url?: string, id?: string }} [meta={}]
 * @returns {string}
 */
export function getPlatformFetchTemplate(platform, { name, shortName, url, id } = {}) {
  const safeId = (id || shortName || name || 'dataset')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '') || 'dataset';
  const collectionName = shortName || name || 'COLLECTION-NAME';
  const landingUrl = url || 'https://example.org/dataset';

  switch (platform) {
    case 'TCIA':
      return [
        `# TCIA download via tcia_utils (or NBIA Data Retriever CLI)`,
        `pip install tcia_utils`,
        `python -c "from tcia_utils import nbia; series = nbia.getSeries(collection='${collectionName}'); nbia.downloadSeries(series, path='./data/${safeId}')"`,
      ].join('\n');

    case 'Synapse':
      return [
        `# Synapse download (requires free Synapse account & Personal Access Token)`,
        `pip install synapseclient`,
        `synapse login --authToken "$SYNAPSE_AUTH_TOKEN"`,
        `synapse get -r synXXXXXXXX --downloadLocation ./data/${safeId}`,
      ].join('\n');

    case 'Hugging Face':
      return [
        `# Hugging Face Hub dataset download`,
        `pip install huggingface_hub`,
        `huggingface-cli download <org>/${safeId} --repo-type dataset --local-dir ./data/${safeId}`,
      ].join('\n');

    case 'OSF':
      return [
        `# Open Science Framework (OSF) project clone`,
        `pip install osfclient`,
        `osf -p <project_id> clone ./data/${safeId}`,
      ].join('\n');

    case 'Figshare':
      return [
        `# Figshare API v2 download (replace <article_id> from ${landingUrl})`,
        `mkdir -p ./data/${safeId}`,
        `python -c "import urllib.request, json; files = json.load(urllib.request.urlopen('https://api.figshare.com/v2/articles/<article_id>/files')); [urllib.request.urlretrieve(f['download_url'], f'./data/${safeId}/' + f['name']) for f in files]"`,
      ].join('\n');

    case 'GitHub':
      return [
        `# GitHub shallow clone (or download attached Release archives)`,
        `git clone --depth 1 ${landingUrl} ./data/${safeId}`,
      ].join('\n');

    case 'Institutional Portal':
      return [
        `# Institutional Portal / Controlled DUA Workflow`,
        `# 1. Request access & complete DUA at: ${landingUrl}`,
        `# 2. Extract downloaded archive into ./data/${safeId}`,
        `# 3. Verify NIfTI / BIDS structure:`,
        `python -c "import pathlib; nifti = list(pathlib.Path('./data/${safeId}').rglob('*.nii*')); print(f'Verified {len(nifti)} NIfTI files')"`,
      ].join('\n');

    default:
      return [
        `# Download dataset from official landing page: ${landingUrl}`,
        `mkdir -p ./data/${safeId}`,
      ].join('\n');
  }
}

/**
 * Copy a string to the system clipboard with graceful fallback for older/restricted contexts.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  const str = String(text ?? '');
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  if (typeof document === 'undefined' || !document.body) {
    return false;
  }
  const textarea = document.createElement('textarea');
  textarea.value = str;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}

/**
 * Trigger a browser download for a generated text file (`.bib`, `.ris`, `.csv`, `.md`, `.json`).
 * Safe no-op in non-browser environments.
 *
 * @param {string} filename
 * @param {string} content
 * @param {string} [mimeType='text/plain;charset=utf-8']
 * @returns {boolean}
 */
export function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  if (
    typeof document === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return false;
  }

  const blob = new Blob([String(content ?? '')], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename || 'openneuroatlas-export.txt';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
    return true;
  } finally {
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
