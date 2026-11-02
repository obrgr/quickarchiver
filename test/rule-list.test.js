import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";

function element(tag) {
  return {
    tag, children: [], style: {}, text: "",
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.text = ""; this.children = children; },
    set textContent(text) { this.text = text ?? ""; this.children = []; },
    get textContent() { return this.text + this.children.map(child => child.textContent).join(""); },
    createTHead() { return this.appendChild(element("thead")); },
    createTBody() { return this.appendChild(element("tbody")); },
    insertRow() { return this.appendChild(element("tr")); },
    insertCell() { return this.appendChild(element("td")); },
  };
}

function setup(options = {}) {
  let listener;
  const requests = [];
  const alerts = [];
  const nodes = {"rule-list-table": element("div"), "folder-rule-list-table": element("div")};
  const context = vm.createContext({
    console: {info() {}, error() {}, debug(error) { throw error; }},
    confirm: () => options.confirm !== false,
    alert: message => alerts.push(message),
    window: {addEventListener() {}},
    browser: {i18n: {getMessage: key => key}},
    messenger: {runtime: {
      onMessage: {addListener: callback => { listener = callback; }},
      sendMessage: async message => { requests.push(message); return options.response ?? {deleted: true}; },
    }},
    document: {
      createElement: element,
      createTextNode: text => ({textContent: String(text)}),
      getElementById: id => nodes[id],
    },
  });
  for (const path of ["src/content/shared/folder-actions.js", "src/content/tab/htmlSimpleTable.js", "src/content/tab/list.js"]) {
    vm.runInContext(readFileSync(path, "utf8"), context);
  }
  return {nodes, requests, alerts, send: data => listener({command: "transmitAllRules", ...data})};
}

const folder = (path, accountId = "work") => ({path, accountId});
const rows = container => container.children[0].children[1].children;
const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];
const byClass = (node, name) => descendants(node).filter(child => child.className?.split(" ").includes(name));

test("rule list displays direct and inherited tag names, colors and source folders", () => {
  const {nodes, send} = setup();
  send({
    rules: [
      {folder: folder("/Customers/A"), tags: ["direct"]},
      {folder: folder("/Customers/A", "private")},
    ],
    folderActions: [
      {folder: folder("/Customers"), tags: ["customers"]},
      {folder: folder("/Customers/A"), tags: ["customers"]},
    ],
    tags: [{key: "direct", tag: "Important", color: "#ff0000"}, {key: "customers", tag: "Customers", color: "#0000ff"}],
    accounts: [{id: "work", name: "Work"}],
  });
  const entries = byClass(nodes["rule-list-table"], "rule-entry");
  const direct = byClass(entries[0], "rule-direct-tags")[0].children[0];
  assert.equal(direct.textContent, "Important");
  assert.equal(direct.style.color, "#ff0000");
  const inherited = byClass(entries[0], "rule-inherited-tags")[0];
  assert.equal(inherited.children.length, 1);
  assert.equal(inherited.textContent, "Customers");
  assert.equal(inherited.children[0].style.color, "#0000ff");
  assert.equal(inherited.children[0].title, "Work: /Customers\nWork: /Customers/A");
  assert.equal(byClass(entries[1], "rule-inherited-tags")[0].textContent, "—");
  assert.equal(rows(nodes["folder-rule-list-table"]).length, 2);
  assert.equal(rows(nodes["folder-rule-list-table"])[0].children[0].textContent, "Work");
  assert.equal(rows(nodes["folder-rule-list-table"])[0].children[2].textContent, "Customers");
});

test("folder rules remain visible without message rules and clearing them removes stale rows", () => {
  const {nodes, send} = setup();
  send({rules: [], folderActions: [{folder: folder("/Customers"), tags: ["deleted-tag"]}]});
  assert.equal(rows(nodes["folder-rule-list-table"])[0].children[2].textContent, "deleted-tag");
  send({rules: [], folderActions: []});
  assert.equal(nodes["folder-rule-list-table"].children.length, 0);
  assert.equal(nodes["folder-rule-list-table"].textContent, "tab.list.folder.actions.empty");
});

test("deleting a sorted folder row sends its folder identity instead of its row index", async () => {
  const {nodes, requests, alerts, send} = setup();
  send({rules: [], folderActions: [
    {folder: folder("/Z"), tags: []},
    {folder: folder("/A"), tags: []},
  ]});
  const firstRow = rows(nodes["folder-rule-list-table"])[0];
  assert.equal(firstRow.children[1].textContent, "/A");
  await firstRow.children[3].children[0].onclick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].command, "requestFolderActionDelete");
  assert.deepEqual(requests[0].folder, folder("/A"));
  assert.deepEqual(alerts, []);
});

test("cancelling folder deletion leaves the mapping alone", async () => {
  const {nodes, requests, send} = setup({confirm: false});
  send({rules: [], folderActions: [{folder: folder("/A"), tags: []}]});
  await rows(nodes["folder-rule-list-table"])[0].children[3].children[0].onclick();
  assert.deepEqual(requests, []);
  assert.equal(rows(nodes["folder-rule-list-table"]).length, 1);
});

test("failed folder deletion shows an error and allows retry", async () => {
  const {nodes, alerts, send} = setup({response: {deleted: false}});
  send({rules: [], folderActions: [{folder: folder("/A"), tags: []}]});
  const button = rows(nodes["folder-rule-list-table"])[0].children[3].children[0];
  await button.onclick();
  assert.deepEqual(alerts, ["tab.list.folder.actions.delete.error"]);
  assert.equal(button.disabled, false);
});

test("each rule groups conditions and actions into two lines with inline labels", () => {
  const {nodes, send} = setup();
  send({
    rules: [{from: "customer@example.org", activeFrom: true, subject: "Ignored text", activeSubject: false,
      folder: folder("/Customers/A"), tags: ["important"]}],
  });
  const entry = byClass(nodes["rule-list-table"], "rule-entry")[0];
  const lines = byClass(entry, "rule-summary-line");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].textContent.includes("popup.rule.from: customer@example.org"));
  assert.ok(lines[0].textContent.includes("popup.rule.subject: Ignored text"));
  assert.equal(byClass(lines[0], "text-muted").length, 3);
  assert.ok(lines[1].textContent.includes("popup.rule.folder: work: /Customers/A"));
  assert.ok(lines[1].textContent.includes("popup.rule.tags: important"));
  assert.equal(descendants(nodes["rule-list-table"]).some(node => node.tag === "table"), false);
});

test("edit and delete buttons still address the right rule in the two-line list", async () => {
  const {nodes, requests, send} = setup();
  send({rules: [{from: "first@example.org"}, {from: "second@example.org"}]});
  const entry = byClass(nodes["rule-list-table"], "rule-entry")[1];
  const buttons = byClass(entry, "rule-entry-buttons")[0].children;
  assert.equal(buttons[0].tag, "button");
  assert.equal(buttons[1].tag, "button");
  await buttons[0].onclick();
  await buttons[1].onclick();
  assert.equal(requests[0].command, "requestOpenRulePopup");
  assert.equal(requests[0].ruleId, "1");
  assert.equal(requests[1].command, "requestRuleDelete");
  assert.equal(requests[1].rule.index, "1");
  assert.equal(requests[1].rule.from, "second@example.org");
});

test("an empty rules list replaces previously displayed entries", () => {
  const {nodes, send} = setup();
  send({rules: [{from: "first@example.org"}]});
  send({rules: []});
  assert.equal(nodes["rule-list-table"].textContent, "tab.list.empty");
  assert.equal(nodes["rule-list-table"].children.length, 0);
});
