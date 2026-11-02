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

let rule = {};
let requestedRuleIndex = null;
let availableTags = [];
let selectableFolders = [];
let folderActions = [];
let tagEditorOpened = false;

try {
    let ruleIndex = new URL(window.location.href).searchParams.get("ruleIndex");
    if (ruleIndex !== null && /^\d+$/.test(ruleIndex)) {
        requestedRuleIndex = Number(ruleIndex);
    }
} catch (e) {
    console.warn("Could not read rule index from popup URL", e);
}

async function ruleSave() {
    if (typeof rule.index === "undefined") {
        return;
    }
    const saveButton = document.getElementById("button_save");
    saveButton.disabled = true;
    document.getElementById("save-error").hidden = true;
    try {
        rule.from = document.getElementById("from").value;
        rule.to = document.getElementById("to").value;
        rule.subject = document.getElementById("subject").value;
        rule.activeFrom = document.getElementById("active-from").checked;
        rule.activeTo = document.getElementById("active-to").checked;
        rule.activeSubject = document.getElementById("active-subject").checked;
        rule.activeAccount = document.getElementById("active-account").checked;
        rule.accountId = document.getElementById("account").value;
        rule.tags = Array.from(document.querySelectorAll('#tags input:checked'), input => input.value);

        const response = await messenger.runtime.sendMessage({
            command: "requestRuleUpdate",
            rule,
            folderActions,
        });
        if (!response?.saved) {
            throw new Error("Could not save rule and folder actions");
        }
    } catch (error) {
        console.error("Could not save QuickArchiver rule", error);
        document.getElementById("save-error").hidden = false;
        saveButton.disabled = false;
        return;
    }
    try {
        await messenger.runtime.sendMessage({command: "requestRefreshList"});
    } catch (error) {
        console.error("Could not refresh QuickArchiver after saving rule", error);
    }
    window.close();
}

async function ruleCancel() {
    window.close();
}

async function updateOpenRulePopupOnNewRule(event) {
    await messenger.runtime.sendMessage({
        command: "updateOpenRulePopupOnNewRule",
        enabled: event.target.checked,
    });
}

function updateConditionInputState(checkboxId, inputId) {
    let checkbox = document.getElementById(checkboxId);
    document.getElementById(inputId).disabled = !checkbox.checked;
}

async function openFolderPicker() {
    await messenger.runtime.sendMessage({
        command: "requestOpenFolderPicker",
        folderId: rule.folder?.id ?? "",
        folderPath: rule.folder?.path ?? "",
    });
}

async function openTagEditor(event) {
    event.preventDefault();
    tagEditorOpened = true;
    try {
        const response = await messenger.runtime.sendMessage({command: "requestOpenTagEditor"});
        if (!response?.opened) {
            throw new Error("Could not open Thunderbird tag editor");
        }
    } catch (error) {
        console.error("Could not open Thunderbird tag editor", error);
        alert(browser.i18n.getMessage("popup.rule.tags.manage.error"));
    }
}

async function refreshTags() {
    // Preserve the current draft, including checkbox edits not yet saved.
    const selected = Array.from(document.querySelectorAll('#tags input:checked'), input => input.value);
    availableTags = await messenger.messages.tags.list();
    renderTagChoices(document.getElementById("tags"), selected);
    renderFolderActions();
    renderInheritedTags();
}

async function ruleDelete() {

    if (typeof (rule.index) !== "undefined") {
        await messenger.runtime.sendMessage({
            command: "requestRuleDelete",
            rule: rule
        });

        await messenger.runtime.sendMessage({
            command: "requestRefreshList"
        });
    }
    window.close();
}

function tagName(tag) {
    const name = document.createElement("span");
    name.className = "rule-tag-name";
    name.textContent = tag.tag;
    if (typeof tag.color === "string" && /^#[0-9a-f]{6}$/i.test(tag.color)) {
        name.style.color = tag.color;
    }
    return name;
}

function renderTagChoices(container, selected, onChange = () => {}) {
    container.replaceChildren();
    const savedTags = Array.isArray(selected) ? selected : [];
    // Keep deleted keys visible when editing. Classification ignores them.
    const options = [...availableTags];
    for (const key of savedTags) {
        if (!options.some(tag => tag.key === key)) {
            options.push({key, tag: key});
        }
    }
    for (const tag of options) {
        const label = document.createElement("label");
        label.className = "rule-tag";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = tag.key;
        checkbox.checked = savedTags.includes(tag.key);
        checkbox.addEventListener("change", () => {
            onChange(Array.from(container.querySelectorAll("input:checked"), input => input.value));
        });
        label.append(checkbox, tagName(tag));
        container.appendChild(label);
    }
}

