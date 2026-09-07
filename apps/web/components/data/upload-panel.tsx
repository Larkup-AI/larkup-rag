'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatErrorMessage } from '@/lib/shared/error-formatter';
import {
  FileUp,
  Loader2,
  X,
  Settings2,
  Columns,
  Plus,
  Database,
  Image as ImageIcon,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { TabularPreview } from '@/components/data/tabular-preview';
import type { DataPrimaryAction } from '@/components/data/data-primary-action';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const ACCEPT = '.txt,.md,.markdown,.json,.csv,.html,.htm,.log,.xlsx,.xls,.pdf,.doc,.docx';

type FileFormat = 'plain' | 'lines' | 'structured';

interface StagedFile {
  id: string;
  name: string;
  size: number;
  format: FileFormat;
  rawContent?: string;
  rows?: any[];
  keys?: string[];
  // mapping for structured
  titleKey?: string;
  contentKeys?: string[];
  contentSeparator?: string;
  metadataKeys?: string[];
  globalMetadata?: { key: string; value: string }[];
  /** When true, structured data is also saved as a TabularDataset for analytics */
  indexAsTabular?: boolean;
  /** Expanded preview state */
  showPreview?: boolean;
  /** When true, images from PDF will be extracted and indexed */
  indexImages?: boolean;
  /** The original file object for client-side processing */
  fileObject?: File;
}

interface ImageIndexingCapability {
  available: boolean;
  message?: string;
}

let globalStagedFiles: StagedFile[] = [];
const UPLOAD_QUEUE_KEY = 'larkup.upload-queue.v1';

function restoreQueue(): StagedFile[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = sessionStorage.getItem(UPLOAD_QUEUE_KEY);
    return saved ? (JSON.parse(saved) as StagedFile[]) : [];
  } catch {
    return [];
  }
}

function persistQueue(files: StagedFile[]) {
  try {
    const serializable = files.map(({ fileObject: _fileObject, ...file }) => file);
    sessionStorage.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(serializable));
  } catch {}
}

