import { describe, expect, it } from 'vitest';
import {
  continuesRecentMediaTopic,
  compactTabularRowsForConversation,
  extractConversationEvidence,
  isTabularFollowUp,
} from './conversation-memory';

describe('continuesRecentMediaTopic', () => {
  const video = { sources: [], images: [], mediaAssetIds: ['video-1'] };

  it('keeps the active video for a standalone factual follow-up', () => {
    expect(continuesRecentMediaTopic('Who scored all goals in order?', video)).toBe(true);
  });

  it('allows an explicit different source to start a new retrieval', () => {
    expect(continuesRecentMediaTopic('What happened in another video?', video)).toBe(false);
  });
});

describe('media conversation evidence', () => {
  it('keeps an indexed PDF image below the compact text-source summary', () => {
    const evidence = extractConversationEvidence([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-searchKnowledgeBase',
            output: {
              hits: [
                { title: 'Schema text', text: 'Views and routines' },
                { title: 'More schema text', text: 'Resources' },
                {
                  title: 'Schema diagram',
                  images: [{ imageUrl: '/api/uploads/schema.png', pageNumber: 3 }],
                },
              ],
            },
          },
        ],
      },
    ]);

    expect(evidence.images).toEqual([
      expect.objectContaining({
        imageUrl: '/api/uploads/schema.png',
        pageNumber: 3,
        title: 'Schema diagram',
      }),
    ]);
  });

  it('keeps a title-matched media source when vector retrieval has no document hits', () => {
    const evidence = extractConversationEvidence([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-searchKnowledgeBase',
            output: {
              hits: [],
              videoEvidence: {
                mediaAssetId: 'video-1',
                retrievalFallback: 'title-matched-media-source',
                evidence: [{ payload: { text: 'The final display establishes the answer.' } }],
              },
            },
          },
        ],
      },
    ]);
    expect(evidence.mediaAssetIds).toEqual(['video-1']);
    expect(evidence.sources).toEqual([
      { title: 'Video evidence', text: 'The final display establishes the answer.' },
    ]);
    expect(continuesRecentMediaTopic('Which team had two goals?', evidence)).toBe(true);
  });

  it('keeps the media source from a dynamic evidence action after reload', () => {
    const evidence = extractConversationEvidence([
      {
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'queryVideoEvidence',
            state: 'output-available',
            output: { success: true, mediaAssetId: 'video-2', evidence: [] },
          },
        ],
      },
    ]);
    expect(evidence.mediaAssetIds).toEqual(['video-2']);
    expect(continuesRecentMediaTopic('What did each person wear?', evidence)).toBe(true);
  });
});

describe('tabular conversation evidence', () => {
  const messages = [
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-queryTabularData',
          input: { datasetId: 'sales-1' },
          output: {
            columns: ['Region', 'Net Revenue'],
            rows: [
              { Region: 'North', 'Net Revenue': 720000 },
              { Region: 'East', 'Net Revenue': 530000 },
              { Region: 'South', 'Net Revenue': 800000 },
              { Region: 'West', 'Net Revenue': 720000 },
            ],
            totalRows: 4,
          },
        },
      ],
    },
    { role: 'assistant', parts: [{ type: 'text', text: 'Here is the distribution by region.' }] },
  ];

  it('retains a bounded table result after a text-only assistant answer', () => {
    const evidence = extractConversationEvidence(messages);
    expect(evidence.tabular).toMatchObject({
      datasetId: 'sales-1',
      columns: ['Region', 'Net Revenue'],
      totalRows: 4,
    });
    expect(evidence.tabular?.rows).toHaveLength(4);
  });

  it('treats a misspelled comparison as a follow-up to the shown table', () => {
    const evidence = extractConversationEvidence(messages);
    expect(isTabularFollowUp('what was the begisst area?', evidence)).toBe(true);
  });

  it('recognizes a meaningful word inside a descriptive table column on a follow-up', () => {
    const evidence = extractConversationEvidence([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-queryTabularData',
            input: { datasetId: 'education-1' },
            output: {
              columns: ['International Bachelor dropout, first 3 semesters'],
              rows: [{ 'International Bachelor dropout, first 3 semesters': '16%' }],
              totalRows: 1,
            },
          },
        ],
      },
    ]);

    expect(isTabularFollowUp('Are the dropout rates administratively observed?', evidence)).toBe(
      true,
    );
  });

  it('bounds verbose table rows before they become follow-up context', () => {
    const rows = compactTabularRowsForConversation(
      Array.from({ length: 100 }, (_, index) => ({
        Institution: `University ${index}`,
        Notes: 'reported metric '.repeat(200),
      })),
      ['Institution', 'Notes'],
    );

    expect(rows).toHaveLength(25);
    expect(JSON.stringify(rows).length).toBeLessThanOrEqual(12_000);
    expect(String(rows[0].Notes)).toHaveLength(360);
  });

  it('does not reuse an active table when the user explicitly changes datasets', () => {
    const evidence = extractConversationEvidence(messages);
    expect(isTabularFollowUp('What is biggest in another dataset?', evidence)).toBe(false);
  });
});
