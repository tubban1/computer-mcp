import assert from "node:assert/strict";
import { RuntimeSessionManager } from "../src/runtime/runtimeSessionManager.js";

let now = Date.parse("2026-10-07T15:00:00.000Z");
const manager = new RuntimeSessionManager({
  now: () => now,
  transientIdleTtlMs: 1_000,
  disconnectedRetentionMs: 2_000,
  maxKnownSessions: 8,
});

manager.beginCall("transient-a", {
  kind: "transient",
  ownerSource: "transport-session",
});
manager.endCall("transient-a");

manager.beginCall("durable-a", {
  kind: "durable",
  ownerSource: "workstream",
});
manager.endCall("durable-a");

let summary = manager.summary();
assert.equal(summary.activeSessions, 2);
assert.equal(summary.transientSessions, 1);
assert.equal(summary.durableSessions, 1);

now += 1_100;
summary = manager.summary();
assert.equal(summary.activeSessions, 1);
assert.equal(summary.disconnectedSessions, 1);
assert.equal(manager.status("transient-a")?.disconnectedAt != null, true);
assert.equal(manager.status("durable-a")?.disconnectedAt, undefined);

now += 2_100;
summary = manager.summary();
assert.equal(summary.knownSessions, 1);
assert.equal(manager.status("transient-a"), null);
assert.equal(manager.status("durable-a")?.kind, "durable");

for (let i = 0; i < 12; i += 1) {
  manager.beginCall("transient-" + i, {
    kind: "transient",
    ownerSource: "mcp-transport",
  });
  manager.endCall("transient-" + i);
  now += 10;
}
summary = manager.summary();
assert.ok(summary.knownSessions <= 8);
assert.equal(summary.durableSessions, 1);

console.log(
  JSON.stringify(
    {
      runtimeSessionLifecycle: "PASS",
      summary,
    },
    null,
    2,
  ),
);
