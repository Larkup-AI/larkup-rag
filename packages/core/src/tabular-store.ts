/**
 * File-backed tabular data store.
 *
 * Stores raw parsed tabular data (from CSV, Excel, JSON) as a sidecar
 * alongside the document corpus. This allows the LLM to query exact
 * values via the `queryTabularData` tool without needing a sandbox for
 * simple lookups and aggregations.
 *
 * Data layout:
 *   .larkup/projects/<id>/tabular-datasets.json  ← dataset metadata + rows
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getProjectDataDir as getDataDir,
  requireProjectDataDir as requireDataDir,
} from './project-store';

export type ColumnType = 'string' | 'number' | 'date' | 'boolean' | 'mixed';

export interface ColumnStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
  sum: number;
}

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  nullCount: number;
  uniqueCount: number;
  /** Stats only for numeric columns */
  stats?: ColumnStats;
  /** Sample values (up to 5) for quick preview */
  sampleValues?: string[];
  /** Date range (min/max) for date columns — helps the LLM craft correct filters */
  dateRange?: { min: string; max: string; format: string };
}

export interface DatasetSummary {
  totalRows: number;
  totalColumns: number;
  numericColumns: number;
  categoricalColumns: number;
  dateColumns: number;
}

export interface TabularDataset {
  id: string;
  /** Original filename */
  fileName: string;
  /** Column metadata with types and stats */
  columns: ColumnMeta[];
  /** Raw row data as arrays of objects */
  rows: Record<string, any>[];
  /** Quick summary */
  summary: DatasetSummary;
  /** Number of rows */
  rowCount: number;
  createdAt: string;
}

/** Lightweight metadata without the actual rows (for listing). */
export type TabularDatasetMeta = Omit<TabularDataset, 'rows'>;

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{2}\/\d{2}\/\d{4}$/,
  /^\d{2}-\d{2}-\d{4}$/,
  /^\d{4}\/\d{2}\/\d{2}$/,
  /^\d{4}-\d{2}-\d{2}T/,
];

/**
 * Parse a date value to a timestamp (ms since epoch). Handles ISO strings,
 * common slash/dash formats, and Excel serial numbers. Returns NaN on failure.
 */
export function parseDate(value: any): number {
  if (value === null || value === undefined || value === '') return NaN;
  // Already a Date object
  if (value instanceof Date) return value.getTime();
  const str = String(value).trim();
  if (!str) return NaN;
  // Try direct Date.parse (handles ISO-8601, most US/EU formats)
  const ms = Date.parse(str);
  if (!isNaN(ms)) return ms;
  // Try DD/MM/YYYY → YYYY-MM-DD
  const dmySlash = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmySlash) {
    const rewritten = `${dmySlash[3]}-${dmySlash[2]}-${dmySlash[1]}`;
    const ms2 = Date.parse(rewritten);
    if (!isNaN(ms2)) return ms2;
  }
  // Try DD-MM-YYYY → YYYY-MM-DD
  const dmyDash = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyDash) {
    const rewritten = `${dmyDash[3]}-${dmyDash[2]}-${dmyDash[1]}`;
    const ms2 = Date.parse(rewritten);
    if (!isNaN(ms2)) return ms2;
  }
  return NaN;
}

/** Detect the date format pattern from a sample of string values. */
function detectDateFormat(values: string[]): string {
  for (const v of values) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'YYYY-MM-DD';
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'YYYY-MM-DDTHH:mm:ss';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return 'DD/MM/YYYY';
    if (/^\d{2}-\d{2}-\d{4}$/.test(v)) return 'DD-MM-YYYY';
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(v)) return 'YYYY/MM/DD';
  }
  return 'YYYY-MM-DD';
}

