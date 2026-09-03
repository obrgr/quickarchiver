import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(projectDirectory, "src");
const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3, "Only Manifest V3 is supported");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "The add-on version must use x.y.z format");

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
