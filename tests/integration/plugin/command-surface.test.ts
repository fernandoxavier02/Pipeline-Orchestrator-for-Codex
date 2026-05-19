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

  it('does not advertise bare /pipeline as a public command surface', async () => {
    const publicFiles = [
      'commands/pipeline.md',
      'commands/brainstorm.md',
      'skills/pipeline/SKILL.md',
      'hooks/hooks.json',
      'hooks/force-pipeline-agents.cjs',
      'hooks/completion-checklist.cjs',
      'hooks/sentinel-hook.cjs',
      'src/cli/pipeline-cli.ts',
    ];

    for (const relativePath of publicFiles) {
      const content = await readFile(path.join(repoRoot, relativePath), 'utf8');

      expect(content, `${relativePath} must not present bare /pipeline as public API`)
        .not.toMatch(/\/pipeline(?!-orchestrator)(?:\s|\[|`|$)/);
    }
  });

  it('documents the real Codex spawn_agent schema without unsupported name metadata', async () => {
    const skillDoc = await readFile(path.join(repoRoot, 'skills', 'pipeline', 'SKILL.md'), 'utf8');

    expect(skillDoc).toContain('spawn_agent');
    expect(skillDoc).toContain('wait_agent');
    expect(skillDoc).toContain('send_input');
    expect(skillDoc).toContain('agent_type: "worker"');
    expect(skillDoc).toContain('message');
    expect(skillDoc).not.toContain('name: "pipeline-orchestrator-for-codex:core:pipeline-controller"');
  });
});