function folderLabel(folder) {
    const account = selectableFolders.find(candidate => candidate.accountId === folder.accountId);
    return `${account?.accountName ?? folder.accountId}: ${folder.path}`;
}

function renderInheritedTags() {
    const container = document.getElementById("inherited-tags");
    container.replaceChildren();
    const inherited = QuickArchiverFolderActions.matchingActions(rule.folder, folderActions)
        .filter(action => action.tags.length > 0);
    if (inherited.length === 0) {
        container.textContent = browser.i18n.getMessage("popup.rule.inherited.empty");
        return;
    }
    for (const action of inherited) {
        const row = document.createElement("p");
        row.className = "inherited-tag-row";
        const source = document.createElement("strong");
        source.textContent = folderLabel(action.folder);
        row.append(source, document.createTextNode(": "));
        action.tags.forEach((key, index) => {
            if (index > 0) {
                row.appendChild(document.createTextNode(", "));
            }
            row.appendChild(tagName(availableTags.find(tag => tag.key === key) ?? {tag: key}));
        });
        container.appendChild(row);
    }
}

function sameFolder(left, right) {
    return left.accountId === right.accountId && left.path === right.path;
}

function relevantFolders() {
    return selectableFolders.filter(folder =>
        QuickArchiverFolderActions.includesFolder(folder, rule.folder));
}

function updateFolderOptions() {
    for (const select of document.querySelectorAll(".folder-action-select")) {
        const index = Number(select.dataset.actionIndex);
        for (const option of select.options) {
            const candidate = selectableFolders[Number(option.value)];
            option.disabled = Boolean(candidate && folderActions.some((action, actionIndex) =>
                actionIndex !== index && sameFolder(action.folder, candidate)));
        }
    }
    document.getElementById("button-add-folder-action").disabled = !relevantFolders().some(folder =>
        !folderActions.some(action => sameFolder(action.folder, folder)));
}

