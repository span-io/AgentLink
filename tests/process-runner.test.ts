import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCommand, spawnAgentProcess } from '../src/process-runner.js';

describe('Process Runner - buildCommand', () => {
  const mockAgent = {
    id: 'test-agent-123',
    name: 'Test Agent',
    model: 'codex-cli',
  };

  it('builds default command for generic codex model', () => {
    const result = buildCommand({
      agent: mockAgent,
      prompt: 'hello world',
      optionsArgs: []
    });

    assert.strictEqual(result.command, 'codex');
    assert.ok(result.args.includes('exec'));
    assert.ok(result.args.includes('--model'));
    assert.ok(result.args.includes(mockAgent.model));
    assert.ok(result.args.includes('hello world'));
    assert.strictEqual(result.promptMode, 'args');
  });

  it('builds command for gemini model', () => {
    const geminiAgent = { ...mockAgent, model: 'gemini-2.0-flash' };
    const result = buildCommand({
      agent: geminiAgent,
      prompt: 'hello gemini',
      optionsArgs: []
    });

    assert.strictEqual(result.command, 'gemini');
    assert.ok(result.args.includes('--model'));
    assert.ok(result.args.includes('gemini-2.0-flash'));
    assert.ok(result.args.includes('--approval-mode'));
    assert.ok(result.args.includes('auto_edit'));
    assert.strictEqual(result.promptMode, 'args');
  });

  it('handles stdin prompt mode', () => {
    const result = buildCommand({
      agent: mockAgent,
      prompt: 'long prompt',
      optionsArgs: []
    }, 'stdin');

    assert.strictEqual(result.promptMode, 'stdin');
    assert.ok(!result.args.includes('long prompt'));
    assert.ok(result.args.includes('--model'));
  });

  it('injects extra options', () => {
    const result = buildCommand({
      agent: mockAgent,
      prompt: 'hi',
      optionsArgs: ['--verbose', '--custom-flag']
    });

    assert.ok(result.args.includes('--verbose'));
    assert.ok(result.args.includes('--custom-flag'));
  });

  it('blocks spawn when working directory is outside allowed roots', () => {
    const previousRoots = process.env.AGENT_LINK_ALLOWED_WORKDIR_ROOTS;
    const previousCwd = process.env.CODEX_CWD;

    process.env.AGENT_LINK_ALLOWED_WORKDIR_ROOTS = '/tmp/agent-link-safe-root';
    process.env.CODEX_CWD = '/etc';

    assert.throws(
      () =>
        spawnAgentProcess({
          agent: mockAgent,
          prompt: 'hi',
          optionsArgs: [],
          executablePath: '/bin/echo',
        }),
      /outside AGENT_LINK_ALLOWED_WORKDIR_ROOTS/,
    );

    if (previousRoots === undefined) {
      delete process.env.AGENT_LINK_ALLOWED_WORKDIR_ROOTS;
    } else {
      process.env.AGENT_LINK_ALLOWED_WORKDIR_ROOTS = previousRoots;
    }

    if (previousCwd === undefined) {
      delete process.env.CODEX_CWD;
    } else {
      process.env.CODEX_CWD = previousCwd;
    }
  });
});
