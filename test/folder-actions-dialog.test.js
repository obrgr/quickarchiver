import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

const folder = (path, accountId = "work") => ({id: `${accountId}:${path}`, path, accountId});
const mapping = (path, tags = [], accountId = "work") => ({folder: folder(path, accountId), tags});

// Small DOM fixture for exercising mapping editing and destination changes.
function element(tag = "div") {
  return {
    tag, children: [], dataset: {}, listeners: {}, value: "", style: {},
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    get options() { return this.children.filter(child => child.tag === "option"); },
    focus() {},
  };
}

function setup() {
  const nodes = Object.fromEntries(["folder-actions", "button-add-folder-action", "inherited-tags", "folder", "tags"]
    .map(id => [id, element()]));
  const descendants = node => [node, ...node.children.flatMap(child => typeof child === "object" ? descendants(child) : [])];
  let listener;
  const context = vm.createContext({
    URL,
    console: {info() {}},
    window: {location: {href: "https://example.org/rule.html"}, addEventListener() {}},
    browser: {i18n: {getMessage: key => key}},
    messenger: {runtime: {onMessage: {addListener: callback => { listener = callback; }}}},
    document: {
      createElement: element,
      createTextNode: text => text,
      getElementById: id => nodes[id] ?? Object.values(nodes).flatMap(descendants).find(node => node.id === id),
      querySelectorAll: selector => Object.values(nodes).flatMap(descendants)
        .filter(node => selector === ".folder-action-select" && node.className === "folder-action-select"),
    },
  });
  for (const path of ["src/content/shared/folder-actions.js", "src/content/popup/rule.js"]) {
    vm.runInContext(readFileSync(path, "utf8"), context);
  }
  const folders = [folder("/Customers", "private"), folder("/Other"), folder("/Customers"), folder("/Customers/Project"), folder("/Customers-old")];
  context.initialFolders = folders;
  context.initialActions = [mapping("/Other", ["unrelated"]), mapping("/Customers", ["customers"]), mapping("/Customers", ["private"], "private")];
  context.destination = folder("/Customers/Project");
  vm.runInContext('selectableFolders = initialFolders; folderActions = initialActions; rule = {folder: destination}; renderFolderActions()', context);
  return {
    nodes, context,
    run: source => vm.runInContext(source, context),
    selects: () => context.document.querySelectorAll(".folder-action-select"),
    changeDestination: folder => listener({command: "transmitSelectedFolder", folder}),
  };
}

test("dialog shows only matching mappings and limits new choices to the destination ancestry", () => {
  const dialog = setup();
  const selects = dialog.selects();
  assert.equal(selects.length, 1);
  assert.equal(selects[0].dataset.actionIndex, 1);
  assert.deepEqual(selects[0].options.map(option => option.value), [2, 3]);
  dialog.run('addFolderAction()');
  assert.equal(dialog.selects().length, 2);
  assert.equal(dialog.run('folderActions[3].folder.path'), "/Customers/Project");
  assert.equal(dialog.nodes["button-add-folder-action"].disabled, true);
});

test("removing a visible mapping preserves hidden mappings and allows the ancestor to be re-added", () => {
  const dialog = setup();
  const card = dialog.nodes["folder-actions"].children[0];
  card.children[1].children[1].listeners.click();
  const remaining = JSON.parse(dialog.run('JSON.stringify(folderActions)'));
  assert.deepEqual(remaining, [mapping("/Other", ["unrelated"]), mapping("/Customers", ["private"], "private")]);
  assert.equal(dialog.selects().length, 0);
  assert.equal(dialog.nodes["button-add-folder-action"].disabled, false);
  dialog.run('addFolderAction()');
  assert.equal(dialog.run('folderActions[2].folder.path'), "/Customers");
});

test("switching destination updates the editor without discarding other mappings", () => {
  const dialog = setup();
  dialog.changeDestination(folder("/Other"));
  assert.equal(dialog.selects().length, 1);
  assert.equal(dialog.selects()[0].dataset.actionIndex, 0);
  dialog.changeDestination(folder("/Customers/Project", "private"));
  assert.equal(dialog.selects().length, 1);
  assert.equal(dialog.selects()[0].dataset.actionIndex, 2);
  dialog.changeDestination(folder("/Customers-old"));
  assert.equal(dialog.selects().length, 0);
  assert.equal(dialog.run('folderActions.length'), 3);
});
