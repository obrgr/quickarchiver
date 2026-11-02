/**
 * QuickArchiver
 * Copyright (c) 2026 Otto Berger <otto@bergerdata.de>
 *
 * QuickArchiver is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with QuickArchiver. If not, see <http://www.gnu.org/licenses/>.
 */


window.addEventListener("load", onLoad);

async function onLoad() {
    const settings = await messenger.storage.local.get(["showFolderPath", "hideFolderPathWhenTagged"]);
    const showPath = document.getElementById("show-folder-path");
    const hideWhenTagged = document.getElementById("hide-folder-path-when-tagged");
    showPath.checked = settings.showFolderPath !== false;
    hideWhenTagged.checked = settings.hideFolderPathWhenTagged === true;
    hideWhenTagged.disabled = !showPath.checked;
    const saveDisplay = async () => {
        hideWhenTagged.disabled = !showPath.checked;
        await messenger.storage.local.set({
            showFolderPath: showPath.checked,
            hideFolderPathWhenTagged: hideWhenTagged.checked,
        });
        await messenger.runtime.sendMessage({command: "refreshColumnDisplay"});
    };
    showPath.addEventListener("change", saveDisplay);
    hideWhenTagged.addEventListener("change", saveDisplay);


    document.getElementById("button-tools").addEventListener("click", openTools);
    document.getElementById("button-all-rules").addEventListener("click", openAllRules);
    document.getElementById("button-about").addEventListener("click", openAboutTab);

}


async function openTools() {
    await messenger.runtime.sendMessage({
        command: "requestOpenToolsTab"
    });
}

async function openAllRules() {
    await messenger.runtime.sendMessage({
        command: "requestOpenAllRulesTab"
    });
}

async function openAboutTab() {
    await messenger.runtime.sendMessage({
        command: "requestOpenAboutTab"
    });
}