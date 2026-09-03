import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync("src/content/shared/rule-matching.js", "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const matching = context.QuickArchiverRuleMatching;

test("findMatch is case-insensitive and matches contained text", () => {
  assert.equal(matching.findMatch("News@Example.com", "@example.com"), true);
  assert.equal(matching.findMatch("An unrelated subject", "example"), false);
});

test("findMatch supports explicit wildcards", () => {
  assert.equal(matching.findMatch("info@newsletter.example.com", "@*example.com"), true);
  assert.equal(matching.findMatch("support@example.com", "@*example.com"), true);
  assert.equal(matching.findMatch("support@example.org", "@*example.com"), false);
});

test("findRule requires all active conditions to match", () => {
  const message = {
    author: "Sender <sender@example.com>",
    recipients: ["archive@example.net"],
    subject: "Monthly report",
    folder: { accountId: "account-1" },
  };
  const rule = {
    activeFrom: true,
    from: "sender@example.com",
    activeSubject: true,
    subject: "report",
    activeAccount: true,
    accountId: "account-1",
    folder: { id: "destination" },
  };

  assert.equal(matching.findRule(message, [rule]), rule);
  assert.equal(matching.findRule({ ...message, subject: "Invoice" }, [rule]), null);
  assert.equal(
    matching.findRule({ ...message, folder: { accountId: "account-2" } }, [rule]),
    null,
  );
});

test("findRule ignores rules without active conditions", () => {
  assert.equal(matching.findRule({ subject: "Anything" }, [{ folder: { id: "destination" } }]), null);
});

test("destination fallback respects folder identity", () => {
  const rule = {
    activeFrom: true,
    from: "sender@example.com",
    activeAccount: true,
    accountId: "account-1",
    folder: { id: "destination", path: "/Archive", accountId: "account-2" },
  };
  const movedMessage = {
    author: "sender@example.com",
    folder: { id: "destination", path: "/Archive", accountId: "account-2" },
  };

  assert.equal(
    matching.findRule(movedMessage, [rule], { allowDestinationFolderFallback: true }),
    rule,
  );
  assert.equal(
    matching.findRule(
      { ...movedMessage, folder: { id: "other", path: "/Other", accountId: "account-2" } },
      [rule],
      { allowDestinationFolderFallback: true },
    ),
    null,
  );
});