export function UploadPanel({
  onAdded,
  onActionChange,
  groupId,
}: {
  onAdded: () => void;
  onActionChange?: (action: DataPrimaryAction | null) => void;
  groupId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const initialStaged = globalStagedFiles.length ? globalStagedFiles : restoreQueue();
  const [staged, setStagedState] = useState<StagedFile[]>(initialStaged);
  const stagedRef = useRef(initialStaged);
  const savingRef = useRef(false);
  const [indexAllImages, setIndexAllImages] = useState(false);
  const [imageIndexingCapability, setImageIndexingCapability] =
    useState<ImageIndexingCapability | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/config')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!active) return;
        const capability = data?.capabilities?.imageIndexing;
        setImageIndexingCapability(
          capability?.available
            ? { available: true }
            : {
                available: false,
                message:
                  capability?.message ??
                  'No vision-capable model is configured. PDF images will not be indexed.',
              },
        );
      })
      .catch(() => {
        if (active) {
          setImageIndexingCapability({
            available: false,
            message: 'Could not verify a vision model. PDF images will not be indexed.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const setStaged = (val: React.SetStateAction<StagedFile[]>) => {
    const next = typeof val === 'function' ? val(stagedRef.current) : val;
    stagedRef.current = next;
    globalStagedFiles = next;
    persistQueue(next);
    setStagedState(next);
  };
  const imageIndexingAvailable = imageIndexingCapability?.available === true;

  useEffect(() => {
    if (!imageIndexingCapability || imageIndexingCapability.available) return;
    setIndexAllImages(false);
    setStaged((files) =>
      files.map((file) =>
        file.name.toLowerCase().endsWith('.pdf') ? { ...file, indexImages: false } : file,
      ),
    );
  }, [imageIndexingCapability]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{
    message?: string;
    current: number;
    total: number;
  } | null>(null);

  // Mapping state
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const editingFile = staged.find((f) => f.id === editingFileId);

  async function readFiles(files: FileList | File[]) {
    const joinedActiveSave = savingRef.current;
    const next: StagedFile[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase();

      // Prevent dragging media into the documents tab
      if (ext && !ACCEPT.includes(`.${ext}`)) {
        toast.error(
          `Unsupported file type: ${file.name}. Please upload media files in the Media tab.`,
        );
        continue;
      }

      const id = Math.random().toString(36).slice(2);
      try {
        if (ext === 'csv') {
          const content = await file.text();
          const result = Papa.parse(content, {
            header: true,
            skipEmptyLines: true,
          });
          if (result.data.length > 0) {
            const keys = Object.keys(result.data[0] as object);
            next.push({
              id,
              name: file.name,
              size: file.size,
              format: 'structured',
              rows: result.data,
              keys,
              titleKey: keys[0],
              contentKeys: keys,
              contentSeparator: ', ',
              metadataKeys: keys.slice(1),
              globalMetadata: [],
              indexAsTabular: true,
            });
          }
        } else if (ext === 'xlsx' || ext === 'xls') {
          const data = await file.arrayBuffer();
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const hasMultipleSheets = workbook.SheetNames.length > 1;
          let indexedSheets = 0;
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<
              string,
              any
            >[];
            const rows = rawRows.map((row) => {
              const out: Record<string, any> = {};
              for (const [k, v] of Object.entries(row)) {
                out[k] = v instanceof Date ? v.toISOString().split('T')[0] : v;
              }
              return out;
            });
            if (rows.length === 0) continue;
            const keys = Object.keys(rows[0] as object);
            next.push({
              id: `${id}-${indexedSheets}`,
              name: hasMultipleSheets ? `${file.name} — ${sheetName}` : file.name,
              size: file.size,
              format: 'structured',
              rows,
              keys,
              titleKey: keys[0],
              contentKeys: keys,
              contentSeparator: ', ',
              metadataKeys: keys.slice(1),
              globalMetadata: [],
              indexAsTabular: true,
            });
            indexedSheets++;
          }
          if (indexedSheets === 0) {
            toast.error(`Could not find tabular rows in ${file.name}.`);
          }
        } else if (ext === 'json') {
          const content = await file.text();
          try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
              const keys = Object.keys(parsed[0]);
              next.push({
                id,
                name: file.name,
                size: file.size,
                format: 'structured',
                rows: parsed,
                keys,
                titleKey: keys[0],
                contentKeys: keys,
                contentSeparator: ', ',
                metadataKeys: keys.slice(1),
                globalMetadata: [],
                indexAsTabular: true,
              });
            } else {
              next.push({
                id,
                name: file.name,
                size: file.size,
                format: 'plain',
                rawContent: content,
              });
            }
          } catch {
            next.push({
              id,
              name: file.name,
              size: file.size,
              format: 'plain',
              rawContent: content,
            });
          }
        } else if (ext === 'pdf' || ext === 'doc' || ext === 'docx') {
          const formData = new FormData();
          formData.append('file', file);

          const res = await fetch('/api/parse-file', {
            method: 'POST',
            body: formData,
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || `Could not extract text from ${file.name}`);
          }

          const { text } = data;
          if (!text?.trim()) {
            throw new Error(
              'This PDF does not contain selectable text. Try another copy of the file.',
            );
          }
          next.push({
            id,
            name: file.name,
            size: file.size,
            format: 'plain',
            rawContent: text,
            fileObject: file,
            indexImages: indexAllImages,
          });
        } else {
          const content = await file.text();
          next.push({
            id,
            name: file.name,
            size: file.size,
            format: 'plain',
            rawContent: content,
          });
        }
      } catch (err) {
        toast.error(`Could not read ${file.name}. ${formatErrorMessage(err)}`);
      }
    }
    setStaged((prev) => [...prev, ...next]);
    if (joinedActiveSave && next.length > 0) {
      toast.message(`${next.length} file${next.length === 1 ? '' : 's'} added to the queue`);
      window.setTimeout(() => void ingest(), 0);
    }
  }

  async function ingest() {
    if (savingRef.current || stagedRef.current.length === 0) return;
    savingRef.current = true;
    setSaving(true);
    let ok = 0;

    const filesToIngest = [...stagedRef.current];
    const payloads: any[] = [];

    for (const f of filesToIngest) {
      if (f.format === 'structured' && f.rows && f.indexAsTabular) {
        try {
          const res = await fetch('/api/tabular', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: f.name, rows: f.rows }),
          });
          if (res.ok) {
            const result = await res.json();
            toast.success(
              `Saved "${f.name}" as tabular dataset (${result.rowCount} rows, ${result.columns.length} columns)`,
            );
          }
        } catch {
          /* continue — still add as documents */
        }
      }
    }

    // Then: create document payloads
    for (const f of filesToIngest) {
      if (f.format === 'plain' && (f.rawContent || f.name.toLowerCase().endsWith('.pdf'))) {
        let fileUrl = undefined;
        // Upload the physical file so chat can link to it
        if (f.fileObject) {
          try {
            const formData = new FormData();
            formData.append('file', f.fileObject);
            const uploadRes = await fetch('/api/upload-file', {
              method: 'POST',
              body: formData,
            });
            if (uploadRes.ok) {
              const { url } = await uploadRes.json();
              fileUrl = url;
            }
          } catch (err) {
            console.error('Failed to upload file for citation link', err);
          }
        }

        const hasText = f.rawContent && f.rawContent.trim().length > 0;
        const uploadedImages: any[] = [];
        let skippedImageCount = 0;

        // Extract images if requested (for PDFs)
        if (
          f.indexImages &&
          imageIndexingAvailable &&
          f.fileObject &&
          f.name.toLowerCase().endsWith('.pdf')
        ) {
          try {
            setProgress({ message: `Extracting images from ${f.name}...`, current: 0, total: 100 });
            const { extractImagesFromPDF } = await import('@/lib/media/pdf');
            const images = await extractImagesFromPDF(f.fileObject);
            const BATCH_SIZE = 5;
            for (let i = 0; i < images.length; i += BATCH_SIZE) {
              const batch = images.slice(i, i + BATCH_SIZE);

              await Promise.all(
                batch.map(async (img, batchIdx) => {
                  const currentIdx = i + batchIdx;
                  setProgress({
                    message: `Analyzing image ${currentIdx + 1} of ${images.length} from ${
                      f.name
                    }...`,
                    current: currentIdx,
                    total: images.length || 1,
                  });

                  const res = await fetch(img.base64);
                  const blob = await res.blob();
                  const file = new File([blob], `image-${img.index}.jpg`, { type: 'image/jpeg' });

                  const formData = new FormData();
                  formData.append('file', file);
                  const uploadRes = await fetch('/api/upload-file', {
                    method: 'POST',
                    body: formData,
                  });

                  if (uploadRes.ok) {
                    const { url } = await uploadRes.json();

                    let description = '';
                    try {
                      const descRes = await fetch('/api/describe-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          base64: img.base64,
                          prompt:
                            'Create accurate retrieval notes for this PDF visual. Capture the title, every clearly readable heading, label, view name, routine or item name, counts, and parent-child/group relationships. For diagrams, describe connected components and directions. Do not invent unreadable text; say when text is unclear. Use concise labeled bullets so later questions can be answered without re-reading the image.',
                        }),
                      });
                      if (descRes.ok) {
                        const descData = await descRes.json();
                        if (descData.description) {
                          description = descData.description;
                        }
                      }
                    } catch (e) {
                      console.error('Failed to describe image:', e);
                    }

                    if (description.trim()) {
                      uploadedImages.push({
                        imageUrl: url,
                        pageNumber: img.pageNumber,
                        index: img.index,
                        description,
                      });
                    } else {
                      skippedImageCount++;
                    }
                  }
                }),
              );
            }
            // Ensure images remain in original order after concurrent processing
            uploadedImages.sort((a, b) => a.index - b.index);
            if (skippedImageCount > 0) {
              toast.warning(
                `${skippedImageCount} image${skippedImageCount === 1 ? '' : 's'} from ${f.name} could not be analyzed and were not indexed.`,
              );
            }
          } catch (err) {
            console.error('Failed to extract images from PDF:', err);
          }
        }

        if (hasText || uploadedImages.length > 0) {
          let contentStr = hasText ? f.rawContent : `Images extracted from ${f.name}`;
          if (uploadedImages.length > 0) {
            const descriptions = uploadedImages
              .map(
                (img) =>
                  `Image ${img.index + 1} (Page ${img.pageNumber}): ${
                    img.description || 'No description'
                  }`,
              )
              .join('\n');
            contentStr += `\n\nImage Descriptions:\n${descriptions}`;
          }

          payloads.push({
            title: f.name,
            content: contentStr,
            source: 'files',
            url: fileUrl,
            metadata:
              uploadedImages.length > 0
                ? {
                    images: uploadedImages.map((img) => ({
                      imageUrl: img.imageUrl,
                      pageNumber: img.pageNumber,
                      index: img.index,
                      description: img.description,
                    })),
                  }
                : undefined,
          });
        }
      } else if (f.format === 'lines' && f.rawContent) {
        payloads.push({
          title: f.name,
          content: f.rawContent,
          source: 'files',
          metadata: { fileName: f.name, format: 'lines' },
        });
      } else if (f.format === 'structured' && f.rows) {
        const rows = f.rows
          .map((row) => {
            const fields = f.contentKeys?.length
              ? f.contentKeys.map((key) => `${key}: ${String(row[key] ?? '')}`)
              : Object.entries(row).map(([key, value]) => `${key}: ${String(value ?? '')}`);
            return fields.join(f.contentSeparator || ' | ');
          })
          .filter(Boolean);
        const metadata: Record<string, unknown> = { fileName: f.name, rowCount: f.rows.length };
        for (const item of f.globalMetadata ?? []) {
          if (item.key.trim()) metadata[item.key.trim()] = item.value;
        }
        if (rows.length) {
          payloads.push({ title: f.name, content: rows.join('\n'), metadata, source: 'files' });
        }
      }
    }

    setProgress({ message: 'Uploading documents...', current: 0, total: payloads.length || 1 });

    for (const [index, p] of payloads.entries()) {
      try {
        const res = await fetch('/api/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...p, groupId }),
        });
        if (res.ok) ok++;
      } catch {
        /* continue */
      }
      setProgress({
        message: 'Uploading documents...',
        current: index + 1,
        total: payloads.length || 1,
      });
    }

    const stagedCount = filesToIngest.length;
    savingRef.current = false;
    setSaving(false);
    setProgress(null);
    const remaining = stagedRef.current.filter(
      (pending) => !filesToIngest.some((ingested) => ingested.id === pending.id),
    );
    setStaged(remaining);
    if (remaining.length === 0) sessionStorage.removeItem(UPLOAD_QUEUE_KEY);

    // Also explicitly clear the input value just in case
    if (inputRef.current) {
      inputRef.current.value = '';
    }

    if (ok > 0) {
      toast.success(
        `Added ${ok} document${ok > 1 ? 's' : ''} from ${stagedCount} file${
          stagedCount > 1 ? 's' : ''
        }`,
      );
      onAdded();
    } else {
      toast.error('No text or images could be extracted from the uploaded files.');
    }

    if (remaining.length > 0) window.setTimeout(() => void ingest(), 0);
  }

  useEffect(() => {
    onActionChange?.({
      label: saving
        ? 'Add more files'
        : staged.length === 0
          ? 'Save to corpus'
          : staged.length === 1
            ? 'Save 1 file'
            : `Save ${staged.length} files`,
      onClick: saving ? () => inputRef.current?.click() : ingest,
      disabled: !saving && staged.length === 0,
      loading: false,
    });
    return () => onActionChange?.(null);
  }, [staged, saving, onActionChange]);

  function updateEditingFile(patch: Partial<StagedFile>) {
    setStaged((prev) => prev.map((f) => (f.id === editingFileId ? { ...f, ...patch } : f)));
  }

  return (
    <div className="space-y-4 cursor-pointer">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) readFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex w-full flex-col cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors hover:bg-muted/70',
          dragging && 'border-primary bg-accent',
        )}
      >
        <FileUp className="size-6 text-muted-foreground" />
        <span className="text-sm font-medium">Drop files here or click to browse</span>
        <span className="text-xs text-muted-foreground">
          Text, JSON, CSV, Excel, PDF, and Word files
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) readFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {staged.length > 0 && (
        <div className="space-y-2">
          {staged.some((file) => file.name.toLowerCase().endsWith('.pdf')) &&
            imageIndexingCapability &&
            !imageIndexingAvailable && (
              <Alert className="border-amber-500/30 bg-amber-500/5">
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                <AlertTitle>PDF image indexing is unavailable</AlertTitle>
                <AlertDescription>
                  {imageIndexingCapability.message} Configure a vision model in Settings → AI Models
                  to index PDF visuals.
                </AlertDescription>
              </Alert>
            )}
          <div className="flex items-center justify-between px-1">
            <span className="text-[13px] font-medium text-foreground">
              {staged.length} file{staged.length !== 1 ? 's' : ''} staged
            </span>
            <div className="flex items-center gap-4">
              {staged.some((f) => f.name.toLowerCase().endsWith('.pdf')) && (
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={indexAllImages}
                    disabled={!imageIndexingAvailable}
                    onCheckedChange={(val) => {
                      if (!imageIndexingAvailable) return;
                      setIndexAllImages(val);
                      setStaged((p) =>
                        p.map((item) =>
                          item.name.toLowerCase().endsWith('.pdf')
                            ? { ...item, indexImages: val }
                            : item,
                        ),
                      );
                    }}
                    id="global-index-images"
                    className="scale-75 origin-right"
                  />
                  <Label
                    htmlFor="global-index-images"
                    className="text-[11px] text-muted-foreground cursor-pointer"
                  >
                    Index all PDF images
                  </Label>
                </div>
              )}
              <button
                type="button"
                onClick={() => setStaged([])}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Clear All
              </button>
            </div>
          </div>
          <ul className="space-y-1.5 max-h-87.5 overflow-y-auto pr-1">
            {staged.map((f) => (
              <li
                key={f.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <span className="truncate font-mono text-xs">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {f.format === 'structured'
                        ? 'STRUCTURED'
                        : f.format === 'lines'
                          ? 'SPLIT BY LINE'
                          : 'PLAIN TEXT'}
                      {f.format === 'structured' && ` • ${f.rows?.length} ROWS`}
                      {f.indexAsTabular && ' • TABULAR'}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {(f.size / 1024).toFixed(1)} KB
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Tabular indexing toggle for structured files */}
                    {f.format === 'structured' && (
                      <button
                        type="button"
                        aria-label="Toggle tabular indexing"
                        title={
                          f.indexAsTabular
                            ? 'Tabular indexing ON'
                            : 'Enable tabular indexing for data analysis'
                        }
                        onClick={() =>
                          setStaged((p) =>
                            p.map((item) =>
                              item.id === f.id
                                ? { ...item, indexAsTabular: !item.indexAsTabular }
                                : item,
                            ),
                          )
                        }
                        className={cn(
                          'p-1.5 border rounded-md transition-colors cursor-pointer',
                          f.indexAsTabular
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'bg-secondary text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                        )}
                      >
                        <Database className="size-3.5" />
                      </button>
                    )}
                    {/* Image indexing toggle for PDF files */}
                    {f.name.toLowerCase().endsWith('.pdf') && (
                      <TooltipProvider delay={0}>
                        <Tooltip>
                          <TooltipTrigger
                            type="button"
                            aria-label="Toggle image indexing"
                            aria-pressed={Boolean(f.indexImages)}
                            disabled={!imageIndexingAvailable}
                            onClick={() => {
                              if (!imageIndexingAvailable) return;
                              setStaged((p) =>
                                p.map((item) =>
                                  item.id === f.id
                                    ? { ...item, indexImages: !item.indexImages }
                                    : item,
                                ),
                              );
                            }}
                            className={cn(
                              'p-1.5 border rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
                              f.indexImages
                                ? 'bg-blue-100 border-blue-300 text-blue-600 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-400'
                                : 'bg-secondary text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                            )}
                          >
                            <ImageIcon className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs">
                              {f.indexImages
                                ? 'Image indexing ON'
                                : 'Extract and index images from PDF'}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <button
                      type="button"
                      aria-label={`Configure ${f.name}`}
                      onClick={() => setEditingFileId(f.id)}
                      className="p-1.5 bg-secondary cursor-pointer border text-muted-foreground hover:bg-muted/50 hover:text-foreground rounded-md transition-colors"
                    >
                      <Settings2 className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setStaged((p) => p.filter((item) => item.id !== f.id))}
                      className="p-1.5 border bg-muted hover:bg-muted/50 cursor-pointer text-muted-foreground hover:text-foreground rounded-md transition-colors"
                    >
                      <X className="size-3.5 text-red-500" />
                    </button>
                  </div>
                </div>

                {/* Tabular preview for structured files with tabular indexing */}
                {f.format === 'structured' && f.indexAsTabular && f.rows && (
                  <div className="min-w-0 w-full mt-1">
                    <TabularPreview rows={f.rows} maxPreviewRows={5} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {progress && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progress.message || 'Processing...'}</span>
            <span className="tabular-nums font-mono">
              {progress.current} / {progress.total}
            </span>
          </div>
          <Progress value={(progress.current / progress.total) * 100} />
        </div>
      )}

      {!onActionChange && (
        <Button onClick={ingest} disabled={saving || staged.length === 0}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
          {saving && progress
            ? `Adding ${progress.current} of ${progress.total}`
            : `Add ${staged.length > 0 ? staged.length : ''} file${
                staged.length === 1 ? '' : 's'
              } to corpus`}
        </Button>
      )}

      {/* Mapping Dialog */}
      <Dialog open={!!editingFile} onOpenChange={(open) => !open && setEditingFileId(null)}>
        <DialogContent className="sm:max-w-xl max-h-[80%]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Columns className="size-4 text-primary" />
              Configure Ingestion
            </DialogTitle>
          </DialogHeader>

          {editingFile && (
            <div
              className="py-4 space-y-6 overflow-y-auto pr-2"
              style={{ maxHeight: 'calc(80vh - 120px)' }}
            >
              {editingFile.format === 'structured' ? (
                <>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Title Column</Label>
                      <Select
                        value={editingFile.titleKey}
                        onValueChange={(val) => updateEditingFile({ titleKey: val || undefined })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select column" />
                        </SelectTrigger>
                        <SelectContent>
                          {editingFile.keys?.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        Used as the document name.
                      </p>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <Label>Content Columns</Label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-[10px] uppercase font-medium text-primary hover:underline cursor-pointer"
                            onClick={() => {
                              updateEditingFile({
                                contentKeys: editingFile.keys || [],
                              });
                            }}
                          >
                            Select All
                          </button>
                          <span className="text-muted-foreground text-[10px]">|</span>
                          <button
                            type="button"
                            className="text-[10px] uppercase font-medium text-muted-foreground hover:underline cursor-pointer"
                            onClick={() => {
                              updateEditingFile({ contentKeys: [] });
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-2 -mt-1">
                        Selected columns will be combined to form the searchable content.
                      </p>
                      <div className="max-h-30 overflow-y-auto space-y-2 pr-2">
                        {editingFile.keys?.map((k) => {
                          const isSelected = editingFile.contentKeys?.includes(k);
                          return (
                            <div key={k} className="flex items-center space-x-2">
                              <Checkbox
                                id={`content-${k}`}
                                checked={isSelected}
                                onCheckedChange={(checked) => {
                                  const current = editingFile.contentKeys || [];
                                  if (checked) {
                                    updateEditingFile({
                                      contentKeys: [...current, k],
                                    });
                                  } else {
                                    updateEditingFile({
                                      contentKeys: current.filter((x) => x !== k),
                                    });
                                  }
                                }}
                              />
                              <label
                                htmlFor={`content-${k}`}
                                className="text-sm font-medium leading-none"
                              >
                                {k}
                              </label>
                            </div>
                          );
                        })}
                      </div>

                      {editingFile.contentKeys && editingFile.contentKeys.length > 1 && (
                        <div className="pt-2">
                          <Label className="mb-2 block">Separator</Label>
                          <Select
                            value={editingFile.contentSeparator || ' '}
                            onValueChange={(val) =>
                              updateEditingFile({
                                contentSeparator: val || undefined,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select separator" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value=" ">Space</SelectItem>
                              <SelectItem value=", ">Comma</SelectItem>
                              <SelectItem value="\n">Newline</SelectItem>
                              <SelectItem value=" - ">Hyphen</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <Label>Metadata Columns</Label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="text-[10px] uppercase font-medium text-primary hover:underline cursor-pointer"
                            onClick={() => {
                              const availableKeys =
                                editingFile.keys?.filter((k) => k !== editingFile.titleKey) || [];
                              updateEditingFile({
                                metadataKeys: availableKeys,
                              });
                            }}
                          >
                            Select All
                          </button>
                          <span className="text-muted-foreground text-[10px]">|</span>
                          <button
                            type="button"
                            className="text-[10px] uppercase font-medium text-muted-foreground hover:underline cursor-pointer"
                            onClick={() => {
                              updateEditingFile({ metadataKeys: [] });
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-2 -mt-1">
                        These columns will be stored as searchable metadata.
                      </p>
                      <div className="max-h-30 overflow-y-auto space-y-2 pr-2">
                        {editingFile.keys?.map((k) => {
                          const isSelected = editingFile.metadataKeys?.includes(k);
                          const disabled = k === editingFile.titleKey;
                          return (
                            <div key={k} className="flex items-center space-x-2">
                              <Checkbox
                                id={`meta-${k}`}
                                checked={isSelected}
                                disabled={disabled}
                                onCheckedChange={(checked) => {
                                  const current = editingFile.metadataKeys || [];
                                  if (checked) {
                                    updateEditingFile({
                                      metadataKeys: [...current, k],
                                    });
                                  } else {
                                    updateEditingFile({
                                      metadataKeys: current.filter((x) => x !== k),
                                    });
                                  }
                                }}
                              />
                              <label
                                htmlFor={`meta-${k}`}
                                className={cn(
                                  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
                                  disabled && 'text-muted-foreground',
                                )}
                              >
                                {k} {disabled && '(used)'}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div className="space-y-0.5">
                      <Label>Split by Line</Label>
                      <p className="text-[11px] text-muted-foreground">
                        Treat each line as a completely separate document.
                      </p>
                    </div>
                    <Switch
                      checked={editingFile.format === 'lines'}
                      onCheckedChange={(checked) =>
                        updateEditingFile({
                          format: checked ? 'lines' : 'plain',
                        })
                      }
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label>Global Custom Metadata</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      const current = editingFile.globalMetadata || [];
                      updateEditingFile({
                        globalMetadata: [...current, { key: '', value: '' }],
                      });
                    }}
                  >
                    <Plus className="size-3 mr-1" /> Add Field
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Apply custom key-value pairs to every document generated from this file.
                </p>
                <div className="space-y-2">
                  {(editingFile.globalMetadata || []).map((gm, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder="Key"
                        value={gm.key}
                        className="h-8 text-xs font-mono"
                        onChange={(e) => {
                          const next = [...(editingFile.globalMetadata || [])];
                          next[i].key = e.target.value;
                          updateEditingFile({ globalMetadata: next });
                        }}
                      />
                      <Input
                        placeholder="Value"
                        value={gm.value}
                        className="h-8 text-xs font-mono"
                        onChange={(e) => {
                          const next = [...(editingFile.globalMetadata || [])];
                          next[i].value = e.target.value;
                          updateEditingFile({ globalMetadata: next });
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground shrink-0"
                        onClick={() => {
                          const next = [...(editingFile.globalMetadata || [])];
                          next.splice(i, 1);
                          updateEditingFile({ globalMetadata: next });
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  {(!editingFile.globalMetadata || editingFile.globalMetadata.length === 0) && (
                    <p className="text-xs text-muted-foreground italic text-center py-2">
                      No custom metadata.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pb-2! bg-muted ">
            <Button onClick={() => setEditingFileId(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
