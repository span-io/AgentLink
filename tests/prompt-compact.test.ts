import { describe, it } from "node:test";
import assert from "node:assert";
import {
  compactPrompt,
  resolvePromptCompactionPolicy,
  type PromptCompactionPolicy,
} from "../src/prompt-compact.js";

function makePolicy(overrides: Partial<PromptCompactionPolicy> = {}): PromptCompactionPolicy {
  return {
    maxChars: 200,
    thresholdChars: 180,
    targetChars: 160,
    mode: "auto",
    summaryMaxLines: 5,
    ...overrides,
  };
}

describe("prompt compaction", () => {
  it("returns unchanged prompt when under threshold", () => {
    const policy = makePolicy();
    const input = "short prompt";
    const result = compactPrompt(input, policy);
    assert.strictEqual(result.prompt, input);
    assert.strictEqual(result.action, "none");
  });

  it("summarizes when over threshold in auto mode", () => {
    const policy = makePolicy({ thresholdChars: 50, targetChars: 80 });
    const input = [
      "# Title",
      "Some intro",
      "",
      "## Details",
      "Important note: keep this",
      "",
      "TODO: item one",
      "FIXME: item two",
      "",
      "Trailing context",
    ].join("\n");
    const result = compactPrompt(input, policy);
    assert.ok(result.prompt.length <= policy.targetChars);
    assert.strictEqual(result.action, "summary");
  });

  it("truncates when policy is truncate", () => {
    const policy = makePolicy({ thresholdChars: 50, targetChars: 60, mode: "truncate" });
    const input = "x".repeat(200);
    const result = compactPrompt(input, policy);
    assert.ok(result.prompt.length <= policy.targetChars);
    assert.strictEqual(result.action, "truncate");
  });

  it("enforces hard limit even when mode is off", () => {
    const policy = makePolicy({ maxChars: 100, thresholdChars: 90, targetChars: 80, mode: "off" });
    const input = "y".repeat(200);
    const result = compactPrompt(input, policy);
    assert.ok(result.prompt.length <= policy.maxChars);
    assert.strictEqual(result.action, "truncate");
  });

  it("reads env overrides for policy", () => {
    const env = {
      AGENT_LINK_PROMPT_CHAR_LIMIT: "123",
      AGENT_LINK_PROMPT_CHAR_THRESHOLD: "111",
      AGENT_LINK_PROMPT_CHAR_TARGET: "101",
      AGENT_LINK_PROMPT_COMPACT: "truncate",
      AGENT_LINK_PROMPT_SUMMARY_LINES: "7",
    } as NodeJS.ProcessEnv;
    const policy = resolvePromptCompactionPolicy(env);
    assert.strictEqual(policy.maxChars, 123);
    assert.strictEqual(policy.thresholdChars, 111);
    assert.strictEqual(policy.targetChars, 101);
    assert.strictEqual(policy.mode, "truncate");
    assert.strictEqual(policy.summaryMaxLines, 7);
  });
});
