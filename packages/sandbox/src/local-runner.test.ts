import { describe, expect, it } from 'vitest';
import { checkLocalRuntime, executeLocally } from './local-runner.js';

describe('executeLocally', () => {
  it('runs JavaScript without Docker and returns output artifacts', async () => {
    const result = await executeLocally({
      language: 'javascript',
      code: `
        const fs = require('node:fs/promises');
        void (async () => {
          await fs.writeFile(process.env.LARKUP_OUTPUT_DIR + '/result.txt', 'done');
          console.log('local runtime');
        })();
      `,
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: expect.stringContaining('local runtime') });
    expect(result.artifacts).toEqual([
      expect.objectContaining({ name: 'result.txt', mimeType: 'text/plain' }),
    ]);
  });

  it('does not mark a bare Python installation as analysis-ready', async () => {
    const health = await checkLocalRuntime();
    expect(health.backend).toBe('local');
    if (health.status === 'ready') {
      expect(health.error).toBeUndefined();
    } else {
      expect(health.error).toMatch(/Python|analysis dependenc/i);
    }
  });
});
