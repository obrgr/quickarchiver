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

let rules = {};
let accounts = new Map();
let folderActions = [];
let tags = new Map();

async function onLoad() {

    document.getElementById("button-cancel").addEventListener("click", closeTab);
    document.getElementById("button-tools").addEventListener("click", openTools);

    await messenger.runtime.sendMessage({
        command: "requestAllRules"
    });
}

async function closeTab() {
    window.close();
}

async function openTools() {
    await messenger.runtime.sendMessage({
        command: "requestOpenToolsTab"
    });
}

messenger.runtime.onMessage.addListener((broadcastMessage) => {

    if (broadcastMessage && broadcastMessage.hasOwnProperty("command")) {

        console.info("Broadcast Message received: " + broadcastMessage.command);

        if (broadcastMessage.command === "transmitAllRules" && broadcastMessage.rules) {
            rules = broadcastMessage.rules;
            folderActions = broadcastMessage.folderActions ?? [];
            tags = new Map((broadcastMessage.tags ?? []).map(tag => [tag.key, tag]));
            accounts = new Map((broadcastMessage.accounts ?? []).map(account => [account.id, account]));
            renderTable();
            renderFolderTable();
        }
    }
});

function summaryField(labelKey, value, muted = false) {
    const field = document.createElement("div");
    field.className = "rule-summary-field" + (muted ? " text-muted" : "");
    const label = document.createElement("strong");
    label.textContent = browser.i18n.getMessage(labelKey) + ": ";
    field.appendChild(label);
    if (typeof value === "string") {
        const text = document.createElement("span");
        text.textContent = value;
        field.appendChild(text);
    } else {
        field.appendChild(value);
    }
    return field;
}

function inheritedTagList(rule) {
    const inherited = QuickArchiverFolderActions.matchingActions(rule.folder, folderActions);
    const sources = new Map();
    for (const action of inherited) {
        for (const key of action.tags) {
            if (!sources.has(key)) {
                sources.set(key, []);
            }
            sources.get(key).push(folderDisplay(action.folder));
        }
    }
    const list = createTagList([...sources.keys()], sources);
    list.className += " rule-inherited-tags";
    return list;
}

function ruleButtons(rule, key) {
    const controls = document.createElement("div");
    controls.className = "rule-entry-buttons";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = browser.i18n.getMessage("tab.list.table.action.edit");
    edit.onclick = async () => {
        await messenger.runtime.sendMessage({command: "requestOpenRulePopup", ruleId: key});
    };
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = browser.i18n.getMessage("tab.list.table.action.delete");
    remove.onclick = async () => {
        if (!confirm(browser.i18n.getMessage("tab.list.table.action.delete.message.confirm"))) {
            return;
        }
        await messenger.runtime.sendMessage({command: "requestRuleDelete", rule: {...rule, index: key}});
    };
    controls.appendChild(edit);
    controls.appendChild(remove);
    return controls;
}

function renderTable() {
    const container = document.getElementById("rule-list-table");
    const list = document.createElement("ol");
    list.className = "rules-overview";
    for (const [key, rule] of Object.entries(rules)) {
        if (!rule) {
            continue;
        }
        const entry = document.createElement("li");
        entry.className = "rule-entry";
        const details = document.createElement("div");
        details.className = "rule-entry-details";
        const conditions = document.createElement("div");
        conditions.className = "rule-summary-line rule-summary-conditions";
        for (const [field, active, label] of [
            ["from", "activeFrom", "popup.rule.from"],
            ["to", "activeTo", "popup.rule.to"],
            ["subject", "activeSubject", "popup.rule.subject"],
        ]) {
            conditions.appendChild(summaryField(label, rule[field] || "—", !rule[active]));
        }
        const account = rule.activeAccount ? accountDisplay(rule.accountId)
            : browser.i18n.getMessage("tab.list.table.account.unrestricted");
        conditions.appendChild(summaryField("tab.list.table.account", account, !rule.activeAccount));

        const actions = document.createElement("div");
        actions.className = "rule-summary-line rule-summary-actions";
        actions.appendChild(summaryField("popup.rule.folder", rule.folder ? folderDisplay(rule.folder) : "—"));
        const directTags = createTagList(rule.tags);
        directTags.className += " rule-direct-tags";
        actions.appendChild(summaryField("popup.rule.tags", directTags, directTags.children.length === 0));
        const inheritedTags = inheritedTagList(rule);
        actions.appendChild(summaryField("tab.list.table.tags.inherited", inheritedTags, inheritedTags.children.length === 0));
        details.appendChild(conditions);
        details.appendChild(actions);
        entry.appendChild(details);
        entry.appendChild(ruleButtons(rule, key));
        list.appendChild(entry);
    }
    if (list.children.length === 0) {
        container.textContent = browser.i18n.getMessage("tab.list.empty");
    } else {
        container.replaceChildren(list);
    }
}

