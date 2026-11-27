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

test("a rule learned from a move can be opened independently of the displayed message", async () => {
  const instance = app();
  const windows = [];
  instance.context.messenger.windows = {create: async options => windows.push(options)};
  instance.run("quickarchiver.refreshColumnAfterMove = () => {}");

  assert.equal(await instance.run("quickarchiver.getLastCreatedRule()"), false);
  await instance.run(`
    quickarchiver.currentRule = {index: 0};
    quickarchiver.handleMovedMessages([
      {author: "first@example.org", folder: {path: "/First", accountId: "work"}},
      {author: "last@example.org", folder: {path: "/Last", accountId: "work"}}
    ]);
  `);
  assert.equal(windows.length, 0);

  await instance.run("quickarchiver.getLastCreatedRule().then(rule => quickarchiver.openRulePopup(rule))");
  assert.equal(windows[0].url, "content/popup/rule.html?ruleIndex=1");
  assert.equal((await app(instance.data()).run("quickarchiver.getLastCreatedRule()")).from, "last@example.org");

  await instance.run("quickarchiver.deleteRule(1)");
  assert.equal((await instance.run("quickarchiver.getLastCreatedRule()")).from, "first@example.org");
  await instance.run("quickarchiver.deleteRule(0)");
  assert.equal(await instance.run("quickarchiver.getLastCreatedRule()"), false);
});

test("toolbar context menu only shows actions that add a distinct option", async () => {
  const instance = app({
    rules: [
      {activeFrom: true, from: "first@example.org", folder: folder("/Archive")},
      {activeFrom: true, from: "last@example.org", folder: folder("/Archive")},
    ],
  });
  const visible = new Set();
  let refreshes = 0;
  let author = "last@example.org";
  let displayedFolder = folder("/Inbox");
  instance.context.messenger.messageDisplay = {
    getDisplayedMessages: async () => ({messages: [{author, folder: folder("/Archive")}]}),
  };
  instance.context.messenger.mailTabs.get = async () => ({displayedFolder});
  instance.context.messenger.menus = {
    update: async (id, options) => options.visible ? visible.add(id) : visible.delete(id),
    refresh: async () => { refreshes++; },
  };
  const show = async (context = "message_display_action", selectedMessages) => {
    const menuIds = () => [...visible].filter(id => context !== "message_list" || id === "qa_open_destination").sort();
    instance.context.menuInfo = {menuIds: menuIds(), contexts: [context], selectedMessages};
    await instance.run('quickarchiver.updateToolbarMenuVisibility(menuInfo, {id: 5, type: "mail"})');
    return menuIds();
  };

  assert.deepEqual(await show(), ["qa_open_destination"]);
  assert.deepEqual(await show(), ["qa_open_destination"]);
  assert.equal(refreshes, 1);

  displayedFolder = folder("/Archive");
  assert.deepEqual(await show(), []);

  author = "first@example.org";
  assert.deepEqual(await show(), ["qa_edit_last_rule"]);
  displayedFolder = folder("/Inbox");
  assert.deepEqual(await show(), ["qa_edit_last_rule", "qa_open_destination"]);

  author = "unknown@example.org";
  assert.deepEqual(await show(), ["qa_edit_last_rule"]);
  const selected = {author: "first@example.org", folder: folder("/Inbox")};
  assert.deepEqual(await show("message_list", {messages: [selected]}), ["qa_open_destination"]);
  assert.deepEqual(await show("message_list", {messages: [selected, selected]}), []);
});

test("opening the destination uses the clicked tab's message and resolves legacy folders", async () => {
  const instance = app({
    rules: [{activeFrom: true, from: "actual@example.org", folder: {accountId: "work", path: "/Archive"}}],
  });
  const messenger = instance.context.messenger;
  const message = {author: "actual@example.org", folder: folder("/Inbox")};
  const opened = [];
  messenger.messageDisplay = {
    getDisplayedMessages: async tabId => ({messages: tabId === 9 ? [] : [message]}),
  };
  messenger.folders = {query: async () => [folder("/Archive")]};
  messenger.mailTabs.update = async (id, options) => opened.push([id, options.displayedFolderId]);
  messenger.mailTabs.create = async options => opened.push([options.displayedFolderId]);

  await instance.run(`
    (async () => {
      quickarchiver.currentRule = {folder: {id: "wrong-folder"}};
      await quickarchiver.openDestinationFolder({id: 5, type: "mail"});
      await quickarchiver.openDestinationFolder({id: 6, type: "messageDisplay"});
      await quickarchiver.openDestinationFolder({id: 9, type: "mail"});
      await quickarchiver.openDestinationFolder({id: 9, type: "mail"}, {
        messages: [{author: "actual@example.org", folder: {id: "work:/Inbox"}}],
      });
    })();
  `);
  assert.deepEqual(opened, [[5, "work:/Archive"], ["work:/Archive"], [9, "work:/Archive"]]);
});

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