function detectColumnType(values: any[]): ColumnType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (nonNull.length === 0) return 'mixed';

  let numCount = 0;
  let boolCount = 0;
  let dateCount = 0;

  for (const v of nonNull) {
    const str = String(v).trim();
    if (str === 'true' || str === 'false') {
      boolCount++;
    } else if (!isNaN(Number(str)) && str !== '') {
      numCount++;
    } else if (DATE_PATTERNS.some((p) => p.test(str)) || !isNaN(Date.parse(str))) {
      dateCount++;
    }
  }

  const threshold = nonNull.length * 0.8;
  if (numCount >= threshold) return 'number';
  if (boolCount >= threshold) return 'boolean';
  if (dateCount >= threshold) return 'date';
  return 'string';
}

function computeNumericStats(values: number[]): ColumnStats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  return {
    min: sorted[0],
    max: sorted[n - 1],
    mean: Number(mean.toFixed(4)),
    median: Number(median.toFixed(4)),
    stddev: Number(stddev.toFixed(4)),
    sum: Number(sum.toFixed(4)),
  };
}

export function analyzeColumns(rows: Record<string, any>[], columnNames: string[]): ColumnMeta[] {
  return columnNames.map((name) => {
    const values = rows.map((r) => r[name]);
    const type = detectColumnType(values);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
    const uniqueValues = new Set(nonNull.map(String));

    const meta: ColumnMeta = {
      name,
      type,
      nullCount: values.length - nonNull.length,
      uniqueCount: uniqueValues.size,
      sampleValues: [...uniqueValues].slice(0, 5),
    };

    if (type === 'number') {
      const nums = nonNull.map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        meta.stats = computeNumericStats(nums);
      }
    }

    if (type === 'date') {
      const dateStrings = nonNull.map(String);
      const timestamps = dateStrings.map(parseDate).filter((t) => !isNaN(t));
      if (timestamps.length > 0) {
        const sorted = [...timestamps].sort((a, b) => a - b);
        meta.dateRange = {
          min:
            dateStrings[timestamps.indexOf(sorted[0])] ??
            new Date(sorted[0]).toISOString().split('T')[0],
          max:
            dateStrings[timestamps.indexOf(sorted[sorted.length - 1])] ??
            new Date(sorted[sorted.length - 1]).toISOString().split('T')[0],
          format: detectDateFormat(dateStrings),
        };
      }
    }

    return meta;
  });
}

function buildSummary(columns: ColumnMeta[], rowCount: number): DatasetSummary {
  return {
    totalRows: rowCount,
    totalColumns: columns.length,
    numericColumns: columns.filter((c) => c.type === 'number').length,
    categoricalColumns: columns.filter((c) => c.type === 'string').length,
    dateColumns: columns.filter((c) => c.type === 'date').length,
  };
}

const FILE_NAME = 'tabular-datasets.json';

async function datasetsPath(create: boolean): Promise<string | null> {
  const dir = create ? await requireDataDir() : await getDataDir();
  if (!dir) return null;
  return path.join(dir, FILE_NAME);
}

async function readAll(): Promise<TabularDataset[]> {
  const file = await datasetsPath(false);
  if (!file) return [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as TabularDataset[];
  } catch {
    return [];
  }
}

async function writeAll(datasets: TabularDataset[]): Promise<void> {
  const file = await datasetsPath(true);
  if (!file) return;
  await fs.writeFile(file, JSON.stringify(datasets, null, 2), 'utf8');
}

/** Save a new tabular dataset. Returns the saved dataset with computed metadata. */
export async function saveTabularDataset(
  fileName: string,
  rows: Record<string, any>[],
): Promise<TabularDataset> {
  if (rows.length === 0) {
    throw new Error('Cannot save an empty dataset');
  }

  const columnNames = Object.keys(rows[0]);
  const columns = analyzeColumns(rows, columnNames);
  const summary = buildSummary(columns, rows.length);

  const dataset: TabularDataset = {
    id: randomUUID(),
    fileName,
    columns,
    rows,
    summary,
    rowCount: rows.length,
    createdAt: new Date().toISOString(),
  };

  const all = await readAll();
  all.push(dataset);
  await writeAll(all);

  return dataset;
}

