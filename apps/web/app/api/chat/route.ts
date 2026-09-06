import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { readConfig } from '@larkup/core/config-store';
import { getModelsByType } from '@larkup/core/models-cache';
import {
  toChatDescriptor,
  getDefaultChatModel,
  normalizeNativeChatModelId,
} from '@larkup/core/chat-models/registry';
import { listTabularDatasets } from '@larkup/core/tabular-store';
import { openMcpTools } from '@larkup/core/mcp-store';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createCohere } from '@ai-sdk/cohere';
import { createMistral } from '@ai-sdk/mistral';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { CustomModelConfig } from '@larkup/core/types';
import { getChatTools } from './tools';
import { gatewayProviderOptions } from '@/lib/chat/gateway-fallbacks';
import { canReuseKnowledgeBaseEvidence, retrievalToolsForStep } from '@/lib/chat/retrieval-routing';
import {
  extractConversationEvidence,
  formatConversationEvidence,
  isImagePreviewFollowUp,
  isTabularFollowUp,
  continuesRecentMediaTopic,
} from '@/lib/chat/conversation-memory';
import { PERSONALIZED_RESPONSE_STYLE } from '@/lib/chat/response-style';
import {
  compactToolContextForModel,
  collectAnswerLevelMediaStatements,
  containsAnswerLevelMediaEvidence,
  collectQuestionMatchedDirectClaims,
  recoverEmptyUIMessageStream,
  formatDirectObservationAnswer,
  formatExhaustiveMediaAnswer,
  formatOutcomeMediaAnswer,
  mediaClaimNeedsCorroboration,
  withFinalAnswerNudge,
} from '@/lib/chat/tool-context';
import { requestsVisualization } from '@/lib/chat/tabular-visualization';
import {
  hasRetrievedImageEvidence,
  hasRetrievedPdfEvidence,
  requestsImagePresentation,
  shouldInspectRetrievedImage,
} from '@/lib/chat/visual-routing';
import { collectExhaustiveVideoEvidencePages } from '@/lib/chat/video-rag-routing';
import { executableTools } from '@/lib/chat/tool-registry';
import { normalizeIncomingMessages } from '@/lib/chat/message-input';
import { explicitMediaEvidenceAssetId } from '@/lib/chat/media-retrieval-routing';
import { authorizeEnterpriseAiRequest, trackEnterpriseAiUsage } from '@/lib/enterprise-client';

// A local CPU inspection can legitimately outlive the default server route
// budget. It is still bounded by the evidence tool's narrow time range; this
// merely lets the chat request receive the validated result instead of being
// cut off mid-analysis.
export const maxDuration = 480;

/**
 * Creates an AI SDK language model instance based on the provider and model ID.
 */
function createChatModel(
  provider: string,
  modelId: string,
  apiKey?: string,
  customChatModels?: CustomModelConfig[],
) {
  if (modelId.startsWith('custom:')) {
    const customName = modelId.slice('custom:'.length);
    const custom = (customChatModels ?? []).find((m) => m.modelName === customName);
    if (custom) {
      const customProvider = createOpenAICompatible({
        name: 'custom_chat_provider',
        baseURL: custom.baseUrl,
        apiKey: custom.apiKey || apiKey || undefined,
      });
      return customProvider(custom.modelName);
    }
  }

  const modelName = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;

  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelName);
    case 'cohere':
      return createCohere({ apiKey })(modelName);
    case 'mistral':
      return createMistral({ apiKey })(modelName);
    case 'deepseek':
      return createDeepSeek({ apiKey })(modelName);
    case 'anthropic':
      return createAnthropic({ apiKey })(modelName);
    case 'openai':
      return createOpenAI({ apiKey })(modelName);
    case 'vercel_ai_gateway':
      return createGateway({ apiKey })(modelId);
    default:
      throw new Error(`Unsupported chat provider "${provider}".`);
  }
}

const CHAT_POLICY = `
Answer only from the user's provided material.

For each substantive question, get fresh evidence: use queryTabularData for CSV, Excel, or JSON facts; otherwise use searchKnowledgeBase. For a direct follow-up, reuse the compact recent evidence when it fully covers the request. Use one focused query first. Use code analysis only when the available data tool cannot answer the calculation.

Do not repeat an evidence tool in the same response. After evidence is returned, answer directly or use one appropriate refinement when the evidence action requests it.

Use only returned evidence. If it does not support an answer, do not guess: say briefly that you could not confirm the specific detail in the video. Do not recommend a search engine, public website, or outside source unless the user explicitly asks you to search the web. For video/audio, name the relevant timestamp range when one was returned. Speak as someone who watched the material: never expose retrieval, transcripts, frames, visual observations, models, tools, or analysis steps unless the user explicitly asks how you determined the answer.

${PERSONALIZED_RESPONSE_STYLE}

Keep the answer brief and direct: give the answer first, then only the essential context. Do not repeat tool output, dump rows, or add a table unless the user asks to see data. Use a short list only when it improves clarity.

When the user asks for every item and the media evidence marks its continuation as exhaustive, include every returned item in chronological order. In that case completeness overrides brevity; deduplicate wording but do not summarize items away.

If the user asks for a chart, graph, or visual distribution, ALWAYS use the \`generateVisualization\` tool. Never attempt to draw ASCII charts, output markdown tables as a substitute for a chart, or claim you cannot generate charts.

When search results identify a PDF source without indexed visuals, use inspectPdfPages before answering. It reads and ranks pages locally. Then use analyzePdfPages for visual claims or presentMedia for an explicit page preview.

For media questions, searchKnowledgeBase first, then use an installed evidence-query action with the returned mediaAssetId. Use its active evidence and include supporting time ranges. Inspect or present media only when necessary or explicitly requested.

For a media claim that requires a terminal state, comparison, aggregate, count, or change over time, ordinary retrieval is not enough. Follow claimVerification.rule from the installed evidence action -- it states what the gathered evidence supports for this particular question. Never promote a local observation into a broader conclusion without source coverage.

"Not directly established" means no single record states the answer outright. It does not mean the source is silent. When the evidence contains a trail that leads to the answer -- readings over time, a state and the change to it, two sides of a comparison -- read across it and give the answer, saying how confident you are and citing the moments it rests on. Reserve "the video does not show this" for when the evidence genuinely lacks any bearing on the question, and never use it to describe an answer you could have reasoned to.

For every video claim, distinguish a direct observation from an inference. Do not turn a reaction, mood, body language, or a summary into a factual conclusion without direct supporting evidence. If evidence is incomplete or conflicts, inspect the relevant source range and answer only what it establishes.

When a user explicitly corrects a prior answer about media, acknowledge the correction and use source evidence for later factual answers; never overwrite the source record with a conversational correction.
`;