function accountDisplay(accountId) {
    const account = accounts.get(accountId);
    return account ? (account.email ? `${account.name} (${account.email})` : account.name) : (accountId ?? "");
}

function folderDisplay(folder) {
    return `${accountDisplay(folder.accountId)}: ${folder.path ?? ""}`;
}

function createTagList(keys = [], sources = new Map()) {
    const container = document.createElement("div");
    container.className = "table-tags";
    const uniqueKeys = [...new Set(Array.isArray(keys) ? keys : [])];
    if (uniqueKeys.length === 0) {
        container.textContent = "—";
    }
    for (const key of uniqueKeys) {
        const tag = tags.get(key);
        const name = document.createElement("span");
        name.className = "table-tag-name";
        name.textContent = tag?.tag ?? key;
        if (typeof tag?.color === "string" && /^#[0-9a-f]{6}$/i.test(tag.color)) {
            name.style.color = tag.color;
        }
        if (sources.has(key)) {
            name.title = sources.get(key).join("\n");
        }
        container.appendChild(name);
    }
    return container;
}

function renderFolderTable() {
    const container = document.getElementById("folder-rule-list-table");
    if (folderActions.length === 0) {
        container.textContent = browser.i18n.getMessage("tab.list.folder.actions.empty");
        return;
    }
    const table = new htmlSimpleTable();
    table.setData([...folderActions].sort((left, right) =>
        folderDisplay(left.folder).localeCompare(folderDisplay(right.folder))));
    table.setTableConfig({
        table: {
            class: "qa-table system-font-size",
            rowHighlighter: key => key % 2 ? "highlight" : "",
        },
        fields: [
            {
                field: "accountId",
                title: browser.i18n.getMessage("tab.list.table.account"),
                formatterRow: value => accountDisplay(value.folder.accountId),
            },
            {
                field: "folder",
                title: browser.i18n.getMessage("popup.rule.folder.actions.folder"),
                formatterField: value => value.path ?? "",
            },
            {
                field: "tags",
                title: browser.i18n.getMessage("popup.rule.tags"),
                createChild: value => createTagList(value.tags),
            },
            {
                field: "delete",
                title: "",
                width: "80px",
                createChild: value => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.textContent = browser.i18n.getMessage("tab.list.table.action.delete");
                    button.onclick = async () => {
                        if (!confirm(browser.i18n.getMessage(
                            "tab.list.folder.actions.delete.confirm", folderDisplay(value.folder)
                        ))) {
                            return;
                        }
                        button.disabled = true;
                        try {
                            const response = await messenger.runtime.sendMessage({
                                command: "requestFolderActionDelete",
                                folder: value.folder,
                            });
                            if (!response?.deleted) {
                                throw new Error("Could not delete folder action");
                            }
                        } catch (error) {
                            console.error("Could not delete folder action", error);
                            alert(browser.i18n.getMessage("tab.list.folder.actions.delete.error"));
                        } finally {
                            button.disabled = false;
                        }
                    };
                    return button;
                },
            },
        ],
    });
    container.replaceChildren(table.build());
}