function renderFolderActions() {
    const container = document.getElementById("folder-actions");
    container.replaceChildren();
    const visibleActions = QuickArchiverFolderActions.matchingActions(rule.folder, folderActions);
    if (visibleActions.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = browser.i18n.getMessage("popup.rule.folder.actions.empty");
        container.appendChild(empty);
    }
    visibleActions.forEach(action => {
        // Keep the original index: hidden mappings must survive edits/removal.
        const index = folderActions.indexOf(action);
        const card = document.createElement("div");
        card.className = "folder-action-card";
        const controls = document.createElement("div");
        controls.className = "folder-action-controls";
        const label = document.createElement("label");
        label.htmlFor = `folder-action-${index}`;
        label.textContent = browser.i18n.getMessage("popup.rule.folder.actions.folder");
        const select = document.createElement("select");
        select.id = label.htmlFor;
        select.className = "folder-action-select";
        select.dataset.actionIndex = index;
        relevantFolders().forEach(folder => {
            const folderIndex = selectableFolders.indexOf(folder);
            const option = document.createElement("option");
            option.value = folderIndex;
            option.textContent = folderLabel(folder);
            select.appendChild(option);
        });
        const selectedIndex = selectableFolders.findIndex(folder => sameFolder(folder, action.folder));
        if (selectedIndex < 0) {
            const missing = document.createElement("option");
            missing.value = "missing";
            missing.textContent = folderLabel(action.folder);
            select.appendChild(missing);
            select.value = "missing";
        } else {
            select.value = selectedIndex;
        }
        select.addEventListener("change", () => {
            const folder = selectableFolders[Number(select.value)];
            if (folder) {
                action.folder = {...folder};
                updateFolderOptions();
                renderInheritedTags();
            }
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = browser.i18n.getMessage("popup.rule.folder.actions.remove");
        remove.addEventListener("click", () => {
            folderActions.splice(index, 1);
            renderFolderActions();
            renderInheritedTags();
            document.getElementById("button-add-folder-action").focus();
        });
        controls.append(select, remove);
        const choices = document.createElement("div");
        choices.className = "tag-choices";
        renderTagChoices(choices, action.tags, tags => {
            action.tags = tags;
            renderInheritedTags();
        });
        card.append(label, controls, choices);
        container.appendChild(card);
    });
    updateFolderOptions();
}

function addFolderAction() {
    const candidates = relevantFolders().filter(folder =>
        !folderActions.some(action => sameFolder(action.folder, folder)));
    // Prefer the nearest parent of this rule's destination for a new entry.
    const ancestors = candidates.filter(folder =>
        !sameFolder(folder, rule.folder ?? {})
        && QuickArchiverFolderActions.includesFolder(folder, rule.folder));
    const folder = ancestors.sort((left, right) => right.path.length - left.path.length)[0] ?? candidates[0];
    if (folder) {
        folderActions.push({folder: {...folder}, tags: []});
        renderFolderActions();
        document.getElementById(`folder-action-${folderActions.length - 1}`).focus();
    }
}

messenger.runtime.onMessage.addListener((broadcastMessage) => {
    if (broadcastMessage && broadcastMessage.hasOwnProperty("command")) {

        console.info("Broadcast Message received: " + broadcastMessage.command);

        if (broadcastMessage.command === "transmitRule" && broadcastMessage.rule) {

            rule = broadcastMessage.rule;

            availableTags = broadcastMessage.tags ?? [];
            selectableFolders = broadcastMessage.folders ?? [];
            folderActions = (broadcastMessage.folderActions ?? []).map(action => ({
                folder: {...action.folder}, tags: [...action.tags],
            }));
            renderTagChoices(document.getElementById("tags"), rule.tags ?? []);
            renderFolderActions();
            renderInheritedTags();

            let accountSelect = document.getElementById("account");
            accountSelect.replaceChildren();
            for (let account of broadcastMessage.accounts ?? []) {
                let option = document.createElement("option");
                option.value = account.id;
                option.textContent = account.email
                    ? `${account.name} (${account.email})`
                    : account.name;
                accountSelect.appendChild(option);
            }

            document.getElementById("from").value = rule.from;
            document.getElementById("to").value = rule.to;
            document.getElementById("subject").value = rule.subject;
            document.getElementById("active-from").checked = rule.activeFrom;
            document.getElementById("active-to").checked = rule.activeTo;
            document.getElementById("active-subject").checked = rule.activeSubject;
            updateConditionInputState("active-from", "from");
            updateConditionInputState("active-to", "to");
            updateConditionInputState("active-subject", "subject");
            document.getElementById("active-account").checked = rule.activeAccount === true;
            accountSelect.value = rule.accountId ?? "";
            accountSelect.disabled = !document.getElementById("active-account").checked;
            document.getElementById("folder").value = rule.folder.path;
            document.getElementById("open-rule-popup-on-new-rule").checked =
                broadcastMessage.openRulePopupOnNewRule === true;
        }

        if (broadcastMessage.command === "transmitSelectedFolder" && broadcastMessage.folder) {
            rule.folder = broadcastMessage.folder;
            document.getElementById("folder").value = broadcastMessage.folder.path ?? "";
            renderFolderActions();
            renderInheritedTags();
        }
    }
});

async function onLoad() {

    document.getElementById("button_save").addEventListener("click", ruleSave);
    document.getElementById("button_cancel").addEventListener("click", ruleCancel);
    document.getElementById("button_delete").addEventListener("click", ruleDelete);
    document.getElementById("button-select-folder").addEventListener("click", openFolderPicker);
    document.getElementById("open-tag-editor").addEventListener("click", openTagEditor);
    window.addEventListener("focus", () => {
        if (tagEditorOpened) {
            refreshTags().catch(error => console.error("Could not refresh Thunderbird tags", error));
        }
    });
    document.getElementById("button-add-folder-action").addEventListener("click", addFolderAction);
    for (let [checkboxId, inputId] of [
        ["active-from", "from"],
        ["active-to", "to"],
        ["active-subject", "subject"],
    ]) {
        document.getElementById(checkboxId).addEventListener("change", () => {
            updateConditionInputState(checkboxId, inputId);
        });
        updateConditionInputState(checkboxId, inputId);
    }
    document.getElementById("open-rule-popup-on-new-rule").addEventListener(
        "change",
        updateOpenRulePopupOnNewRule
    );
    document.getElementById("active-account").addEventListener("change", (event) => {
        document.getElementById("account").disabled = !event.target.checked;
    });

    await messenger.runtime.sendMessage({
        command: "requestRule",
        ...(requestedRuleIndex === null ? {} : {ruleIndex: requestedRuleIndex})
    });
}
