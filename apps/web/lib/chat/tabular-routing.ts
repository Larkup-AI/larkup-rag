/**
 * Route sheet questions through the structured query engine before optional
 * code execution. This keeps ordinary Excel/CSV questions independent from
 * the machine's local Python installation.
 */
export function tabularToolsForStep(input: { stepNumber: number; toolNames: string[] }) {
  if (input.stepNumber === 0) {
    return {
      toolChoice: { type: 'tool' as const, toolName: 'queryTabularData' },
      activeTools: ['queryTabularData'],
    };
  }
  if (input.stepNumber === 1) {
    return {
      activeTools: input.toolNames.filter((name) => name !== 'webSearch'),
    };
  }
  return { toolChoice: 'none' as const, activeTools: [] };
}

/**
 * A workspace can contain spreadsheets alongside PDFs, media, and notes.
 * Only force the table path when the wording actually asks for tabular facts;
 * otherwise normal source retrieval remains free to select the right modality.
 */
export function isLikelyTabularQuestion(input: {
  text: string;
  columnNames: string[];
  datasetNames: string[];
}) {
  const text = input.text.trim().toLocaleLowerCase();
  if (!text) return false;
  if (
    /\b(?:spreadsheet|excel|csv|worksheet|sheet|table|dataset|row|column|filter|sort|group(?:ed|ing)?|aggregate|average|mean|median|total|sum|count|highest|lowest|largest|smallest|maximum|minimum|trend|distribution)\b/.test(
      text,
    )
  ) {
    return true;
  }

  const mentionsDataset = input.datasetNames.some((name) => {
    const stem = name
      .replace(/\.(?:csv|xlsx|xls|json)$/i, '')
      .trim()
      .toLocaleLowerCase();
    return stem.length >= 3 && text.includes(stem);
  });
  if (mentionsDataset) return true;

  return input.columnNames.some((column) => {
    const normalized = column.trim().toLocaleLowerCase();
    if (normalized.length >= 4 && text.includes(normalized)) return true;
    const terms = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
    return terms.filter((term) => term.length >= 4 && text.includes(term)).length >= 2;
  });
}
