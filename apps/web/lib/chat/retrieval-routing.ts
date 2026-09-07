function isMatchResultQuestion(text: string): boolean {
  return (
    /\b(?:who\s+won|winner|final\s+score|scoreline|match\s+result|what(?:'s|\s+is|\s+was)?\s+the\s+score)\b[\s\S]{0,120}\b(?:match|game|fixture|final|vs?\.?|versus)\b/i.test(
      text,
    ) ||
    /\b(?:match|game|fixture|final|vs?\.?|versus)\b[\s\S]{0,120}\b(?:who\s+won|winner|final\s+score|scoreline|result|score)\b/i.test(
      text,
    )
  );
}

// Up to two words (an adjective, a participle, a compound modifier) between
// a determiner/possessive and the noun it governs -- "my test video", "this
// uploaded recording", "the indexed sales report". A bare `\s+` between the
// two required a direct adjacency that real phrasing rarely uses.
const GAP = '(?:\\s+\\w+){0,2}\\s+';
const MY_FAVORITE_RE = new RegExp(
  `\\b(my|our)${GAP}(favo(?:u)?rite|preference|choice|answer|name|result|score|winner)\\b`,
  'i',
);
const THIS_VIDEO_RE = new RegExp(
  `\\b(?:this|that|the)${GAP}(?:match|video|episode|recording|diagram|chart|image|page|section)\\b`,
  'i',
);
const MY_UPLOAD_RE = new RegExp(
  `\\b(my|our)${GAP}(document|file|data|image|picture|diagram|video|audio|upload|corpus|knowledge|database|db|pdf|report|spreadsheet|presentation)\\b`,
  'i',
);
const THE_DOCUMENT_RE = new RegExp(
  `\\b(the|this|that)${GAP}(document|file|diagram|image|picture|upload|pdf|report)\\b`,
  'i',
);

export function requiresKnowledgeBaseSearch(text: string): boolean {
  const normalized = text.trim();
  if (/^(hi|hello|hey|thanks|thank you|ok|sure|yes|no|please|help)\b/i.test(normalized)) {
    return false;
  }

  return (
    MY_FAVORITE_RE.test(normalized) ||
    /\b(?:what|which|who|where|when|how)\b[\s\S]{0,80}\b(my|our)\b/i.test(normalized) ||
    THIS_VIDEO_RE.test(normalized) ||
    /\b(?:shown|listed|named|counted|under)\b[\s\S]{0,80}\b(?:image|diagram|chart|pdf|document|page|section|resources)\b/i.test(
      normalized,
    ) ||
    MY_UPLOAD_RE.test(normalized) ||
    /\b(?:search|check|query)\s+(?:the\s+)?(?:knowledge base|corpus|database|db)\b/i.test(
      normalized,
    ) ||
    THE_DOCUMENT_RE.test(normalized) ||
    // A named match is commonly a question about an indexed recording. The
    // user does not need to repeat "my video" for every follow-up question.
    isMatchResultQuestion(normalized) ||
    /\b(uploaded?|indexed|scraped|knowledge base|corpus)\b/i.test(normalized) ||
    /\bshow\s+me\b/i.test(normalized)
  );
}

type ChatMessageWithToolParts = {
  role?: string;
  parts?: unknown;
  toolInvocations?: unknown;
};

function resultHasHits(result: unknown): boolean {
  if (typeof result === 'string') {
    try {
      return resultHasHits(JSON.parse(result));
    } catch {
      return false;
    }
  }
  if (
    typeof result === 'object' &&
    result !== null &&
    (result as { type?: string }).type === 'json' &&
    'value' in result
  ) {
    return resultHasHits((result as { value?: unknown }).value);
  }
  return (
    typeof result === 'object' &&
    result !== null &&
    Array.isArray((result as { hits?: unknown }).hits) &&
    (result as { hits: unknown[] }).hits.length > 0
  );
}

/**
 * A follow-up may safely reuse evidence that is still in the conversation.
 * Do not reuse an empty search: a new, more specific wording can surface a
 * relevant chunk on the next attempt.
 */
export function hasPriorKnowledgeBaseEvidence(messages: ChatMessageWithToolParts[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'assistant') return false;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const toolPartsContainHits = parts.some((part: any) => {
      if (part?.type === 'tool-invocation') {
        return (
          part.toolInvocation?.toolName === 'searchKnowledgeBase' &&
          resultHasHits(part.toolInvocation?.result)
        );
      }
      return part?.type === 'tool-searchKnowledgeBase' && resultHasHits(part.output ?? part.result);
    });
    if (toolPartsContainHits) return true;

    const invocations = Array.isArray(message.toolInvocations) ? message.toolInvocations : [];
    return invocations.some(
      (invocation: any) =>
        invocation?.toolName === 'searchKnowledgeBase' && resultHasHits(invocation?.result),
    );
  });
}

