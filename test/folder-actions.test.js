import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const helpersSource = readFileSync("src/content/shared/folder-actions.js", "utf8");
const appSource = readFileSync("src/content/scripts/quickarchiver.js", "utf8");
const matchingSource = readFileSync("src/content/shared/rule-matching.js", "utf8");
const helpersContext = vm.createContext({});
vm.runInContext(helpersSource, helpersContext);
const helpers = helpersContext.QuickArchiverFolderActions;
const plain = value => JSON.parse(JSON.stringify(value));
const folder = (path, accountId = "work") => ({id: `${accountId}:${path}`, path, accountId});
const action = (path, tags, accountId = "work") => ({folder: folder(path, accountId), tags});

function app(stored = {}) {
  let data = plain(stored);
  const updates = [];
  const context = vm.createContext({
    console: {info() {}, warn() {}, error() {}},
    messenger: {
      storage: {local: {
        get: async () => plain(data),
        set: async values => { data = {...data, ...plain(values)}; },
      }},
      mailTabs: {query: async () => []},
      messages: {
        tags: {list: async () => [{key: "customers"}, {key: "project"}, {key: "direct"}]},
        get: async id => ({id, tags: ["personal"]}),
        update: async (id, properties) => updates.push({id, ...plain(properties)}),
      },
    },
  });
  for (const source of [helpersSource, matchingSource, appSource]) {
    vm.runInContext(source, context);
  }
  return {context, updates, data: () => data, run: source => vm.runInContext(source, context)};
}

test("folder inheritance matches self and descendants, with segment and account boundaries", () => {
  const parent = folder("/Customers");
  assert.equal(helpers.includesFolder(parent, folder("/Customers")), true);
  assert.equal(helpers.includesFolder(parent, folder("/Customers/Project/Invoices")), true);
  assert.equal(helpers.includesFolder(parent, folder("/Customers-old")), false);
  assert.equal(helpers.includesFolder(parent, folder("/Other/Customers")), false);
  assert.equal(helpers.includesFolder(parent, folder("/Customers/Project", "private")), false);
  assert.equal(helpers.includesFolder(parent, {path: "/Customers/Project"}), false);
  assert.equal(helpers.includesFolder(parent, undefined), false);
  assert.equal(helpers.includesFolder(folder("/"), folder("/Customers")), true);
  assert.equal(helpers.includesFolder(folder("/Customers/"), folder("/Customers/Project")), true);
});

test("all ancestor levels add to direct tags and duplicates are removed", () => {
  const result = helpers.tagsForRule({folder: folder("/Customers/Project/Invoices"), tags: ["direct", "customers"]}, [
    action("/Customers", ["customers"]),
    action("/Customers/Project", ["project", "customers"]),
    action("/Customers/Project/Invoices", ["invoices"]),
    action("/Customers/Project/Other", ["other"]),
    action("/Customers", ["private"], "private"),
  ]);
  assert.deepEqual(plain(result), ["direct", "customers", "project", "invoices"]);
  assert.deepEqual(plain(helpers.tagsForRule({folder: folder("/Customers/A")}, [action("/Customers", ["customers"])])), ["customers"]);
});

test("normalization merges duplicate folders and rejects invalid settings", () => {
  const normalized = helpers.normalize([action("/Customers", ["customers", "customers"]), action("/Customers", ["project"])]);
  assert.deepEqual(plain(normalized), [action("/Customers", ["customers", "project"])]);
  for (const invalid of [{}, [null], [{folder: {path: "/Customers"}, tags: []}], [action("Customers", [])], [action("/Customers", [null])]]) {
    assert.throws(() => helpers.normalize(invalid));
  }
});

test("incoming mail gets inherited tags even when the matching rule has no direct tags", async () => {
  const instance = app({
    rules: [{activeFrom: true, from: "customer@example.org", folder: folder("/Customers/Project"), tags: []}],
    folderActions: [action("/Customers", ["customers"]), action("/Customers/Project", ["project"])],
  });
  await instance.run(`quickarchiver.classifyMessages({messages: [
    {id: 1, author: "customer@example.org", folder: {id: "inbox"}},
    {id: 2, author: "other@example.org", folder: {id: "inbox"}}
  ]})`);
  assert.deepEqual(instance.updates, [{id: 1, tags: ["personal", "customers", "project"]}]);
});

test("folder scan runs for inherited-only tags after loading persisted settings", async () => {
  const instance = app({
    rules: [{activeFrom: true, from: "customer@example.org", folder: folder("/Customers/Project")}],
    folderActions: [action("/Customers", ["customers"])],
  });
  instance.context.scanIds = [];
  instance.run(`messenger.messages.list = async id => {
    scanIds.push(id);
    return {messages: [{id: 1, author: "customer@example.org"}]};
  }`);
  await instance.run('quickarchiver.classifyFolder({id: "inbox"})');
  assert.deepEqual([...instance.context.scanIds], ["inbox"]);
  assert.deepEqual(instance.updates, [{id: 1, tags: ["personal", "customers"]}]);
});

