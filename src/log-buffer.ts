import type { LogEntry } from "./protocol.js";

export class LogBuffer {
  private readonly maxEntries: number;
  private readonly entries: LogEntry[] = [];
  private lastAckedId = 0;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  getLastAckedId(): number {
    return this.lastAckedId;
  }

  setLastAckedId(id: number): void {
    if (id > this.lastAckedId) {
      this.lastAckedId = id;
      this.prune();
    }
  }

  push(entry: LogEntry): void {
    this.entries.push(entry);
    this.prune();
  }

  getUnacked(): LogEntry[] {
    return this.entries.filter((entry) => entry.id > this.lastAckedId);
  }

  private prune(): void {
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }
}