/** List all datasets (metadata only, no row data). */
export async function listTabularDatasets(): Promise<TabularDatasetMeta[]> {
  const all = await readAll();
  return all.map(({ rows: _rows, ...meta }) => meta);
}

/** Get a full dataset including rows. */
export async function getTabularDataset(id: string): Promise<TabularDataset | null> {
  const all = await readAll();
  return all.find((d) => d.id === id) ?? null;
}

/** Delete a dataset by ID. */
export async function deleteTabularDataset(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((d) => d.id !== id));
}

export type AggregationOp = 'sum' | 'avg' | 'count' | 'min' | 'max' | 'median';

export interface TabularFilter {
  column: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
  value: any;
}

export interface TabularAggregation {
  column: string;
  op: AggregationOp;
}

export interface TabularTimeBucket {
  column: string;
  grain: 'month' | 'quarter' | 'year';
}

export interface TabularQueryRequest {
  datasetId: string;
  filters?: TabularFilter[];
  groupBy?: string[];
  aggregations?: TabularAggregation[];
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  columns?: string[];
  /** Derive a stable calendar bucket before grouping tabular rows. */
  timeBucket?: TabularTimeBucket;
}

export interface TabularQueryResult {
  columns: string[];
  rows: Record<string, any>[];
  totalRows: number;
  /** True when the returned rows are a bounded view of a larger result. */
  truncated?: boolean;
  /** Summary of the query if aggregations were used */
  aggregationResults?: Record<string, number>;
}

/**
 * Tabular queries always calculate against every matching row, but raw rows
 * are returned to the chat/UI in a bounded page. This prevents a large Excel
 * sheet from becoming an equally large tool payload or chat-history entry.
 */
export const DEFAULT_TABULAR_RESULT_LIMIT = 200;
export const MAX_TABULAR_RESULT_LIMIT = 500;

export function boundTabularRows<T>(rows: T[], requestedLimit?: number) {
  const requested =
    typeof requestedLimit === 'number' && Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.floor(requestedLimit)
      : DEFAULT_TABULAR_RESULT_LIMIT;
  const resultLimit = Math.min(requested, MAX_TABULAR_RESULT_LIMIT);
  return {
    rows: rows.slice(0, resultLimit),
    totalRows: rows.length,
    truncated: rows.length > resultLimit,
  };
}