test("dialog save persists global mappings separately and reclassifies open folders", async () => {
  const instance = app({rules: [{from: "", to: "", subject: ""}]});
  const mappings = [action("/Customers", ["customers"])];
  instance.context.mappings = mappings;
  instance.context.scans = [];
  instance.run('quickarchiver.classifyOpenFolders = async () => scans.push("scan")');
  const result = await instance.run(`quickarchiver.handleBroadcastMessage({
    command: "requestRuleUpdate",
    rule: {index: 0, from: "customer@example.org", activeFrom: true, folder: ${JSON.stringify(folder("/Customers/A"))}},
    folderActions: mappings
  })`);
  assert.equal(result.saved, true);
  assert.deepEqual(instance.data().folderActions, mappings);
  assert.equal(instance.data().rules[0].folderActions, undefined);
  assert.deepEqual([...instance.context.scans], ["scan"]);
  await instance.run('quickarchiver.applyRuleTags({id: 1}, quickarchiver.rules[0])');
  assert.deepEqual(instance.updates, [{id: 1, tags: ["personal", "customers"]}]);
});

test("backups restore folder mappings and legacy rule arrays remain supported", async () => {
  const instance = app();
  instance.context.backup = {
    rules: [{from: "a@example.org", to: "", subject: "", folder: folder("/Customers/A")}],
    folderActions: [action("/Customers", ["customers"])],
  };
  assert.equal(await instance.run('quickarchiver.importRules(backup)'), true);
  assert.deepEqual(instance.data().folderActions, instance.context.backup.folderActions);
  assert.equal(await instance.run('quickarchiver.importRules(backup.rules)'), true);
  assert.deepEqual(instance.data().folderActions, instance.context.backup.folderActions);
  const previous = instance.data();
  assert.equal(await instance.run('quickarchiver.importRules({rules: backup.rules, folderActions: [null]})'), false);
  assert.deepEqual(instance.data(), previous);
});

test("failed storage writes do not activate edited folder mappings", async () => {
  const instance = app({
    rules: [{from: "a@example.org", to: "", subject: "", folder: folder("/Customers/A")}],
    folderActions: [action("/Customers", ["customers"])],
  });
  await instance.run('quickarchiver.initRules()');
  instance.run('messenger.storage.local.set = async () => { throw new Error("Storage unavailable"); }');
  await assert.rejects(instance.run(`quickarchiver.updateRule(0, {from: "b@example.org"}, [])`), /Storage unavailable/);
  assert.equal(instance.run('quickarchiver.rules[0].from'), "a@example.org");
  assert.deepEqual(plain(instance.run('quickarchiver.folderActions')), [action("/Customers", ["customers"])]);
});

test("all-rules response includes folder mappings and Thunderbird tag metadata", async () => {
  const instance = app({rules: [], folderActions: [action("/Customers", ["customers"])]});
  instance.context.responses = [];
  instance.run('messenger.runtime = {sendMessage: async message => responses.push(message)}');
  await instance.run('quickarchiver.handleBroadcastMessage({command: "requestAllRules"})');
  const response = plain(instance.context.responses[0]);
  assert.deepEqual(response.folderActions, [action("/Customers", ["customers"])]);
  assert.deepEqual(response.tags, [{key: "customers"}, {key: "project"}, {key: "direct"}]);
});

test("deleting a mapping persists by account and path and refreshes inherited tags in the list", async () => {
  const originalRules = [{from: "customer@example.org", to: "", subject: "", folder: folder("/Customers/A"), tags: ["direct"]}];
  const otherMappings = [action("/Other", ["project"]), action("/Customers", ["project"], "private")];
  const instance = app({rules: originalRules, folderActions: [...otherMappings, action("/Customers", ["customers"])]});
  instance.context.responses = [];
  instance.run('messenger.runtime = {sendMessage: async message => responses.push(message)}');
  const result = await instance.run(`quickarchiver.handleBroadcastMessage({command: "requestFolderActionDelete", folder: ${JSON.stringify(folder("/Customers"))}})`);
  assert.equal(result.deleted, true);
  assert.deepEqual(instance.data().folderActions, otherMappings);
  assert.deepEqual(instance.data().rules, originalRules);
  assert.deepEqual(instance.updates, []);
  assert.equal(instance.context.responses[0].command, "transmitAllRules");
  assert.deepEqual(plain(instance.context.responses[0].folderActions), otherMappings);
  assert.equal(await instance.run(`quickarchiver.deleteFolderAction(${JSON.stringify(folder("/Customers"))})`), false);
});

test("failed folder deletion keeps the mapping active and persisted", async () => {
  const mappings = [action("/Customers", ["customers"])];
  const instance = app({rules: [], folderActions: mappings});
  await instance.run('quickarchiver.initRules()');
  instance.run('messenger.storage.local.set = async () => { throw new Error("Storage unavailable"); }');
  await assert.rejects(instance.run(`quickarchiver.deleteFolderAction(${JSON.stringify(folder("/Customers"))})`), /Storage unavailable/);
  assert.deepEqual(instance.data().folderActions, mappings);
  assert.deepEqual(plain(instance.run('quickarchiver.folderActions')), mappings);
});
