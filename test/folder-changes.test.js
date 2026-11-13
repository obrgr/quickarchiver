import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const plain = value => JSON.parse(JSON.stringify(value));
const folder = (path, accountId = "work", id = `${accountId}:${path}`) => ({id, path, accountId});
function setup(rules, folderActions = []) {
  let stored = plain({rules, folderActions});
  let destinations = [];
  let failWrite = false;
  let writes = 0;
  const context = vm.createContext({
    console,
    messenger: {
      folders: {query: async () => plain(destinations)},
      storage: {local: {
        get: async () => plain(stored),
        set: async values => {
          if (failWrite) throw new Error("Storage unavailable");
          stored = {...stored, ...plain(values)};
          writes++;
        },
      }},
    },
  });
  for (const path of ["src/content/shared/folder-actions.js", "src/content/scripts/quickarchiver.js"]) {
    vm.runInContext(readFileSync(path, "utf8"), context);
  }
  const app = vm.runInContext("quickarchiver", context);
  app.initColumn = async () => {};
  return {
    app, stored: () => stored, writes: () => writes,
    destinations: value => { destinations = value; },
    failWrite: value => { failWrite = value; },
  };
}

test("rename updates exact and nested destinations and folder actions, preserving conditions", async () => {
  const old = folder("/Customers");
  const renamed = folder("/Clients", "work", "opaque-root-id");
  const child = folder("/Clients/A/Invoices", "work", "opaque-child-id");
  const rules = [
    {folder: old, activeAccount: true, accountId: "source", from: "customer", tags: ["direct"]},
    {folder: {accountId: "work", path: "/Customers/A/Invoices"}},
    {folder: old.id},
    {folder: folder("/Customers-old")},
    {folder: folder("/Customers/A", "private")},
  ];
  const fixture = setup(rules, [{folder: old, tags: ["inherited"]}]);
  fixture.destinations([renamed, child]);
  assert.equal(await fixture.app.handleFolderChange(old, renamed), true);
  const result = fixture.stored();
  assert.deepEqual(result.rules.slice(0, 3).map(rule => rule.folder), [renamed, child, renamed]);
  assert.deepEqual(result.rules.slice(3), rules.slice(3));
  assert.equal(result.rules[0].accountId, "source");
  assert.equal(result.rules[0].activeAccount, true);
  assert.deepEqual(result.rules[0].tags, ["direct"]);
  assert.deepEqual(result.folderActions[0].folder, renamed);
  assert.deepEqual(result.folderActions[0].tags, ["inherited"]);
  const writes = fixture.writes();
  assert.equal(await fixture.app.handleFolderChange(old, renamed), false);
  assert.equal(fixture.writes(), writes);
});

test("move updates account-relative paths and real IDs without changing account conditions", async () => {
  const old = folder("/Projects");
  const moved = folder("/Archive/Projects", "local");
  const child = folder("/Archive/Projects/A", "local");
  const fixture = setup([{folder: folder("/Projects/A"), activeAccount: true, accountId: "work"}]);
  fixture.destinations([moved, child]);
  await fixture.app.handleFolderChange(old, moved);
  assert.deepEqual(fixture.stored().rules[0], {folder: child, activeAccount: true, accountId: "work"});
});

test("missing descendants leave the entire database unchanged and the queue recovers", async () => {
  const old = folder("/Projects");
  const moved = folder("/Archive/Projects");
  const rules = [{folder: old}, {folder: folder("/Projects/A")}];
  const fixture = setup(rules);
  fixture.destinations([moved]);
  await assert.rejects(fixture.app.handleFolderChange(old, moved), /Could not resolve/);
  assert.deepEqual(fixture.stored().rules, rules);
  assert.deepEqual(plain(fixture.app.rules), rules);
  assert.equal(fixture.writes(), 0);
  fixture.destinations([moved, folder("/Archive/Projects/A")]);
  assert.equal(await fixture.app.handleFolderChange(old, moved), true);
});

test("storage failures preserve in-memory references and subsequent events still work", async () => {
  const old = folder("/Projects");
  const moved = folder("/Archive/Projects");
  const fixture = setup([{folder: old}]);
  fixture.destinations([moved]);
  fixture.failWrite(true);
  await assert.rejects(fixture.app.handleFolderChange(old, moved), /Storage unavailable/);
  assert.deepEqual(plain(fixture.app.rules), [{folder: old}]);
  fixture.failWrite(false);
  assert.equal(await fixture.app.handleFolderChange(old, moved), true);
});

test("concurrent folder events are processed in order", async () => {
  const old = folder("/Projects");
  const renamed = folder("/Renamed");
  const moved = folder("/Archive/Renamed");
  const fixture = setup([{folder: old}]);
  fixture.destinations([renamed, moved]);
  await Promise.all([
    fixture.app.handleFolderChange(old, renamed),
    fixture.app.handleFolderChange(renamed, moved),
  ]);
  assert.deepEqual(fixture.stored().rules, [{folder: moved}]);
  assert.equal(fixture.writes(), 2);
});