function latestUserText(messages: UIMessage[]): string {
  const message = [...messages].reverse().find((candidate) => candidate.role === 'user') as any;
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  const parts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
      ? message.content
      : [];
  if (parts.length) {
    return parts
      .filter((part: any) => part.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join(' ');
  }
  return '';
}

/**
 * Drive the investigation from structured tool results, never from a list of
 * domain or language-specific phrases in the user's question.
 */
function mediaEvidenceFlow(
  messages: unknown[],
  recentMediaAssetIds: string[] = [],
  evidenceQueryToolNames: string[] = [],
) {
  const serialized = JSON.stringify(messages);
  return {
    hasMediaAsset: recentMediaAssetIds.length > 0 || /"mediaAssetId"\s*:/.test(serialized),
    hasCompletedEvidence: containsCompletedMediaEvidence(messages),
    evidenceQueries: evidenceQueryToolNames.reduce(
      (count, name) =>
        count + (serialized.match(new RegExp(`"${escapeRegExp(name)}"`, 'g')) ?? []).length,
      0,
    ),
  };
}

/**
 * Tool use is not equally reliable across all chat providers. The host runs
 * the first retrieval deterministically, but the result remains a normal
 * visible tool result and is the only source added to the answer model's
 * context. This is capability- and source-driven: it knows nothing about a
 * specific video, question type, language, person, or expected answer.
 */
function preloadedEvidenceContext(result: unknown, question: string): string {
  const compact = compactToolContextForModel([
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolName: 'searchKnowledgeBase', output: result }],
    },
  ]);
  const output = (compact[0] as any)?.content?.[0]?.output ?? result;
  const unverifiedMedia = findUnverifiedMediaEvidence(result);
  // An ordinary retrieval hit can contain an intermediate caption, OCR read,
  // or stale-looking summary. Once the media capability says that it could
  // not directly establish this claim, that material must not be available
  // to the answer model as a tempting substitute for the evidence gate.
  const safeOutput = unverifiedMedia
    ? {
        mediaEvidenceGate: {
          success: true,
          mediaAssetId: unverifiedMedia.mediaAssetId,
          claimVerification: unverifiedMedia.claimVerification,
          instruction:
            'The media source was found, but this specific claim was not directly established. Do not use any ordinary retrieval text, summary, OCR value, or local observation to answer it. Say only that the detail could not be confirmed from the available video evidence.',
        },
      }
    : output;
  const serialized = typeof safeOutput === 'string' ? safeOutput : JSON.stringify(safeOutput);
  const contextBudget = containsExhaustiveEvidence(safeOutput) ? 120_000 : 24_000;
  const directClaims = unverifiedMedia ? [] : collectQuestionMatchedDirectClaims(result, question);
  const hasEstablishedMediaEvidence = containsAnswerLevelMediaEvidence(result);
  const mediaAssetId = explicitMediaEvidenceAssetId(result);
  if (
    mediaAssetId &&
    directClaims.length === 0 &&
    !hasEstablishedMediaEvidence &&
    !unverifiedMedia
  ) {
    return `\n\nA relevant media source was located (${mediaAssetId}), but no answer-level evidence has been returned yet. Use the installed evidence-query action for that media asset before answering. Do not say that the source has no answer and do not infer an outcome from this locator alone.`;
  }
  return `\n\nVERIFIED SOURCE EVIDENCE FOR THIS TURN:\n${
    directClaims.length > 0
      ? `DIRECTLY ESTABLISHED ANSWER TEXT (preserve its specific identifying details rather than weakening them):\n${directClaims.join(
          '\n',
        )}\n\n`
      : ''
  }${serialized.slice(0, contextBudget)}\n\n${
    unverifiedMedia
      ? 'The evidence gate above is authoritative: do not infer or fill in the answer from omitted retrieval material.'
      : "Answer the user's question directly from this evidence."
  } Do not mention tools, retrieval, frames, transcripts, or analysis.`;
}

