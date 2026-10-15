import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// Integration checks against a local Worker only. Never write test records to production.
const base = new URL(process.argv[2] ?? "http://127.0.0.1:5199");
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Use a local Worker URL.");
let password = process.env.ARCHIVE_TEST_PASSWORD;
if (!password) {
  const vars = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
  password = vars.match(/^ARCHIVE_ADMIN_PASSWORD\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
}
assert(password, "Set ARCHIVE_TEST_PASSWORD or configure local .dev.vars.");
let cookie = "";
const prefix = `__identity_test_${randomUUID()}_`;
async function api(path, method = "GET", body, admin = false) {
  const response = await fetch(new URL(path, base), {
    method, headers: { "Content-Type": "application/json", Connection: "close", ...(admin ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert(response.headers.get("content-type")?.includes("application/json"), `${method} ${path}: ${response.status} ${text}`);
  return { response, status: response.status, body: JSON.parse(text) };
}
const identity = (name, birthDate = "2000-01-02") => ({ name, birthDate });
const record = (name, extra = {}) => ({
  ...identity(name), location: "测试城市", grade: "C", gradeLabel: "稳定共鸣", score: 60,
  compositeScore: 62, performancePercent: 30, dominant: "fire", spell: "炽", character: "测试",
  hiddenTriggered: false, archiveMode: "new", submissionId: randomUUID(), ...extra,
});
async function records() {
  const result = await api("/api/archive", "GET", undefined, true);
  assert.equal(result.status, 200);
  return result.body.records.filter((item) => item.name.startsWith(prefix));
}

const login = await api("/api/archive/session", "POST", { password });
assert.equal(login.status, 200, "Local admin login must succeed.");
cookie = login.response.headers.get("set-cookie").split(";")[0];
try {
  assert.equal((await api("/api/archive")).status, 401);
  assert.equal((await api("/api/archive/identity", "POST", identity(""))).status, 400);
  const name = `${prefix}Alpha`;
  const first = record(name);
  const lookup = await api("/api/archive/identity", "POST", identity(name));
  assert.deepEqual(lookup.body, { exists: false });
  assert.equal(lookup.response.headers.get("cache-control"), "no-store");
  assert.equal((await api("/api/archive", "POST", first)).status, 201);
  assert.deepEqual((await api("/api/archive/identity", "POST", identity(`  ${name.toUpperCase()}  `))).body, { exists: true });
  const [original] = await records();

  // Legacy clients and unconfirmed new submissions cannot overwrite an existing result.
  const legacy = { ...first, score: 1 };
  delete legacy.archiveMode; delete legacy.submissionId;
  assert.equal((await api("/api/archive", "POST", legacy)).status, 409);
  const conflict = await api("/api/archive", "POST", record(name, { score: 2 }));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "IDENTITY_CONFLICT");
  assert.equal((await records())[0].score, original.score);
  // A lost response can be retried without another record or any implicit update.
  assert.equal((await api("/api/archive", "POST", { ...first, score: 3 })).status, 201);
  assert.equal((await records())[0].score, original.score);

  assert.equal((await api("/api/archive", "POST", record(name, { archiveMode: "retest", score: 90 }))).status, 201);
  const [updated] = await records();
  assert.equal(updated.id, original.id);
  assert.equal(updated.createdAt, original.createdAt);
  assert.equal(updated.score, 90);
  assert.equal((await api("/api/archive", "POST", record(name, { birthDate: "2000-01-03" }))).status, 201);
  assert.equal((await api("/api/archive", "POST", record(`${prefix}Different`))).status, 201);
  assert.equal((await records()).length, 3);

  const raceName = `${prefix}Race`;
  const race = await Promise.all([record(raceName), record(raceName)].map((data) => api("/api/archive", "POST", data)));
  assert.deepEqual(race.map((result) => result.status).sort(), [201, 409]);
  assert.equal((await records()).filter((item) => item.name === raceName).length, 1);
  const duplicate = record(`${prefix}Retry`);
  const retry = await Promise.all([api("/api/archive", "POST", duplicate), api("/api/archive", "POST", duplicate)]);
  assert.deepEqual(retry.map((result) => result.status), [201, 201]);
  assert.equal((await records()).filter((item) => item.name === duplicate.name).length, 1);

  assert.equal((await api("/api/archive", "DELETE", { id: original.id }, true)).status, 200);
  assert.deepEqual((await api("/api/archive/identity", "POST", identity(name))).body, { exists: false });
  assert.equal((await api("/api/archive", "POST", record(name, { archiveMode: "retest" }))).status, 201);
  assert.equal((await api("/api/archive", "POST", record(`${prefix}Invalid`, { archiveMode: "overwrite" }))).status, 400);
  assert.equal((await api("/api/archive", "DELETE")).status, 401);
  console.log("PASS: identity privacy/normalization, new and legacy collision protection, confirmed retest, preserved metadata, concurrent creation, idempotent retries, deleted-archive recreation, admin read/delete.");
} finally {
  for (const item of await records()) {
    assert(item.name.startsWith(prefix));
    assert.equal((await api("/api/archive", "DELETE", { id: item.id }, true)).status, 200);
  }
}