function extractMessageText(message: ChatMessageWithToolParts): string {
  const anyM = message as any;
  if (typeof anyM.content === 'string') return anyM.content;
  const parts = Array.isArray(anyM.parts)
    ? anyM.parts
    : Array.isArray(anyM.content)
      ? anyM.content
      : [];
  return parts
    .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
    .map((p: any) => p.text)
    .join(' ');
}

/**
 * Keep retrieval efficient for natural continuations such as "what about it?"
 * while treating every new standalone question as a fresh lookup.
 */
export function isLikelyKnowledgeFollowUp(
  text: string,
  messages?: ChatMessageWithToolParts[],
): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const hasFollowUpKeywords =
    /^(?:and|also|then|so)\b/.test(normalized) ||
    /^(?:tell me more|continue|go on|can you (?:explain|elaborate|clarify))\b/.test(normalized) ||
    /\b(?:it|this|that|they|them|those|these|its|their)\b/.test(normalized);

  if (hasFollowUpKeywords) return true;

  if (messages && messages.length > 0) {
    const userMessages = messages.filter((m) => m.role === 'user');
    if (userMessages.length >= 2) {
      const prevUserText = extractMessageText(userMessages[userMessages.length - 2]);
      if (prevUserText.trim().toLowerCase() === normalized) {
        return true;
      }
    }
  }

  return false;
}

export function canReuseKnowledgeBaseEvidence(
  text: string,
  messages: ChatMessageWithToolParts[],
): boolean {
  return isLikelyKnowledgeFollowUp(text, messages) && hasPriorKnowledgeBaseEvidence(messages);
}

/** The chat workspace is intentionally a retrieval-only experience. */
export function requiresCurrentWebSearch(text: string): boolean {
  void text;
  return false;
}

/** Only the first retrieval is forced. The other source remains available for
 * exactly one recovery attempt; subsequent steps are reserved for analysis and
 * the final answer. */
export function retrievalToolsForStep<ToolName extends string>(options: {
  stepNumber: number;
  forceKnowledgeBaseSearch: boolean;
  forceWebSearch: boolean;
  toolNames: readonly ToolName[];
  /** Reserve this and every later step for the model's final answer. */
  finalAnswerStep?: number;
}):
  | {
      toolChoice?: { type: 'tool'; toolName: ToolName } | 'none';
      activeTools?: ToolName[];
    }
  | undefined {
  const { stepNumber, forceKnowledgeBaseSearch, forceWebSearch, toolNames, finalAnswerStep } =
    options;
  const without = (...blocked: string[]) => toolNames.filter((name) => !blocked.includes(name));

  if (stepNumber === 0 && forceKnowledgeBaseSearch) {
    return {
      toolChoice: { type: 'tool', toolName: 'searchKnowledgeBase' as ToolName },
      activeTools: ['searchKnowledgeBase' as ToolName],
    };
  }
  if (stepNumber === 0 && forceWebSearch) return { activeTools: without('webSearch') };
  if (stepNumber === 0) {
    // If not forced, do not expose searchKnowledgeBase for ordinary conversation.
    return { activeTools: without('webSearch', 'searchKnowledgeBase') };
  }
  if (forceKnowledgeBaseSearch) {
    if (finalAnswerStep !== undefined && stepNumber >= finalAnswerStep) {
      // A stale toolChoice of 'auto' left over from the top-level streamText
      // config paired with zero active tools produced a degenerate
      // near-empty completion (observed live: 1 output token, no text) --
      // be explicit that no tool call is available for this step.
      return { toolChoice: 'none', activeTools: [] };
    }
    return { activeTools: without('searchKnowledgeBase', 'webSearch') };
  }
  if (stepNumber === 1 && forceWebSearch) {
    return { activeTools: without('webSearch') };
  }
  return { activeTools: without('webSearch', 'searchKnowledgeBase') };
}
