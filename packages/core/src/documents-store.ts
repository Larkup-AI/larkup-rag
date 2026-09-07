import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DocumentSource, SourceDocument } from './types';
import { getProjectDataDir, requireProjectDataDir } from './project-store';

/**
 * File-backed corpus store, scoped to the active Project.
 *
 * Documents are appended here as the ETL runs (paste / upload / crawl), so an
 * interrupted multi-hour crawl never loses what it already scraped. Writes are
 * serialized through a tiny in-process mutex to avoid concurrent crawl polls
 * clobbering each other.
 */

let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
}

async function docsPath(create: boolean): Promise<string | null> {
  const dir = create ? await requireProjectDataDir() : await getProjectDataDir();
  if (!dir) return null;
  return path.join(dir, 'documents.json');
}

export async function readDocuments(): Promise<SourceDocument[]> {
  const file = await docsPath(false);
  if (!file) return [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid document store at ${file}: expected a JSON array.`);
    }
    return parsed as SourceDocument[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAll(docs: SourceDocument[]) {
  const file = await docsPath(true);
  if (!file) return;
  const temporaryFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(docs, null, 2), 'utf8');
    await fs.rename(temporaryFile, file);
  } catch (error) {
    await fs.unlink(temporaryFile).catch(() => {});
    throw error;
  }
}

export interface NewDocumentInput {
  /** Optional caller-generated ID for journaling a multi-store publication. */
  id?: string;
  title: string;
  content: string;
  source: DocumentSource;
  url?: string;
  jobId?: string;
  groupId?: string;
  enabled?: boolean;
  parentSourceId?: string;
  metadata?: Record<string, any>;
}

function normalize(input: NewDocumentInput): SourceDocument {
  const content = input.content.trim();
  return {
    id: input.id ?? randomUUID(),
    title: input.title.trim() || 'Untitled',
    url: input.url,
    source: input.source,
    content,
    charCount: content.length,
    jobId: input.jobId,
    groupId: input.groupId,
    enabled: input.enabled ?? true,
    parentSourceId: input.parentSourceId,
    metadata: input.metadata,
    status: 'unindexed',
    createdAt: new Date().toISOString(),
  };
}

/** Append one document. Returns the stored record. */
export function addDocument(input: NewDocumentInput) {
  return serialize(async () => {
    const docs = await readDocuments();
    const doc = normalize(input);
    docs.push(doc);
    await writeAll(docs);
    return doc;
  });
}

/**
 * Append a batch of documents with one read/write cycle.
 *
 * Media timelines commonly produce many timestamped documents at once; this
 * avoids repeatedly parsing and rewriting the complete corpus for every
 * segment while preserving the input order in the returned records.
 */
export function addDocuments(inputs: NewDocumentInput[]): Promise<SourceDocument[]> {
  return serialize(async () => {
    if (inputs.length === 0) return [];
    const docs = await readDocuments();
    const added = inputs.map(normalize);
    docs.push(...added);
    await writeAll(docs);
    return added;
  });
}

/**
 * Append many documents from a crawl, skipping ones whose URL already exists
 * for the same job (Firecrawl returns the full set on each status poll).
 * Returns the number of NEW documents actually added.
 */
export function addCrawledDocuments(jobId: string, incoming: NewDocumentInput[]): Promise<number> {
  return serialize(async () => {
    const docs = await readDocuments();
    const seen = new Set(
      docs.filter((d) => d.url).map((d) => `${d.groupId ?? 'default'}:${d.url}`),
    );
    let added = 0;
    for (const input of incoming) {
      const dedupeKey = `${input.groupId ?? 'default'}:${input.url}`;
      if (input.url && seen.has(dedupeKey)) continue;
      if (!input.content.trim()) continue;
      docs.push(normalize({ ...input, jobId }));
      if (input.url) seen.add(dedupeKey);
      added++;
    }
    if (added > 0) await writeAll(docs);
    return added;
  });
}

/** Edit a document's title / content / url in place. Returns the updated doc. */
export function updateDocument(
  id: string,
  patch: {
    title?: string;
    content?: string;
    url?: string;
    metadata?: Record<string, any>;
    groupId?: string;
    enabled?: boolean;
  },
): Promise<SourceDocument | undefined> {
  return serialize(async () => {
    const docs = await readDocuments();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) return undefined;
    const current = docs[idx];
    const content = patch.content !== undefined ? patch.content.trim() : current.content;
    const next: SourceDocument = {
      ...current,
      title: patch.title !== undefined ? patch.title.trim() || 'Untitled' : current.title,
      content,
      charCount: content.length,
      url: patch.url !== undefined ? patch.url || undefined : current.url,
      metadata: patch.metadata !== undefined ? patch.metadata : current.metadata,
      groupId: patch.groupId !== undefined ? patch.groupId || undefined : current.groupId,
      enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
      status: 'unindexed',
    };
    docs[idx] = next;
    await writeAll(docs);
    return next;
  });
}

export function deleteDocument(id: string) {
  return serialize(async () => {
    const docs = await readDocuments();
    await writeAll(docs.filter((d) => d.id !== id));
  });
}

export function deleteDocuments(ids: string[]) {
  return serialize(async () => {
    const docs = await readDocuments();
    const idSet = new Set(ids);
    await writeAll(docs.filter((d) => !idSet.has(d.id)));
  });
}

export function clearDocuments() {
  return serialize(async () => {
    await writeAll([]);
  });
}

/**
 * Replace a project's corpus with a copy of existing source documents.
 *
 * This deliberately preserves the source content but discards index state: a
 * vector index is tied to the database and embedding configuration that wrote
 * it, so copied documents must always be indexed again in their destination.
 */
export function replaceDocuments(documents: SourceDocument[]) {
  return serialize(async () => {
    const now = new Date().toISOString();
    await writeAll(
      documents.map((document) => ({
        ...document,
        status: 'unindexed' as const,
        createdAt: document.createdAt || now,
      })),
    );
  });
}

export function updateDocumentsStatus(ids: string[], status: 'indexed' | 'unindexed') {
  return serialize(async () => {
    const docs = await readDocuments();
    const idSet = new Set(ids);
    let changed = false;
    for (const d of docs) {
      if (idSet.has(d.id)) {
        d.status = status;
        changed = true;
      }
    }
    if (changed) await writeAll(docs);
  });
}

/** Lightweight corpus stats for the Index stage + headers. */
export async function corpusStats() {
  const docs = await readDocuments();
  const chars = docs.reduce((sum, d) => sum + d.charCount, 0);
  return {
    docCount: docs.length,
    charCount: chars,
    bySource: docs.reduce<Record<string, number>>((acc, d) => {
      acc[d.source] = (acc[d.source] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

/**
 * Batch-create SourceDocuments from tabular data rows.
 *
 * Each row becomes a document with structured text like:
 *   "Column1: value1 | Column2: value2 | ..."
 *
 * Metadata includes a _tabular ref linking back to the dataset + row index.
 * The title is auto-generated from the first text column.
 */
export function addTabularDocuments(
  datasetId: string,
  fileName: string,
  rows: Record<string, any>[],
  columnNames: string[],
  options?: {
    /** Column to use for document titles (default: first text column) */
    titleColumn?: string;
    /** Columns to include in document content (default: all) */
    contentColumns?: string[];
    /** Separator between column values (default: " | ") */
    separator?: string;
  },
): Promise<number> {
  return serialize(async () => {
    const docs = await readDocuments();
    const sep = options?.separator ?? ' | ';
    const contentCols = options?.contentColumns ?? columnNames;
    const titleCol = options?.titleColumn ?? columnNames[0];
    let added = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Build structured text content
      const content = contentCols
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined || val === '') return null;
          return `${col}: ${val}`;
        })
        .filter(Boolean)
        .join(sep);

      if (!content.trim()) continue;

      const title =
        titleCol && row[titleCol] ? String(row[titleCol]) : `${fileName} — Row ${i + 1}`;

      const doc: SourceDocument = {
        id: randomUUID(),
        title,
        source: 'files',
        content,
        charCount: content.length,
        status: 'unindexed',
        metadata: {
          _tabular: {
            datasetId,
            rowIndex: i,
            columnMap: contentCols,
          },
          _fileName: fileName,
        },
        createdAt: new Date().toISOString(),
      };

      docs.push(doc);
      added++;
    }

    if (added > 0) await writeAll(docs);
    return added;
  });
}
