import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('plugin command surface', () => {
  it('ships a namespaced pipeline command entrypoint in the published plugin root', async () => {
    const commandPath = path.join(repoRoot, 'commands', 'pipeline.md');
    const commandDoc = await readFile(commandPath, 'utf8');

    expect(commandDoc).toContain('# /pipeline-orchestrator-for-codex:pipeline');
    expect(commandDoc).toContain('Use a skill `pipeline-orchestrator-for-codex:pipeline`');
    expect(commandDoc).toContain('Nao dependa de skills globais legadas');
    expect(commandDoc).toContain('quality gate');
    expect(commandDoc).toContain('final validation');
  });
});
