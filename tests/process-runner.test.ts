import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCommand } from '../src/process-runner.js'; // We will create this

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
    // Expect: codex exec --skip-git-repo-check --model codex-cli hello world
    // Note: The specific flags depend on logic we port.
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

    // Expect: gemini --model gemini-2.0-flash --approval-mode auto_edit -p "hello gemini"
    assert.strictEqual(result.command, 'gemini');
    assert.ok(result.args.includes('--model'));
    assert.ok(result.args.includes('gemini-2.0-flash'));
    assert.ok(result.args.includes('--approval-mode'));
    assert.ok(result.args.includes('auto_edit'));
    assert.strictEqual(result.promptMode, 'args');
  });

  it('handles stdin prompt mode', () => {
    // We'll need to simulate env var override or pass a config
    // For this test, let's assume we can pass an override to buildCommand
    const result = buildCommand({
      agent: mockAgent,
      prompt: 'long prompt',
      optionsArgs: []
    }, 'stdin');

    assert.strictEqual(result.promptMode, 'stdin');
    // Should NOT have the prompt in args
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
});
