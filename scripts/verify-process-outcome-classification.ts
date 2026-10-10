import assert from "node:assert/strict";
import { classifyManagedProcessOutcome } from "../src/tools/shellOps.js";

const outcome = (command: string, text: string) =>
  classifyManagedProcessOutcome({ command, text, status: "exited", exitCode: 1, signal: null });
const tap = [
  "ok 24 - refused permission denied request correctly",
  "ok 25 - blocked an invalid token",
  "not ok 26 - release version contract is consistent",
  "  failureType: 'testCodeFailure'",
  "  error: 'release version drift: update src/constants.js with package.json'",
  "  code: 'ERR_ASSERTION'",
  "  name: 'AssertionError'",
].join("\n");
assert.equal(outcome("npm test", tap).outcomeClass, "workload_failure");
assert.equal(outcome("npm test", tap).failureCategory, "workload");
assert.equal(outcome("npx wrangler deploy", "No access to specified service. permission denied").outcomeClass, "auth");
assert.equal(outcome("npm run deploy", "Error: connect ETIMEDOUT").outcomeClass, "network");
assert.equal(outcome("npm run build", "Error: ENOSPC no space left").outcomeClass, "resource_pressure");
assert.equal(classifyManagedProcessOutcome({command:"npm test",text:"not ok 1",status:"exited",exitCode:0,signal:null}).outcomeClass,"success");
assert.equal(classifyManagedProcessOutcome({command:"npm test",text:"not ok 1",status:"lost",exitCode:null,signal:null}).outcomeClass,"runtime_failure");
console.log("Process outcome classification regression PASS");
