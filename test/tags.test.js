import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("src/content/scripts/quickarchiver.js", "utf8");

function setup(currentTags = []) {
  const updates = [];
  const context = vm.createContext({
    messenger: { messages: {
      tags: { list: async () => [{key: "customers"}, {key: "work"}] },
      get: async () => ({id: 7, tags: currentTags}),
      update: async (id, properties) => updates.push({id, tags: [...properties.tags]}),
    } },
  });
  vm.runInContext(source, context);
  return {context, updates};
}

test("rule tags merge with fresh message tags and ignore deleted keys", async () => {
  const {context, updates} = setup(["personal", "work"]);
  await vm.runInContext('quickarchiver.applyRuleTags({id: 7, tags: []}, {tags: ["customers", "work", "customers", "deleted"]})', context);
  assert.deepEqual(updates, [{id: 7, tags: ["personal", "work", "customers"]}]);
});

test("old rules, empty selections and already applied tags require no update", async () => {
  const {context, updates} = setup(["work"]);
  for (const rule of [{}, {tags: []}, {tags: ["deleted"]}, {tags: ["work"]}]) {
    context.rule = rule;
    await vm.runInContext('quickarchiver.applyRuleTags({id: 7}, rule)', context);
  }
  assert.deepEqual(updates, []);
});

test("both archive entry points apply tags before moving", async () => {
  for (const method of ["moveMail", "moveMailOrOpenRulePopupIfSameFolder"]) {
    const calls = [];
    const {context} = setup();
    context.calls = calls;
    context.console = {info() {}, warn() {}, error() {}};
    vm.runInContext(`
      quickarchiver.findRule = async () => ({folder: {id: "destination"}, tags: ["work"]});
      quickarchiver.getFolderId = async () => "destination";
      quickarchiver.messageIsInFolder = () => false;
      quickarchiver.applyRuleTags = async () => calls.push("tags");
      messenger.messages.move = async () => calls.push("move");
    `, context);
    await vm.runInContext(`quickarchiver.${method}({id: 7})`, context);
    assert.deepEqual(calls, ["tags", "move"]);
  }
});

const matchingSource = readFileSync("src/content/shared/rule-matching.js", "utf8");

test("classification tags matching incoming messages across all pages without moving", async () => {
  const {context, updates} = setup();
  vm.runInContext(matchingSource, context);
  context.failures = [];
  context.console = {error: (...args) => context.failures.push(args)};
  vm.runInContext(`
    quickarchiver.initRules = async () => {};
    quickarchiver.rules = [{activeFrom: true, from: "customer@example.org", tags: ["customers"]}];
    messenger.messages.continueList = async id => {
      if (id !== "next") throw new Error("Unexpected page");
      return {messages: [{id: 9, author: "customer@example.org"}]};
    };
    messenger.messages.update = async (id, properties) => {
      if (id === 7) throw new Error("Message removed");
      updates.push({id, tags: [...properties.tags]});
    };
  `, context);
  context.updates = updates;
  await vm.runInContext(`quickarchiver.classifyMessages({
    id: "next", messages: [
      {id: 7, author: "customer@example.org"},
      {id: 8, author: "other@example.org"}
    ]
  })`, context);
  assert.equal(context.failures.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{id: 9, tags: ["customers"]}]);
});

test("folder classification skips listing when no rule has tags", async () => {
  const {context} = setup();
  vm.runInContext(`
    quickarchiver.initRules = async () => {};
    quickarchiver.rules = [{activeFrom: true, from: "customer@example.org"}];
    messenger.messages.list = async () => { throw new Error("Should not list"); };
  `, context);
  await vm.runInContext('quickarchiver.classifyFolder({id: "inbox"})', context);
});

test("open folders are classified once even when displayed in multiple tabs", async () => {
  const {context} = setup();
  const folders = [];
  context.folders = folders;
  vm.runInContext(`
    messenger.mailTabs = {query: async () => [
      {displayedFolder: {id: "inbox"}},
      {displayedFolder: {id: "inbox"}},
      {},
      {displayedFolder: {id: "customers"}}
    ]};
    quickarchiver.classifyFolder = async folder => folders.push(folder.id);
  `, context);
  await vm.runInContext('quickarchiver.classifyOpenFolders()', context);
  assert.deepEqual(folders, ["inbox", "customers"]);
});

test("incoming mail and folder listeners register before asynchronous startup", async () => {
  const listeners = {};
  const calls = [];
  const event = name => ({addListener: (listener, ...options) => { listeners[name] = {listener, options}; }});
  const context = vm.createContext({
    quickarchiver: {
      createMenus: () => new Promise(() => {}),
      classifyMessages: async list => calls.push(list),
      classifyFolder: async folder => calls.push(folder),
    },
    messenger: {
      messages: {onNewMailReceived: event("incoming"), onMoved: event("moved")},
      mailTabs: {onDisplayedFolderChanged: event("folder")},
      messageDisplay: {onMessagesDisplayed: event("display")},
      messageDisplayAction: {onClicked: event("click")},
      commands: {onChanged: event("commandChanged"), onCommand: event("command")},
      runtime: {onMessage: event("runtime"), onInstalled: event("installed"), onStartup: event("startup")},
      menus: {onClicked: event("menu")},
    },
  });
  vm.runInContext(readFileSync("src/content/scripts/background.js", "utf8"), context);
  assert.deepEqual(listeners.incoming.options, [true]);
  const page = {messages: [{id: 7}]};
  const folder = {id: "inbox"};
  await listeners.incoming.listener(folder, page);
  await listeners.folder.listener({}, folder);
  assert.deepEqual(calls, [page, folder]);
});
