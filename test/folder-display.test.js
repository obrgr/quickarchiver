import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("src/experiments/customColumns/implementation.js", "utf8");

function setup(type = "imap") {
  const account = { key: "account-1", incomingServer: { type, prettyName: "Work" } };
  const other = { key: "account-2", incomingServer: { type: "imap", prettyName: "Private" } };
  const message = { folder: { name: "Other", URI: "imap://user@host/Other", server: account.incomingServer } };
  const context = vm.createContext({
    URL,
    Services: { wm: { getEnumerator: () => ({ hasMoreElements: () => false }) }, obs: { addObserver() {} }, scriptloader: { loadSubScriptWithOptions() {} } },
    ChromeUtils: { importESModule: () => ({
      ExtensionCommon: { ExtensionAPI: class {} },
      MailServices: { accounts: {
        getAccount: id => id === account.key ? account : other,
        findAccountForServer: server => server === account.incomingServer ? account : other,
      } },
      ThreadPaneColumns: {},
    }) },
  });
  vm.runInContext(source, context);
  const api = new context.customColumns().getAPI({ extension: {
    baseURI: { resolve: path => path },
    messageManager: { get: id => id === 1 ? message : null },
  } }).customColumns;
  const folder = path => ({ path, accountId: account.key });
  return { context, api, message, folder };
}

test("tooltip API and column formatter produce identical IMAP destination text", async () => {
  const { context, api, message, folder } = setup();
  for (const [path, expected] of [
    ["/INBOX/Archive/Invoices", "→ Invoices (Archive)"],
    ["/inbox/Invoices", "→ Invoices"],
    ["/INBOX", "→ INBOX"],
    ["/Archive/INBOX/Invoices", "→ Invoices (Archive/INBOX)"],
  ]) {
    assert.equal(context.folderDisplayValue({ folder: folder(path) }, message, "✓ Current Folder"), expected);
    assert.equal(await api.formatFolder(folder(path), 1, "✓ Current Folder"), expected);
  }
});

test("native folder context shortens ancestry but preserves nested INBOX", async () => {
  const { api, message, folder } = setup();
  message.folder.name = "Inbox";
  message.folder.URI = "imap://user@host/INBOX";
  assert.equal(await api.formatFolder(folder("/INBOX/INBOX/Invoices"), 1, "✓ Current Folder"), "→ Invoices (INBOX)");
  assert.equal(await api.formatFolder(folder("/INBOX"), 1, "✓ Current Folder"), "✓ Current Folder");
});

test("account context and non-IMAP INBOX ancestry remain visible", async () => {
  const { api, folder } = setup("none");
  assert.equal(await api.formatFolder(folder("/INBOX/Archive/Invoices"), 1, "current"), "→ Invoices (INBOX/Archive)");
  assert.equal(await api.formatFolder({ path: "/INBOX/Archive/Invoices", accountId: "account-2" }, 1, "current"), "→ Invoices (Private/Archive)");
});

test("tooltip reports an unavailable message", async () => {
  const { api, folder } = setup();
  await assert.rejects(api.formatFolder(folder("/Archive"), 2, "current"), /unavailable/);
});
