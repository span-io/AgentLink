export type PromptCompactionMode = "auto" | "summary" | "truncate" | "off";

export type PromptCompactionPolicy = {
  maxChars: number;
  thresholdChars: number;
  targetChars: number;
  mode: PromptCompactionMode;
  summaryMaxLines: number;
};

export type PromptCompactionResult = {
  prompt: string;
  originalLength: number;
  finalLength: number;
  action: "none" | "summary" | "truncate";
  reason?: string;
};

const DEFAULT_MAX_CHARS = 200_000;
const DEFAULT_THRESHOLD_RATIO = 0.9;
const DEFAULT_TARGET_RATIO = 0.85;
const DEFAULT_SUMMARY_MAX_LINES = 20;

function parseEnvInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseEnvMode(value: string | undefined): PromptCompactionMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "auto" ||
    normalized === "summary" ||
    normalized === "truncate" ||
    normalized === "off"
  ) {
    return normalized;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

export function resolvePromptCompactionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): PromptCompactionPolicy {
  const maxChars =
    parseEnvInt(resolveEnvValue(env, ["AGENT_LINK_PROMPT_CHAR_LIMIT", "CODEX_PROMPT_CHAR_LIMIT"])) ??
    DEFAULT_MAX_CHARS;

  const thresholdCharsEnv = parseEnvInt(
    resolveEnvValue(env, ["AGENT_LINK_PROMPT_CHAR_THRESHOLD", "CODEX_PROMPT_CHAR_THRESHOLD"]),
  );
  const targetCharsEnv = parseEnvInt(
    resolveEnvValue(env, ["AGENT_LINK_PROMPT_CHAR_TARGET", "CODEX_PROMPT_CHAR_TARGET"]),
  );

  const thresholdChars = thresholdCharsEnv ?? Math.floor(maxChars * DEFAULT_THRESHOLD_RATIO);
  const targetChars = targetCharsEnv ?? Math.floor(maxChars * DEFAULT_TARGET_RATIO);

  const mode =
    parseEnvMode(resolveEnvValue(env, ["AGENT_LINK_PROMPT_COMPACT", "CODEX_PROMPT_COMPACT"])) ??
    "auto";

  const summaryMaxLines =
    parseEnvInt(resolveEnvValue(env, ["AGENT_LINK_PROMPT_SUMMARY_LINES", "CODEX_PROMPT_SUMMARY_LINES"])) ??
    DEFAULT_SUMMARY_MAX_LINES;

  return {
    maxChars,
    thresholdChars: clamp(thresholdChars, 1, maxChars),
    targetChars: clamp(targetChars, 1, maxChars),
    mode,
    summaryMaxLines,
  };
}

function truncateByPreservingEdges(prompt: string, targetChars: number): string {
  if (prompt.length <= targetChars) return prompt;
  const marker = "\n\n[...prompt truncated...]\n\n";
  if (targetChars <= marker.length + 1) {
    return prompt.slice(0, targetChars);
  }
  const available = targetChars - marker.length;
  const headLen = Math.floor(available * 0.6);
  const tailLen = available - headLen;
  return `${prompt.slice(0, headLen)}${marker}${prompt.slice(prompt.length - tailLen)}`;
}

function extractKeyLines(text: string, maxLines: number): string[] {
  const lines = text.split(/\r?\n/);
  const picked: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const isHeading = /^(#+\s+|[*-]\s+|[A-Z][\w\s-]{0,40}:)/.test(line);
    const isSignal = /(ERROR|WARN|WARNING|TODO|FIXME|NOTE|IMPORTANT)/i.test(line);
    if (!isHeading && !isSignal) continue;
    if (line.length > 160) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    picked.push(line);
    if (picked.length >= maxLines) break;
  }

  return picked;
}

function buildSummary(removed: string, maxChars: number, maxLines: number): string {
  if (maxChars <= 0) return "";
  const header = "SUMMARY OF REMOVED CONTENT:\n";
  const lines = extractKeyLines(removed, maxLines);
  const body =
    lines.length > 0
      ? lines.map((line) => `- ${line}`).join("\n")
      : "Summary unavailable; content removed.";
  let summary = `${header}${body}`;
  if (summary.length > maxChars) {
    summary = summary.slice(0, Math.max(0, maxChars - 3)).trimEnd() + "...";
  }
  return summary;
}

function compactWithSummary(prompt: string, targetChars: number, maxLines: number): string {
  if (prompt.length <= targetChars) return prompt;

  const marker = "\n\n[...prompt compacted; middle summarized...]\n\n";
  const spacer = "\n\n";
  let headBudget = Math.floor(targetChars * 0.3);
  let tailBudget = Math.floor(targetChars * 0.3);

  let summaryBudget = targetChars - headBudget - tailBudget - marker.length - spacer.length;
  if (summaryBudget < 50) {
    return truncateByPreservingEdges(prompt, targetChars);
  }

  const head = prompt.slice(0, headBudget);
  const tail = prompt.slice(prompt.length - tailBudget);
  const removed = prompt.slice(headBudget, prompt.length - tailBudget);
  const summary = buildSummary(removed, summaryBudget, maxLines);
  const compacted = `${head}${marker}${summary}${spacer}${tail}`;

  if (compacted.length <= targetChars) {
    return compacted;
  }

  return truncateByPreservingEdges(compacted, targetChars);
}

export function compactPrompt(
  prompt: string,
  policy: PromptCompactionPolicy,
): PromptCompactionResult {
  const originalLength = prompt.length;
  if (originalLength === 0) {
    return { prompt, originalLength, finalLength: 0, action: "none" };
  }

  const maxChars = Math.max(1, policy.maxChars);
  const thresholdChars = clamp(policy.thresholdChars, 1, maxChars);
  const targetChars = clamp(policy.targetChars, 1, maxChars);

  if (originalLength <= thresholdChars) {
    return { prompt, originalLength, finalLength: originalLength, action: "none" };
  }

  if (policy.mode === "off") {
    if (originalLength <= maxChars) {
      return { prompt, originalLength, finalLength: originalLength, action: "none" };
    }
    const truncated = truncateByPreservingEdges(prompt, maxChars);
    return {
      prompt: truncated,
      originalLength,
      finalLength: truncated.length,
      action: "truncate",
      reason: "hard-limit",
    };
  }

  if (policy.mode === "truncate") {
    const truncated = truncateByPreservingEdges(prompt, targetChars);
    return {
      prompt: truncated,
      originalLength,
      finalLength: truncated.length,
      action: "truncate",
      reason: "policy-truncate",
    };
  }

  const summarized = compactWithSummary(prompt, targetChars, policy.summaryMaxLines);
  if (summarized.length <= targetChars) {
    return {
      prompt: summarized,
      originalLength,
      finalLength: summarized.length,
      action: "summary",
      reason: "policy-summary",
    };
  }

  const truncated = truncateByPreservingEdges(summarized, targetChars);
  return {
    prompt: truncated,
    originalLength,
    finalLength: truncated.length,
    action: "truncate",
    reason: "summary-overflow",
  };
}
