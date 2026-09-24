import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(projectDirectory, "src");
const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3, "Only Manifest V3 is supported");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "The add-on version must use x.y.z format");

const localeDirectory = path.join(sourceDirectory, "_locales");
const manifestMessages = [...JSON.stringify(manifest).matchAll(/__MSG_(.*?)__/g)];
for (const [, key] of manifestMessages) {
  assert.match(key, /^[A-Za-z0-9@_]+$/, `Invalid manifest localization key: ${key}`);
}
for (const locale of await readdir(localeDirectory, { withFileTypes: true })) {
  if (!locale.isDirectory()) continue;
  const messages = JSON.parse(await readFile(path.join(localeDirectory, locale.name, "messages.json"), "utf8"));
  for (const [, key] of manifestMessages) {
    assert.ok(messages[key]?.message, `Missing manifest message ${key} in ${locale.name}`);
  }
}

const referencedFiles = [
  ...manifest.background.scripts,
  manifest.options_ui.page,
  manifest.message_display_action.default_icon,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.experiment_apis ?? {}).flatMap(experiment => [
    experiment.schema,
    experiment.parent.script,
  ]),
];

for (const referencedFile of new Set(referencedFiles)) {
  await access(path.join(sourceDirectory, referencedFile));
}

console.log(`Manifest ${manifest.version}: ${new Set(referencedFiles).size} referenced files verified`);
