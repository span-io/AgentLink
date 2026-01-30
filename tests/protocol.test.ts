import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeEnvelope } from "../src/protocol.js";

test("encodeEnvelope serializes message", () => {
  const payload = { value: 123 };
  const json = encodeEnvelope({
    type: "status",
    clientId: "client-1",
    ts: "2025-01-01T00:00:00.000Z",
    payload,
  });

  const parsed = JSON.parse(json) as { type: string; clientId: string; payload: { value: number } };
  assert.equal(parsed.type, "status");
  assert.equal(parsed.clientId, "client-1");
  assert.equal(parsed.payload.value, 123);
});