/** Execute a structured query against a tabular dataset. */
export async function queryTabular(query: TabularQueryRequest): Promise<TabularQueryResult> {
  const dataset = await getTabularDataset(query.datasetId);
  if (!dataset) {
    throw new Error(`Dataset not found: ${query.datasetId}`);
  }

  let rows = [...dataset.rows];

  // Build a column type map for date-aware filtering
  const colTypeMap = new Map<string, ColumnType>();
  for (const col of dataset.columns) {
    colTypeMap.set(col.name, col.type);
  }

  if (query.filters && query.filters.length > 0) {
    for (const filter of query.filters) {
      const isDateCol = colTypeMap.get(filter.column) === 'date';

      rows = rows.filter((row) => {
        const val = row[filter.column];

        // Date-aware comparisons
        if (isDateCol && ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(filter.op)) {
          const rowDate = parseDate(val);
          const filterDate = parseDate(filter.value);
          if (isNaN(rowDate) || isNaN(filterDate)) {
            return filter.op === 'eq'
              ? String(val) === String(filter.value)
              : filter.op === 'neq'
                ? String(val) !== String(filter.value)
                : false;
          }
          switch (filter.op) {
            case 'eq':
              return rowDate === filterDate;
            case 'neq':
              return rowDate !== filterDate;
            case 'gt':
              return rowDate > filterDate;
            case 'gte':
              return rowDate >= filterDate;
            case 'lt':
              return rowDate < filterDate;
            case 'lte':
              return rowDate <= filterDate;
          }
        }

        switch (filter.op) {
          case 'eq':
            return String(val) === String(filter.value);
          case 'neq':
            return String(val) !== String(filter.value);
          case 'gt':
            return Number(val) > Number(filter.value);
          case 'gte':
            return Number(val) >= Number(filter.value);
          case 'lt':
            return Number(val) < Number(filter.value);
          case 'lte':
            return Number(val) <= Number(filter.value);
          case 'contains':
            return String(val).toLowerCase().includes(String(filter.value).toLowerCase());
          case 'in':
            return Array.isArray(filter.value) && filter.value.includes(val);
          default:
            return true;
        }
      });
    }
  }

  if (query.timeBucket) {
    const { column, grain } = query.timeBucket;
    const bucketColumn = `${column}_${grain}`;
    rows = rows.flatMap((row) => {
      const timestamp = parseDate(row[column]);
      if (isNaN(timestamp)) return [];
      const date = new Date(timestamp);
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const bucket =
        grain === 'month'
          ? `${year}-${month}`
          : grain === 'quarter'
            ? `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`
            : String(year);
      return [{ ...row, [bucketColumn]: bucket }];
    });
  }

  if (query.groupBy && query.groupBy.length > 0 && query.aggregations) {
    const groups = new Map<string, Record<string, any>[]>();
    for (const row of rows) {
      const key = query.groupBy.map((col) => String(row[col])).join('|||');
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    const aggregatedRows: Record<string, any>[] = [];
    for (const [key, groupRows] of groups.entries()) {
      const result: Record<string, any> = {};
      const keyParts = key.split('|||');
      query.groupBy.forEach((col, i) => {
        result[col] = keyParts[i];
      });

      for (const agg of query.aggregations) {
        const values = groupRows.map((r) => Number(r[agg.column])).filter((n) => !isNaN(n));
        result[`${agg.op}_${agg.column}`] = computeAgg(agg.op, values);
      }

      aggregatedRows.push(result);
    }

    rows = aggregatedRows;
  }

  let aggregationResults: Record<string, number> | undefined;
  if (
    query.aggregations &&
    query.aggregations.length > 0 &&
    (!query.groupBy || query.groupBy.length === 0)
  ) {
    aggregationResults = {};
    for (const agg of query.aggregations) {
      const values = rows.map((r) => Number(r[agg.column])).filter((n) => !isNaN(n));
      aggregationResults[`${agg.op}_${agg.column}`] = computeAgg(agg.op, values);
    }
  }

  if (query.columns && query.columns.length > 0) {
    rows = rows.map((row) => {
      const selected: Record<string, any> = {};
      for (const col of query.columns!) {
        if (col in row) selected[col] = row[col];
      }
      return selected;
    });
  }

  if (query.sortBy) {
    const order = query.sortOrder === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const va = a[query.sortBy!];
      const vb = b[query.sortBy!];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * order;
      return String(va).localeCompare(String(vb)) * order;
    });
  }

  const bounded = boundTabularRows(rows, query.limit);
  rows = bounded.rows;

  const columns =
    rows.length > 0 ? Object.keys(rows[0]) : (query.columns ?? dataset.columns.map((c) => c.name));

  return {
    columns,
    rows,
    totalRows: bounded.totalRows,
    truncated: bounded.truncated,
    aggregationResults,
  };
}

function computeAgg(op: AggregationOp, values: number[]): number {
  if (values.length === 0) return 0;
  switch (op) {
    case 'sum':
      return Number(values.reduce((s, v) => s + v, 0).toFixed(4));
    case 'avg':
      return Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(4));
    case 'count':
      return values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const n = sorted.length;
      return n % 2 === 0
        ? Number(((sorted[n / 2 - 1] + sorted[n / 2]) / 2).toFixed(4))
        : sorted[Math.floor(n / 2)];
    }
    default:
      return 0;
  }
}
