import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("src/content/scripts/quickarchiver.js", "utf8");

test("shortcut hint follows the active binding and disappears when unassigned", async () => {
  let commands = [{ name: "quickarchiver_move", shortcut: "Alt+A" }];
  const context = vm.createContext({ messenger: { commands: { getAll: async () => commands } } });
  vm.runInContext(source, context);
  const hint = () => vm.runInContext("quickarchiver.getMoveShortcutHint()", context);
  assert.equal(await hint(), " (Alt+A)");
  commands = [{ name: "other", shortcut: "Alt+A" }, { name: "quickarchiver_move", shortcut: "Ctrl+Shift+Y" }];
  assert.equal(await hint(), " (Ctrl+Shift+Y)");
  commands = [{ name: "quickarchiver_move", shortcut: "" }];
  assert.equal(await hint(), "");
  commands = [];
  assert.equal(await hint(), "");
});

test("shortcut lookup failure leaves the toolbar usable without a stale hint", async () => {
  const context = vm.createContext({
    messenger: { commands: { getAll: async () => { throw new Error("unavailable"); } } },
    console: { warn() {} },
  });
  vm.runInContext(source, context);
  assert.equal(await vm.runInContext("quickarchiver.getMoveShortcutHint()", context), "");
});
