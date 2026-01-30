import { test } from "node:test";
import assert from "node:assert/strict";
import { LogBuffer } from "../src/log-buffer.js";

function entry(id: number) {
  return { id, at: new Date().toISOString(), stream: "stdout" as const, message: `msg-${id}` };
}

test("LogBuffer tracks acks and unacked entries", () => {
  const buffer = new LogBuffer(10);
  buffer.push(entry(1));
  buffer.push(entry(2));
  buffer.push(entry(3));

  assert.equal(buffer.getLastAckedId(), 0);
  assert.deepEqual(
    buffer.getUnacked().map((e) => e.id),
    [1, 2, 3]
  );

  buffer.setLastAckedId(2);
  assert.equal(buffer.getLastAckedId(), 2);
  assert.deepEqual(buffer.getUnacked().map((e) => e.id), [3]);
});

test("LogBuffer prunes oldest entries when over capacity", () => {
  const buffer = new LogBuffer(3);
  buffer.push(entry(1));
  buffer.push(entry(2));
  buffer.push(entry(3));
  buffer.push(entry(4));

  assert.deepEqual(
    buffer.getUnacked().map((e) => e.id),
    [2, 3, 4]
  );
});
