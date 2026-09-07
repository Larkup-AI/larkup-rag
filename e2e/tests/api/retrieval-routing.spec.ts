import { expect, test } from '@playwright/test';
import {
  canReuseKnowledgeBaseEvidence,
  hasPriorKnowledgeBaseEvidence,
  isLikelyKnowledgeFollowUp,
  requiresCurrentWebSearch,
  requiresKnowledgeBaseSearch,
  retrievalToolsForStep,
} from '../../../apps/web/lib/chat/retrieval-routing';

const toolNames = [
  'searchKnowledgeBase',
  'webSearch',
  'analyzeImageDeeply',
  'presentMedia',
  'queryTabularData',
  'generateVisualization',
  'executeAnalysis',
];

const postRetrievalTools = [
  'analyzeImageDeeply',
  'presentMedia',
  'queryTabularData',
  'generateVisualization',
  'executeAnalysis',
];

test.describe('Retrieval-only chat routing', () => {
  test('keeps private-index questions local first and never exposes web fallback', () => {
    expect(requiresKnowledgeBaseSearch('What fruit do I like in my indexed notes?')).toBe(true);
    expect(requiresCurrentWebSearch('What fruit do I like in my indexed notes?')).toBe(false);
    expect(
      retrievalToolsForStep({
        stepNumber: 0,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
      }),
    ).toEqual({
      toolChoice: { type: 'tool', toolName: 'searchKnowledgeBase' },
      activeTools: ['searchKnowledgeBase'],
    });
    expect(
      retrievalToolsForStep({
        stepNumber: 1,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
      })?.activeTools,
    ).toEqual(postRetrievalTools);
  });

  test('routes named match results to the knowledge base', () => {
    const question = 'Who won the Argentina Egypt match and what was the score?';
    expect(requiresKnowledgeBaseSearch(question)).toBe(true);
    expect(requiresCurrentWebSearch(question)).toBe(false);
    expect(
      retrievalToolsForStep({
        stepNumber: 0,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
      }),
    ).toEqual({
      toolChoice: { type: 'tool', toolName: 'searchKnowledgeBase' },
      activeTools: ['searchKnowledgeBase'],
    });
    expect(
      retrievalToolsForStep({
        stepNumber: 1,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
      })?.activeTools,
    ).toEqual(postRetrievalTools);
  });

  test('does not expose web search for ordinary conversation', () => {
    expect(requiresKnowledgeBaseSearch('Hello, can you make this sentence friendlier?')).toBe(
      false,
    );
    expect(requiresCurrentWebSearch('Hello, can you make this sentence friendlier?')).toBe(false);
    expect(
      retrievalToolsForStep({
        stepNumber: 0,
        forceKnowledgeBaseSearch: false,
        forceWebSearch: false,
        toolNames,
      })?.activeTools,
    ).toEqual(postRetrievalTools);
  });

  // toolChoice must be explicit 'none' on the final-answer step, not left
  // implicit: an empty activeTools array paired with the top-level
  // streamText toolChoice ('auto') left over from earlier in the request
  // produced a degenerate near-empty model response in production (observed
  // live: 1 output token, no text) instead of a normal final answer.
  test('reserves the last step for an answer after one optional analysis step', () => {
    expect(
      retrievalToolsForStep({
        stepNumber: 2,
        forceKnowledgeBaseSearch: true,
        forceWebSearch: false,
        toolNames,
        finalAnswerStep: 2,
      }),
    ).toEqual({ activeTools: [], toolChoice: 'none' });
  });

  test('reuses successful evidence only for clear conversational follow-ups', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-searchKnowledgeBase',
            output: {
              query: 'internship support',
              hits: [{ title: 'HIP', text: 'Funding details' }],
            },
          },
        ],
      },
    ];

    expect(hasPriorKnowledgeBaseEvidence(messages)).toBe(true);
    expect(isLikelyKnowledgeFollowUp('What about it?')).toBe(true);
    expect(canReuseKnowledgeBaseEvidence('What about it?', messages)).toBe(true);
    expect(canReuseKnowledgeBaseEvidence('What is the Buddy Program?', messages)).toBe(false);
  });

  test('recognizes JSON-wrapped UI tool results as prior evidence', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-searchKnowledgeBase',
            output: { type: 'json', value: { hits: [{ title: 'PDF' }] } },
          },
        ],
      },
    ];

    expect(canReuseKnowledgeBaseEvidence('What about it?', messages)).toBe(true);
  });

  test('reuses evidence if the user repeats exactly the same question', () => {
    const messages = [
      {
        role: 'user',
        content: 'what do i like to eat',
      },
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-searchKnowledgeBase',
            output: { hits: [{ title: 'Food', text: 'You like mango.' }] },
          },
        ],
      },
      {
        role: 'user',
        content: 'what do i like to eat',
      },
    ];

    expect(canReuseKnowledgeBaseEvidence('what do i like to eat', messages)).toBe(true);
  });

  test('does not reuse an empty or failed search result', () => {
    const messages = [
      {
        role: 'assistant',
        toolInvocations: [
          { toolName: 'searchKnowledgeBase', state: 'result', result: { hits: [] } },
        ],
      },
    ];

    expect(hasPriorKnowledgeBaseEvidence(messages)).toBe(false);
    expect(canReuseKnowledgeBaseEvidence('Tell me more about it', messages)).toBe(false);
  });
});