function containsExhaustiveEvidence(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return containsExhaustiveEvidence(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsExhaustiveEvidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const continuation = record.continuation;
  if (
    continuation &&
    typeof continuation === 'object' &&
    (continuation as { exhaustive?: unknown }).exhaustive === true
  ) {
    return true;
  }
  return Object.values(record).some(containsExhaustiveEvidence);
}

/**
 * Detect the generic evidence-capability protocol, including results nested
 * inside compacted tool payloads. This deliberately knows nothing about a
 * media domain or a question type.
 */
function findUnverifiedMediaEvidence(value: unknown): {
  mediaAssetId?: string;
  claimVerification: unknown;
} | null {
  if (typeof value === 'string') {
    try {
      return findUnverifiedMediaEvidence(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUnverifiedMediaEvidence(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const verification = record.claimVerification;
  if (
    record.success === true &&
    verification &&
    typeof verification === 'object' &&
    mediaClaimNeedsCorroboration(verification)
  ) {
    return {
      mediaAssetId: typeof record.mediaAssetId === 'string' ? record.mediaAssetId : undefined,
      claimVerification: verification,
    };
  }
  for (const child of Object.values(record)) {
    const found = findUnverifiedMediaEvidence(child);
    if (found) return found;
  }
  return null;
}

function collectDirectReadings(value: unknown): string[] {
  const readings = new Set<string>();
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    const record = candidate as Record<string, unknown>;
    if (record.directObservation && typeof record.directObservation === 'object') {
      const observations = (record.directObservation as { readings?: unknown }).readings;
      if (Array.isArray(observations)) {
        for (const observation of observations) {
          const found =
            observation && typeof observation === 'object'
              ? (observation as { found?: unknown }).found
              : undefined;
          if (typeof found === 'string' && found.trim()) readings.add(found.trim());
        }
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...readings].slice(0, 8);
}

/**
 * Some reasoning-heavy providers can finish a tool-backed turn without ever
 * emitting answer text. Keep the stream structurally valid and insert only
 * evidence that was already directly established; otherwise surface a clear
 * retry message instead of leaving a permanent spinner or an empty answer.
 */
function fallbackAnswerFromEvidence(evidence: unknown, question: string) {
  const established = [
    ...collectQuestionMatchedDirectClaims(evidence, question),
    ...collectDirectReadings(evidence),
  ];
  if (established.length > 0) return established.join('\n');
  const trail = collectAnswerLevelMediaStatements(evidence);
  return trail.length > 0
    ? trail.join('\n')
    : /\p{Script=Arabic}/u.test(question)
      ? 'ماقدرتش أكمل الإجابة دلوقتي. جرّب السؤال تاني.'
      : 'I could not complete the answer just now. Please try the question again.';
}

/** Tool output can be embedded as a compact JSON string before the next model
 * step, so inspect both structured values and safely parseable strings. */
function containsCompletedMediaEvidence(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return containsCompletedMediaEvidence(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsCompletedMediaEvidence);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const evidence = record.videoEvidence;
  if (
    evidence &&
    typeof evidence === 'object' &&
    (evidence as { success?: unknown }).success === true
  )
    return true;
  return Object.values(record).some(containsCompletedMediaEvidence);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function POST(req: Request) {
  const parsedBody: unknown = await req.json();
  const body =
    parsedBody && typeof parsedBody === 'object' ? (parsedBody as Record<string, unknown>) : {};
  const {
    projectId,
    chatModelId: requestedModelId,
    docSessionId,
    docFields,
  } = body as {
    projectId?: string;
    chatModelId?: string;
    docSessionId?: string;
    docFields?: {
      id: string;
      name: string;
      type: string;
      value?: string;
      context?: string;
      placeholder?: string;
    }[];
  };
  const messages = normalizeIncomingMessages(body?.messages) as UIMessage[];
  if (!messages.some((message) => message.role === 'user')) {
    return Response.json({ error: 'At least one user message is required.' }, { status: 400 });
  }

  const config = await readConfig();
  const provider = config.chatProvider || config.embeddingProvider;

  // Fetch dynamic models to resolve defaults
  const gatewayModels = await getModelsByType('language');
  const allChatModels = gatewayModels.map(toChatDescriptor);

  const configuredModelId = requestedModelId || config.chatModelId;
  const chatModelId =
    normalizeNativeChatModelId(provider, configuredModelId) ||
    getDefaultChatModel(allChatModels, provider)?.id ||
    'openai/gpt-4o-mini';

  // The configured provider is authoritative. In particular, a direct Google
  // key must never be routed through the gateway because a model ID has a
  // vendor prefix.
  const resolvedProvider = provider;

  const apiKey = config.chatApiKey || config.embeddingApiKey || undefined;
  const model = createChatModel(
    resolvedProvider,
    chatModelId,
    apiKey,
    config.customChatModels,
  ) as any;

  // Keep only a bounded, compact conversation history.
  const MAX_HISTORY_MESSAGES = 20;
  // The answer model receives only the recent transcript, but follow-up
  // routing can safely inspect a larger window of compact tool references.
  // This preserves the active table/image after dozens of turns without
  // sending those historical tool payloads to the model.
  const EVIDENCE_HISTORY_MESSAGES = 80;
  const messagesToProcess =
    messages.length > MAX_HISTORY_MESSAGES
      ? messages.slice(messages.length - MAX_HISTORY_MESSAGES)
      : messages;
  const evidenceMessages =
    messages.length > EVIDENCE_HISTORY_MESSAGES
      ? messages.slice(messages.length - EVIDENCE_HISTORY_MESSAGES)
      : messages;
  const safeMessages = messagesToProcess
    .map((m) => {
      const anyM = { ...m } as any;

      // Strip IDs and reasoning from conversation history so the API provider doesn't attempt
      // to strictly validate our compacted messages against its original signatures (e.g. o1/o3/Claude).
      delete anyM.id;
      delete anyM.reasoning;
      delete anyM.providerOptions;

      // Tool invocations are rendered UI/execution data, not durable conversation
      // context. Fresh retrieval is required for every substantive question.
      if (anyM.role === 'assistant' && anyM.toolInvocations) {
        delete anyM.toolInvocations;
      }

      if (Array.isArray(anyM.parts)) {
        anyM.parts = anyM.parts.flatMap((part: any) => {
          // Tool calls/results are execution details, not conversation. The
          // model retrieves fresh evidence for substantive questions, so keeping
          // rendered tables, artifacts, and tool UI here only wastes context.
          // Also strip reasoning parts to avoid signature mismatch errors when
          // passing a compacted history back to the model.
          if (
            part.type === 'tool-invocation' ||
            part.type === 'tool-result' ||
            part.type?.startsWith('tool-') ||
            part.type === 'reasoning'
          ) {
            return [];
          }
          // File parts — strip large non-image files (PDF base64)
          if (part.type === 'file') {
            const data = part.data || part.url || '';
            if (typeof data === 'string' && data.length > 5000) {
              const mimeType = (part.mimeType || part.mediaType || '').toLowerCase();
              const isImage = mimeType.startsWith('image/');
              if (!isImage) {
                // Replace with a placeholder
                return {
                  type: 'text',
                  text: `[File attachment: ${
                    mimeType || 'document'
                  } — removed from context for size]`,
                };
              }
            }
          }
          return part;
        });

        // Tool-only assistant entries have no conversational content after
        // compaction and must be omitted instead of adding dummy context.
        if (anyM.role === 'assistant' && anyM.parts.length === 0) {
          anyM.omitFromModelContext = true;
        }
      }

      // Strip PDF attachments from experimental_attachments (base64 data URLs can be many MB)
      if (anyM.experimental_attachments) {
        anyM.experimental_attachments = anyM.experimental_attachments.filter((att: any) => {
          if (att.url && att.url.length > 5000) {
            const isPdf =
              (att.contentType && att.contentType.toLowerCase().includes('pdf')) ||
              (att.name && att.name.toLowerCase().endsWith('.pdf')) ||
              att.url.substring(0, 50).toLowerCase().includes('pdf');

            if (isPdf || !(att.contentType && att.contentType.toLowerCase().startsWith('image/'))) {
              return false;
            }
          }
          return true;
        });
      }

      if (Array.isArray(anyM.content)) {
        anyM.content = anyM.content.filter((part: any) => {
          const data = part.data || part.url || part.text;
          if (typeof data === 'string' && data.length > 5000) {
            const isPdf =
              (part.mimeType && part.mimeType.toLowerCase().includes('pdf')) ||
              (part.contentType && part.contentType.toLowerCase().includes('pdf')) ||
              data.substring(0, 50).toLowerCase().includes('pdf');

            if (
              isPdf ||
              !(part.mimeType?.startsWith('image/') || part.contentType?.startsWith('image/'))
            ) {
              return false;
            }
          }
          return true;
        });
      }

      return anyM;
    })
    .filter((message) => !message.omitFromModelContext);

  let tabularContext = '';
  let hasTabularData = false;
  let tabularColumnNames: string[] = [];
  try {
    const datasets = await listTabularDatasets();
    if (datasets.length > 0) {
      hasTabularData = true;
      tabularColumnNames = datasets.flatMap((dataset) =>
        dataset.columns.map((column) => column.name),
      );
      const visibleDatasets = datasets.slice(0, 8);
      tabularContext = `\n\nAvailable tabular datasets:\n${visibleDatasets
        .map((d) => {
          const visibleColumns = d.columns.slice(0, 60);
          const colDescriptions = visibleColumns
            .map((c) => {
              let desc = `${c.name} (${c.type})`;
              if (c.type === 'date' && c.dateRange) {
                desc += ` [format: ${c.dateRange.format}, range: ${c.dateRange.min} to ${c.dateRange.max}]`;
              }
              if (c.sampleValues && c.sampleValues.length > 0) {
                desc += ` [samples: ${c.sampleValues
                  .slice(0, 3)
                  .map((value) => value.slice(0, 80))
                  .join(', ')}]`;
              }
              return desc;
            })
            .join(', ');
          const hiddenColumns = d.columns.length - visibleColumns.length;
          const sizeHint =
            d.rowCount > 10000
              ? ' ⚠️ LARGE DATASET — use focused filters and aggregations; use code only when the optional code-analysis tool is available.'
              : '';
          return `- Dataset "${d.fileName}" (ID: ${d.id}): ${d.rowCount} rows, ${d.summary.totalColumns} columns.${sizeHint}\n  Columns: ${colDescriptions}${
            hiddenColumns > 0 ? ` (+${hiddenColumns} more; query focused columns only)` : ''
          }`;
        })
        .join('\n')}${
        datasets.length > visibleDatasets.length
          ? `\n- ${datasets.length - visibleDatasets.length} additional datasets omitted; ask the user to identify one if needed.`
          : ''
      }`;
    }
  } catch {
    /* no tabular data */
  }

  let docContext = '';
  if (docSessionId) {
    // Build a rich field listing so the LLM can correctly match semantic meaning to field IDs.
    // Include: ID, name/label, type, current value (if any), and surrounding context text.
    const fieldLines =
      docFields && docFields.length > 0
        ? (docFields as any[])
            .map((f: any) => {
              let line = `- ID: "${f.id}" | Label: "${f.name}" | Type: ${f.type}`;
              if (f.value) line += ` | Current value: "${f.value}"`;
              if (f.context) line += ` | Surrounding text: "${String(f.context).slice(0, 120)}"`;
              if (f.placeholder) line += ` | Placeholder: "${f.placeholder}"`;
              return line;
            })
            .join('\n')
        : 'None detected.';

    docContext = `\n\n[Active Document Session: ${docSessionId}]\nYou are currently editing a document in the Canvas.
The user may ask you to fill out form fields or edit content.
IMPORTANT: Use the exact field IDs listed below when calling "fillDocumentForm". Do NOT invent field IDs.
Available Form Fields (${docFields?.length ?? 0} total):
${fieldLines}`;
  }

  // The generic product prompt lists tools that intentionally are not exposed
  // in this retrieval-only chat. Keeping it out of this request prevents a
  // model from attempting an unavailable sandbox/corpus action and surfacing a
  // technical failure to the user.
  const skillInstructions = (config.skills ?? [])
    .filter((skill) => skill.enabled !== false)
    .map((skill) => {
      const source =
        skill.source === 'inline'
          ? skill.content?.slice(0, 12_000)
          : `Remote skill reference: ${skill.url}`;
      return `## ${skill.name}\n${skill.description}\n${source ?? ''}`;
    })
    .join('\n\n');
  const userText = latestUserText(messagesToProcess);
  const reusableEvidence = extractConversationEvidence(evidenceMessages);
  const isExplicitVideoCorrection =
    /^(?:no|nah),\s+|\b(?:that(?:'s| is) (?:wrong|incorrect)|correction\s*:|actually\s*,|instead\s*,|should be|not .{0,80}\bbut|i meant)\b/i.test(
      userText,
    );
  const imagePreviewFollowUp = isImagePreviewFollowUp(userText, reusableEvidence);
  const tabularFollowUp = isTabularFollowUp(userText, reusableEvidence);
  const canAnswerFromRecentTable = Boolean(
    reusableEvidence.tabular &&
    reusableEvidence.tabular.totalRows <= reusableEvidence.tabular.rows.length,
  );
  // A text answer can reuse a complete bounded result. A visual request must
  // execute the tabular tool so the UI receives a structured chart payload.
  const tabularFollowUpNeedsVisualization = tabularFollowUp && requestsVisualization(userText);
  const continuesMediaTopic =
    !imagePreviewFollowUp &&
    !tabularFollowUp &&
    !isExplicitVideoCorrection &&
    continuesRecentMediaTopic(userText, reusableEvidence);
  const reusesPriorEvidence =
    !imagePreviewFollowUp &&
    !isExplicitVideoCorrection &&
    reusableEvidence.sources.length > 0 &&
    // A video follow-up may look conversational ("what about the shirts?")
    // but it is a new source claim, not an answer continuation.  Reusing the
    // prior RAG result here used to disable every tool for the turn, which
    // prevented the evidence capability from requesting a bounded live read.
    // Keep the rule source-driven: any continuing media topic gets fresh RAG
    // followed by its installed evidence-query action.
    canReuseKnowledgeBaseEvidence(userText, messagesToProcess) &&
    !continuesMediaTopic;
  let systemPrompt =
    (config.systemPrompt ? `USER INSTRUCTIONS:\n${config.systemPrompt}\n` : '') +
    (skillInstructions ? `\nAVAILABLE AGENT SKILLS:\n${skillInstructions}\n` : '') +
    'Never print a tool name, JSON arguments, or tool-call syntax in a user-facing answer. Use tools silently, then give the result in natural language.\n' +
    CHAT_POLICY +
    tabularContext +
    docContext +
    (imagePreviewFollowUp || tabularFollowUp || reusesPriorEvidence || isExplicitVideoCorrection
      ? formatConversationEvidence(reusableEvidence)
      : '');
  const {
    tools: allTools,
    promptFragments: dynamicToolPromptFragments,
    dynamicToolNames,
    dynamicToolWorkflows,
  } = await getChatTools({
    projectId,
    docSessionId,
    config,
    requestText: userText,
    origin: new URL(req.url).origin,
    preferredMediaAssetId: continuesMediaTopic ? reusableEvidence.mediaAssetIds[0] : undefined,
  });
  // Every installed marketplace/Enterprise tool the model may call this turn
  // — generic by construction (dynamicToolNames is whatever getChatTools
  // discovered, never a hardcoded list), so a newly installed tool becomes
  // callable with no change here.
  const dynamicTools = Object.fromEntries(
    dynamicToolNames
      .map((name) => [name, allTools[name]] as const)
      .filter(([, def]) => Boolean(def)),
  );
  if (dynamicToolPromptFragments.length > 0) {
    systemPrompt += `\nINSTALLED TOOLS:\n${dynamicToolPromptFragments.join('\n')}\n`;
  }
  // Provide both RAG tools and Data Analysis tools so the model can handle complex queries (e.g. Excel)
  const builtInTools = executableTools({
    searchKnowledgeBase: allTools.searchKnowledgeBase,
    presentMedia: allTools.presentMedia,
    queryTabularData: allTools.queryTabularData,
    generateVisualization: allTools.generateVisualization,
    ...(allTools.executeAnalysis ? { executeAnalysis: allTools.executeAnalysis } : {}),
    inspectPdfPages: allTools.inspectPdfPages,
    analyzePdfPages: allTools.analyzePdfPages,
    analyzeImageDeeply: allTools.analyzeImageDeeply,
    // Document Canvas actions — must stay available or the model can never
    // call requestDocumentSignature/fillDocumentForm/editDocument and instead
    // falls back to asking the user in plain text.
    fillDocumentForm: allTools.fillDocumentForm,
    editDocument: allTools.editDocument,
    requestDocumentSignature: allTools.requestDocumentSignature,
  });
  const isGreeting =
    /^(hi|hello|hey|thanks|thank you|ok|sure|yes|no|please|help|how are you|good morning|good afternoon|good evening|bye|goodbye)[.!\s]*$/i.test(
      userText.trim(),
    );
  // When tabular data is present, we disable deterministic tool forcing
  // and rely on the model's native tool selection, allowing it to smartly choose
  // between searchKnowledgeBase, queryTabularData, and executeAnalysis.
  // Tool calling is not equally reliable across every supported provider.
  // Make the first evidence lookup deterministic for ordinary chat so the
  // answer model never has to decide whether retrieval is required.
  const forceKnowledgeBaseSearch = Boolean(
    userText.trim() &&
    !isGreeting &&
    !docSessionId &&
    !hasTabularData &&
    !tabularFollowUp &&
    !reusesPriorEvidence &&
    !imagePreviewFollowUp &&
    builtInTools.searchKnowledgeBase,
  );

  if (isGreeting && builtInTools.searchKnowledgeBase) {
    // Completely remove the search tool for simple greetings to guarantee no retrieval overhead
    delete (builtInTools as any).searchKnowledgeBase;
  }

  // Remote MCP connections are opt-in per workspace and their tool names are
  // namespaced by connection. This lets Local Chat use the same connections as
  // Agents without risking collisions with Larkup's built-in tools.
  const mcp = await openMcpTools({ forLocalChat: true });
  for (const failure of mcp.failures) {
    console.warn(`[chat] MCP connection ${failure.connectionId} unavailable: ${failure.message}`);
  }
  const tools = { ...builtInTools, ...dynamicTools, ...mcp.tools };
  const evidenceRefinementTools = dynamicToolNames.filter(
    (name) => dynamicToolWorkflows[name] === 'evidence-refinement' && Boolean(allTools[name]),
  );
  const evidenceQueryTools = dynamicToolNames.filter(
    (name) => dynamicToolWorkflows[name] === 'evidence-query' && Boolean(allTools[name]),
  );
  const toolNames = Object.keys(tools) as Array<keyof typeof tools & string>;

  // Debug: log payload sizes to console in development
  if (process.env.NODE_ENV === 'development') {
    const stringifiedMsgs = JSON.stringify(safeMessages);
  }

  try {
    await authorizeEnterpriseAiRequest(config);
    const responseStream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        let preloadedEvidence: unknown;
        let preloadedVideoEvidence = false;
        const preflightToolCallId = `knowledge-${crypto.randomUUID()}`;

        const previewImage = reusableEvidence.images[0];
        if (imagePreviewFollowUp && previewImage && builtInTools.presentMedia) {
          const previewCallId = `preview-${crypto.randomUUID()}`;
          writer.write({ type: 'start' });
          writer.write({
            type: 'tool-input-available',
            toolCallId: previewCallId,
            toolName: 'presentMedia',
            input: { imageUrl: previewImage.imageUrl },
          });
          let previewOutput: unknown;
          try {
            previewOutput = await (builtInTools.presentMedia as any).execute(
              { imageUrl: previewImage.imageUrl },
              { toolCallId: previewCallId },
            );
          } catch {
            previewOutput = { success: false, error: 'The image preview is not available.' };
          }
          writer.write({
            type: 'tool-output-available',
            toolCallId: previewCallId,
            output: previewOutput,
          });
          const previewSucceeded =
            previewOutput &&
            typeof previewOutput === 'object' &&
            (previewOutput as { success?: unknown }).success === true;
          const answerId = `answer-${crypto.randomUUID()}`;
          writer.write({ type: 'text-start', id: answerId });
          writer.write({
            type: 'text-delta',
            id: answerId,
            delta: previewSucceeded
              ? `Here is the${previewImage.title ? ` ${previewImage.title}` : ''} diagram preview.`
              : 'I could not open that indexed image preview. Please re-index the PDF image and try again.',
          });
          writer.write({ type: 'text-end', id: answerId });
          await mcp.close();
          return;
        }

        if (forceKnowledgeBaseSearch && builtInTools.searchKnowledgeBase) {
          // Open the message ourselves since a tool part is about to stream
          // before streamText runs. Without this, the client sees a tool
          // part with no owning message yet and starts an implicit one of
          // its own, then streamText's own 'start' event opens a second,
          // real message -- rendering as two separate assistant messages
          // (and two duplicate "Searched" blocks) for one turn.
          writer.write({ type: 'start' });
          // Start with a real, visible tool call. This removes provider-specific
          // ambiguity without hiding the source/citation and media progress UI.
          writer.write({
            type: 'tool-input-available',
            toolCallId: preflightToolCallId,
            toolName: 'searchKnowledgeBase',
            input: { query: userText },
          });
          try {
            preloadedEvidence = await (builtInTools.searchKnowledgeBase as any).execute(
              { query: userText },
              { toolCallId: preflightToolCallId },
            );
          } catch (error) {
            preloadedEvidence = {
              query: userText,
              hits: [],
              error: error instanceof Error ? error.message : 'Search could not be completed.',
            };
          }
          writer.write({
            type: 'tool-output-available',
            toolCallId: preflightToolCallId,
            output: preloadedEvidence,
          });

          const mediaAssetId = explicitMediaEvidenceAssetId(preloadedEvidence);
          // Retrieval identifies the source; the installed capability verifies
          // the claim. Dispatch the one unambiguous evidence-query action
          // deterministically so every supported chat model follows the same
          // RAG → live-analysis contract. The action remains a first-class,
          // visible chat tool call (rather than hidden work inside search).
          if (mediaAssetId && evidenceQueryTools.length === 1) {
            const evidenceToolName = evidenceQueryTools[0];
            const evidenceToolCallId = `evidence-${crypto.randomUUID()}`;
            writer.write({
              type: 'tool-input-available',
              toolCallId: evidenceToolCallId,
              toolName: evidenceToolName,
              input: { mediaAssetId, query: userText },
            });
            let videoEvidence: unknown;
            try {
              videoEvidence = await (allTools[evidenceToolName] as any).execute(
                { mediaAssetId, query: userText },
                { toolCallId: evidenceToolCallId },
              );
              videoEvidence = await collectExhaustiveVideoEvidencePages(
                (allTools[evidenceToolName] as any).execute,
                { mediaAssetId, query: userText },
                videoEvidence,
                evidenceToolCallId,
              );
            } catch (error) {
              videoEvidence = {
                success: false,
                mediaAssetId,
                error:
                  error instanceof Error ? error.message : 'Video evidence verification failed.',
              };
            }
            writer.write({
              type: 'tool-output-available',
              toolCallId: evidenceToolCallId,
              output: videoEvidence,
            });
            preloadedVideoEvidence = true;
            preloadedEvidence = {
              ...(preloadedEvidence as Record<string, unknown>),
              videoEvidence,
            };
          }
        }

        const deterministicAnswer = preloadedVideoEvidence
          ? (formatExhaustiveMediaAnswer(preloadedEvidence, userText) ??
            collectQuestionMatchedDirectClaims(preloadedEvidence, userText)[0] ??
            formatOutcomeMediaAnswer(preloadedEvidence, userText) ??
            formatDirectObservationAnswer(preloadedEvidence, userText))
          : undefined;
        if (deterministicAnswer) {
          const answerId = `answer-${crypto.randomUUID()}`;
          writer.write({ type: 'text-start', id: answerId });
          writer.write({ type: 'text-delta', id: answerId, delta: deterministicAnswer });
          writer.write({ type: 'text-end', id: answerId });
          await mcp.close();
          return;
        }

        const result = streamText({
          model,
          // The Gateway owns model failover. Retrying the same quota-limited model
          // only makes the user wait longer and consumes their request allowance.
          maxRetries: 0,
          // The evidence action has its own bounded budget. Once evidence is
          // ready, the answer model must not leave the user waiting forever.
          timeout: preloadedVideoEvidence
            ? {
                // Retrieval and any bounded source check already finished.
                // This last call only turns verified evidence into prose, so a
                // slow provider must yield to the grounded fallback quickly.
                totalMs: 20_000,
                stepMs: 15_000,
                firstChunkMs: 10_000,
                chunkMs: 10_000,
                toolMs: 10_000,
              }
            : {
                totalMs: 45_000,
                stepMs: 35_000,
                firstChunkMs: 25_000,
                chunkMs: 20_000,
                toolMs: 30_000,
              },
          providerOptions: gatewayProviderOptions(resolvedProvider, chatModelId),
          system: `${systemPrompt}${
            preloadedEvidence === undefined
              ? ''
              : preloadedEvidenceContext(preloadedEvidence, userText)
          }`,
          messages: await convertToModelMessages(safeMessages, { tools }),
          // Leave enough room for structured tool inputs (especially charts) and
          // a complete grounded answer while keeping the response bounded.
          maxOutputTokens:
            preloadedEvidence !== undefined && containsExhaustiveEvidence(preloadedEvidence)
              ? 8_000
              : preloadedVideoEvidence
                ? 1_200
                : 2_400,
          // Evidence loop: retrieve → verify → bounded inspect/refinement → retrieve
          // again → answer. The inspection tool itself cannot authorize a claim.
          // Most chats finish after their first answer. The upper bound leaves
          // room for retrieve → verify → inspect → re-verify when a tool result
          // reveals a video claim that needs source-level corroboration.
          stopWhen: stepCountIs(5),
          toolChoice: 'auto',
          prepareStep: ({ stepNumber, messages }) => {
            if (preloadedEvidence !== undefined) {
              const preloadedMediaAssetId = explicitMediaEvidenceAssetId(preloadedEvidence);
              if (
                !preloadedVideoEvidence &&
                preloadedMediaAssetId &&
                evidenceQueryTools.length > 0 &&
                stepNumber === 0
              ) {
                return {
                  ...(evidenceQueryTools.length === 1
                    ? {
                        toolChoice: {
                          type: 'tool' as const,
                          toolName: evidenceQueryTools[0],
                        } as any,
                      }
                    : {}),
                  activeTools: evidenceQueryTools as any,
                  messages: compactToolContextForModel(messages),
                };
              }
              // PDF text retrieval is only a locator. If no visual derivatives
              // were indexed, inspect the original local file on demand and keep
              // the selected page range bounded just as video inspection does.
              if (
                !hasRetrievedImageEvidence(preloadedEvidence) &&
                hasRetrievedPdfEvidence(preloadedEvidence)
              ) {
                if (stepNumber === 0) {
                  return {
                    activeTools: ['inspectPdfPages'],
                    messages: compactToolContextForModel(messages),
                  };
                }
                if (stepNumber === 1) {
                  return requestsImagePresentation(userText)
                    ? {
                        toolChoice: { type: 'tool', toolName: 'presentMedia' },
                        activeTools: ['presentMedia'],
                        messages: compactToolContextForModel(messages),
                      }
                    : {
                        activeTools: ['analyzePdfPages'],
                        messages: compactToolContextForModel(messages),
                      };
                }
                return {
                  toolChoice: 'none' as const,
                  activeTools: [],
                  messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                };
              }
              // A retrieved PDF image is only a navigation hint. Structural
              // questions need one bounded visual read before they can be
              // answered; otherwise the model is forced to guess from captions.
              if (hasRetrievedImageEvidence(preloadedEvidence) && stepNumber === 0) {
                if (requestsImagePresentation(userText)) {
                  return {
                    toolChoice: { type: 'tool', toolName: 'presentMedia' },
                    activeTools: ['presentMedia'],
                    messages: compactToolContextForModel(messages),
                  };
                }
                if (!shouldInspectRetrievedImage(userText, preloadedEvidence)) {
                  return {
                    toolChoice: 'none' as const,
                    activeTools: [],
                    messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                  };
                }
                return {
                  activeTools: ['analyzeImageDeeply'],
                  messages: compactToolContextForModel(messages),
                };
              }
              // The server already gathered the current evidence. Do not rely on
              // the selected model to make (or obey) a second tool call before it
              // can formulate the grounded answer.
              return {
                toolChoice: 'none' as const,
                activeTools: [],
                messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
              };
            }
            if (imagePreviewFollowUp) {
              return stepNumber === 0
                ? {
                    toolChoice: { type: 'tool', toolName: 'presentMedia' },
                    activeTools: ['presentMedia'],
                    messages: compactToolContextForModel(messages),
                  }
                : {
                    toolChoice: 'none' as const,
                    activeTools: [],
                    messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                  };
            }

            if (reusesPriorEvidence) {
              return {
                toolChoice: 'none' as const,
                activeTools: [],
                messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
              };
            }

            if (tabularFollowUp) {
              if (canAnswerFromRecentTable && !tabularFollowUpNeedsVisualization) {
                return {
                  toolChoice: 'none' as const,
                  activeTools: [],
                  messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                };
              }
              return stepNumber === 0
                ? {
                    toolChoice: { type: 'tool', toolName: 'queryTabularData' },
                    activeTools: ['queryTabularData'],
                    messages: compactToolContextForModel(messages),
                  }
                : {
                    toolChoice: 'none' as const,
                    activeTools: [],
                    messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                  };
            }

            if (hasTabularData) {
              if (stepNumber >= 2) {
                return {
                  toolChoice: 'none' as const,
                  activeTools: [],
                  messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                };
              }
              // Allow the model to decide natively between tabular and RAG tools
              return {
                activeTools: toolNames.filter(
                  (name) =>
                    (name as string) !== 'webSearch' && !evidenceQueryTools.includes(name as any),
                ),
                messages: compactToolContextForModel(messages),
              };
            }

            const mediaFlow = mediaEvidenceFlow(
              messages,
              reusableEvidence.mediaAssetIds,
              evidenceQueryTools,
            );
            if (mediaFlow.hasMediaAsset && evidenceQueryTools.length > 0) {
              if (mediaFlow.hasCompletedEvidence) {
                return {
                  toolChoice: 'none' as const,
                  activeTools: [],
                  messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
                };
              }
              if (mediaFlow.evidenceQueries === 0) {
                return {
                  ...(evidenceQueryTools.length === 1
                    ? {
                        toolChoice: {
                          type: 'tool' as const,
                          toolName: evidenceQueryTools[0],
                        } as any,
                      }
                    : {}),
                  activeTools: evidenceQueryTools as any,
                  messages: compactToolContextForModel(messages),
                };
              }
              return {
                toolChoice: 'none' as const,
                activeTools: [],
                messages: withFinalAnswerNudge(compactToolContextForModel(messages)),
              };
            }

            const step = retrievalToolsForStep({
              stepNumber,
              forceKnowledgeBaseSearch,
              forceWebSearch: false,
              toolNames,
              finalAnswerStep: 2,
            });
            const compacted = compactToolContextForModel(messages);
            return {
              ...step,
              messages: step?.toolChoice === 'none' ? withFinalAnswerNudge(compacted) : compacted,
            };
          },
          onFinish: async ({ usage, response }) => {
            try {
              const { trackUsageEvent, estimateCost } =
                await import('@larkup/core/analytics-store');
              const u = usage as any;
              void trackUsageEvent({
                type: 'chat',
                modelId: chatModelId,
                provider: resolvedProvider,
                promptTokens: u?.promptTokens ?? 0,
                completionTokens: u?.completionTokens ?? 0,
                totalTokens: u?.totalTokens ?? 0,
                estimatedCost: estimateCost(
                  chatModelId,
                  u?.promptTokens ?? 0,
                  u?.completionTokens ?? 0,
                ),
                timestamp: new Date().toISOString(),
              });
              trackEnterpriseAiUsage(config, {
                modelId: chatModelId,
                inputTokens: u?.promptTokens ?? 0,
                outputTokens: u?.completionTokens ?? 0,
                costUsd: estimateCost(chatModelId, u?.promptTokens ?? 0, u?.completionTokens ?? 0),
              });
            } finally {
              await mcp.close();
            }
          },
          tools,
        });

        writer.merge(
          result
            .toUIMessageStream({
              // The preflight branch above already sent the message's 'start' event
              // itself (see the comment there) -- a second one here would split the
              // response into two separate assistant messages on the client.
              sendStart: !(forceKnowledgeBaseSearch && builtInTools.searchKnowledgeBase),
              // Reasoning is execution detail; keep the chat focused on the answer
              // and the compact, inspectable evidence UI.
              sendReasoning: false,
              onError: (error: any) => {
                // Extract the deepest error message available
                const rawMessage: string =
                  error?.lastError?.message ||
                  error?.message ||
                  error?.error?.message ||
                  (typeof error === 'string' ? error : '');

                // Only log non-trivial errors to console (skip tool-routing noise)
                const isToolRouting =
                  rawMessage.includes('unavailable tool') || error?.name === 'AI_NoSuchToolError';
                if (!isToolRouting) {
                  console.error('[chat] stream error:', rawMessage);
                }

                // ── Rate limit / quota exceeded ──
                if (
                  rawMessage.includes('rate-limited') ||
                  rawMessage.includes('rate_limit') ||
                  rawMessage.includes('RateLimitError') ||
                  rawMessage.includes('429') ||
                  rawMessage.includes('quota')
                ) {
                  return 'Vercel AI Gateway could not serve this model because it is rate-limited. We tried compatible backup models. Try again shortly, choose another model, or add AI Gateway credits / a provider key in Settings.';
                }

                // ── Model tried to call a tool that was not available in this step ──
                // This happens when the step-routing removes a tool but the model still
                // tries to call it. It is not a real failure — just retry.
                if (isToolRouting) {
                  return 'The model tried an unavailable action. Please try your question again.';
                }

                // ── Authentication / API key errors ──
                if (
                  rawMessage.includes('401') ||
                  rawMessage.includes('Unauthorized') ||
                  rawMessage.includes('Invalid API Key') ||
                  rawMessage.includes('authentication')
                ) {
                  return 'Your API key appears to be invalid or expired. Please check your AI provider settings.';
                }

                // ── Context length / token limit ──
                if (
                  rawMessage.includes('context_length') ||
                  rawMessage.includes('maximum context') ||
                  rawMessage.includes('too many tokens') ||
                  rawMessage.includes('max_tokens')
                ) {
                  return 'The conversation is too long for this model. Try starting a new chat or switching to a model with a larger context window.';
                }

                // ── Timeout ──
                if (rawMessage.includes('timeout') || rawMessage.includes('ETIMEDOUT')) {
                  return 'The request timed out. Please try again.';
                }

                // ── Generic fallback — never expose implementation errors ──
                return 'Something went wrong while generating a response. Please try again.';
              },
            })
            .pipeThrough(
              recoverEmptyUIMessageStream(
                fallbackAnswerFromEvidence(preloadedEvidence, userText),
              )(),
            ),
        );
      },
    });

    return createUIMessageStreamResponse({ stream: responseStream });
  } catch (error) {
    await mcp.close();
    throw error;
  }
}
