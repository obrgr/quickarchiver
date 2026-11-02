/* Shared folder action helpers for classification and the rule dialog. */
var QuickArchiverFolderActions = (() => {
    function includesFolder(parent, destination) {
        if (!parent || !destination) {
            return false;
        }
        if (parent.id && parent.id === destination.id) {
            return true;
        }
        // Paths are account-relative. Never inherit across accounts or guess
        // an account for a legacy destination which has no account metadata.
        if (!parent.accountId || parent.accountId !== destination.accountId
            || typeof parent.path !== "string" || typeof destination.path !== "string") {
            return false;
        }
        const parentPath = parent.path.replace(/\/+$/, "");
        const destinationPath = destination.path.replace(/\/+$/, "");
        return destinationPath === parentPath || destinationPath.startsWith(parentPath + "/");
    }

    function matchingActions(folder, actions = []) {
        return actions.filter(action => includesFolder(action.folder, folder));
    }

    function tagsForRule(rule, actions = []) {
        return [...new Set([
            ...(Array.isArray(rule.tags) ? rule.tags : []),
            ...matchingActions(rule.folder, actions).flatMap(action => action.tags ?? []),
        ].filter(tag => typeof tag === "string" && tag.length > 0))];
    }

    function normalize(actions) {
        if (!Array.isArray(actions)) {
            throw new Error("Folder actions must be an array");
        }
        const result = [];
        for (const action of actions) {
            const folder = action?.folder;
            if (!folder || typeof folder.accountId !== "string" || !folder.accountId
                || typeof folder.path !== "string" || !folder.path.startsWith("/")
                || !Array.isArray(action.tags) || action.tags.some(tag => typeof tag !== "string")) {
                throw new Error("Invalid folder action");
            }
            const existing = result.find(entry => entry.folder.accountId === folder.accountId
                && entry.folder.path === folder.path);
            if (existing) {
                existing.tags = [...new Set([...existing.tags, ...action.tags])];
            } else {
                result.push({
                    folder: {id: folder.id, accountId: folder.accountId, path: folder.path, name: folder.name},
                    tags: [...new Set(action.tags)],
                });
            }
        }
        return result;
    }

    return {includesFolder, matchingActions, tagsForRule, normalize};
})();
