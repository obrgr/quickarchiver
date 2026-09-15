# QuickArchiver

![QuickArchiver logo](https://github.com/obrgr/quickarchiver/raw/master/src/content/icons/dark/qa_move.svg)

QuickArchiver is a Thunderbird MailExtension for keeping your inbox clean. It learns destination folders when you
move messages and later archives matching messages with one click or a keyboard shortcut.

## Project status

- Current version: **2.7.0**
- Manifest: **V3**
- Supported Thunderbird versions: **128 through 155**
- Languages: **English and German**
- License: **GNU Lesser General Public License, version 3 or later**

The current release uses Thunderbird's supported MailExtension APIs and a small custom column experiment for the
QuickArchiver folder column. Rules are stored locally in WebExtension storage and can be backed up as JSON.

Install the published release from [Thunderbird Add-ons](https://addons.thunderbird.net/thunderbird/addon/quickarchiver/).

## Features

- Automatically creates a rule when a message is moved to a folder
- Moves matching messages through the toolbar button, context menu, or **Alt+A**
- Matches sender, recipient, and subject conditions
- Supports case-insensitive text matching and `*` wildcards
- Optionally restricts a rule to a source account
- Provides a searchable destination-folder picker with account filtering
- Shows matching destinations in the optional QuickArchiver folder column
- Lists, edits, and deletes stored rules
- Imports and exports all rules as JSON
- Optionally opens the rule editor whenever a new rule is created

## Quick start

### 1. Create a rule by moving a message

![Toolbar button for editing a rule](https://github.com/obrgr/quickarchiver/raw/master/src/content/tab/images/toolbar_editrule@2x.png)

Move a message to its destination folder as usual. If no matching rule exists, QuickArchiver automatically creates
one from the sender address and remembers the destination folder.

### 2. Archive matching messages

![Toolbar button for moving a message](https://github.com/obrgr/quickarchiver/raw/master/src/content/tab/images/toolbar_move@2x.png)

When a message matches a rule, click the QuickArchiver button or press **Alt+A**. QuickArchiver moves it directly to
the saved destination folder. With multiple messages selected, Alt+A moves each message for which a rule exists.

> **Tip:** In Thunderbird's table view, enable the **QuickArchiver Folder** column to see the matching destination
> before moving a message.

## Rule details

![Toolbar button when no rule exists](https://github.com/obrgr/quickarchiver/raw/master/src/content/tab/images/toolbar_no_rule@2x.png)

The rule editor supports these conditions:

- **Sender:** matches the sender address
- **Recipient:** matches the first recipient address exposed by Thunderbird
- **Subject:** matches the message subject
- **Source account:** optionally limits the rule to messages from one account
- **Destination folder:** selects where matching messages are moved

Only enabled conditions are evaluated, and all enabled conditions must match. At least one condition must be active.
The destination folder can be selected from a searchable picker and its folder list can be filtered by account.

Text matching is case-insensitive. Values match when they occur anywhere in the corresponding field, and `*` can be
used as an explicit wildcard. For example, `@*example.com` matches both `info@newsletter.example.com` and
`support@example.com`.

To review every automatically created rule immediately, right-click the QuickArchiver button and enable
**Options → Open rule popup for new rules**. With this option enabled, special destinations such as Trash are also
allowed. Otherwise, Inbox and Trash are excluded from automatic rule creation.

## Context menu and folder column

![QuickArchiver context menu](https://github.com/obrgr/quickarchiver/raw/master/src/content/tab/images/toolbar_menu@2x.png)

Right-click the QuickArchiver button to edit the current rule, show all rules, configure the new-rule popup, or open
the About page. In the message list, the menu also provides the move action when a matching rule exists.

To enable the folder column, switch Thunderbird's message list to table view, right-click any column heading, and
select **QuickArchiver Folder**. The column displays the destination folder for a matching rule. If the message is
already there, it displays **✓ Current Folder**. The toolbar tooltip uses the same folder display as the column:
**→ Destination (Parent/Folder)**, with the account name included for destinations in another account. The leading
IMAP `INBOX` level is hidden from the displayed parent path; saved destination paths remain unchanged.
Thunderbird's card view does not support the custom column.

## Settings and rule management

![QuickArchiver rules](https://github.com/obrgr/quickarchiver/raw/master/src/content/tab/images/screenshot_editor@2x.png)

Select **Show all rules** from the QuickArchiver context menu or settings page to review, edit, or delete stored rules.

The tools below the rules list can export all rules as a JSON backup or import a previous backup.

> **Warning:** Importing a backup replaces all existing rules. Export the current rules first if they are still needed.

![QuickArchiver import and export tools](https://github.com/obrgr/quickarchiver/raw/master/src/content/tab/images/screenshot_tools@2x.png)

## Development

### Repository layout

```text
src/
├── manifest.json                    MailExtension manifest
├── _locales/                        English and German translations
├── content/
│   ├── scripts/                     Background entry point and core extension logic
│   ├── shared/                      Rule-matching helpers shared with the experiment
│   ├── popup/                       Rule editor and folder picker
│   ├── tab/                         About, rule list, and import/export pages
│   ├── options/                     Thunderbird settings page
│   └── icons/                       Light and dark toolbar assets
└── experiments/customColumns/       Thunderbird custom-column experiment
```

The background script owns rule storage, menu creation, message-move handling, and communication between extension
pages. `content/shared/rule-matching.js` contains the matching logic used by both the background and custom-column
contexts. Rule behavior must be changed there rather than duplicated in the experiment.

#### Custom-column architecture

The folder column is implemented as a privileged Experiment because Thunderbird does not provide a regular
MailExtension API for custom thread-pane columns. The experiment imports Thunderbird's internal `ThreadPaneColumns`
module and keeps its registration alive independently of the short-lived Manifest V3 background context.

The experiment also uses `content/shared/rule-matching.js`; this is the same file loaded by the background context.
Starting with Thunderbird 155, privileged experiments must explicitly opt in when loading an extension-owned
`moz-extension://` script. For that reason, `implementation.js` uses `Services.scriptloader.loadSubScriptWithOptions()`
with `allowUnsafeURL: true`. This option is deliberately limited to the packaged QuickArchiver script resolved from
`context.extension.baseURI`. Do not replace it with plain `loadSubScript()`, remove the option, or copy the matching
logic into the experiment, as doing so either breaks the column in Thunderbird 155 or creates two implementations of
rule matching.

`Services` is supplied directly by Thunderbird's privileged Experiment global. `Services.jsm` was removed in
Thunderbird 128, and `resource://gre/modules/Services.sys.mjs` is not importable in Thunderbird 155.

### Local setup

Requirements:

- Node.js and npm
- Bash and `jq`
- `zip`
- [ShellCheck](https://www.shellcheck.net/)

On macOS, install the system tools and then the pinned npm dependencies:

```bash
brew install jq shellcheck
npm install
```

The Thunderbird webext-linter is pinned to a reviewed upstream commit in `package.json`. Its schemas and review data
are downloaded and cached on the first review run.

### Checks and tests

Run the complete local check suite:

```bash
npm run check
```

This validates referenced manifest files, runs ESLint, validates the HTML, runs ShellCheck and Prettier checks, and
executes the rule-matching unit tests.

### Build an XPI

The release version is read exclusively from `src/manifest.json`:

```bash
npm run build
```

The resulting package is written to `builds/quickarchiver-<version>.xpi` and is automatically checked with `unzip -t`.
macOS metadata such as `.DS_Store` is excluded from the archive.

### Thunderbird automated review

Build the XPI and run Thunderbird's deterministic review, including its ESLint checks:

```bash
npm run review
```

The review enables `--allow-experiments` because QuickArchiver includes the `customColumns` experiment. Before a
submission, the optional LLM-assisted review can be started with:

```bash
export LLM_API_TYPE=chatgpt
export LLM_API_KEY=your-api-key
npm run review:llm
```

Never commit the API key. The deterministic review does not require an LLM key.

The unit tests cover the shared rule-matching behavior. Message moves, runtime messaging, menus, and the custom column
should additionally be tested in the supported Thunderbird release families.

### Contributing

Issues and pull requests are welcome in the
[GitHub repository](https://github.com/obrgr/quickarchiver/). When changing user-facing text, update both locale
files and both localized About pages where applicable.

## Release notes

### 2.7.0

- Show the configured keyboard shortcut in the toolbar tooltip instead of a fixed Alt+A; update it when the binding
  changes and hide the hint when no shortcut is assigned
- Unified destination-folder formatting in the toolbar tooltip and folder column
- Hide the leading IMAP INBOX level from displayed parent paths without changing saved destinations
- Show consistent parent-folder context, account names, and current-folder indicators

### 2.6.1

- Improved runtime message handling for reliable Manifest V3 operation
- Added Thunderbird 155 compatibility for the custom folder column
- Kept rule matching centralized while loading it safely from the custom-column experiment
- Added an add-on icon to the manifest
- Updated the README and built-in documentation

### 2.6

- Added a searchable folder picker with account filtering
- Added account information to the rule editor and rules list
- Improved the rule editor, folder picker, rules list, and import/export tools

### 2.5

- Added optional source-account restrictions to rules
- Improved rule matching and handling of moved messages

### 2.4

- Added the optional rule popup for newly created rules
- Improved cleanup of stored rules

### 2.3

- Added the QuickArchiver folder column to Thunderbird's table view
- Improved compatibility with current WebExtension APIs

Older releases and packages remain available in the repository history and the `builds` directory.

## About

QuickArchiver is an open-source project by Otto Berger
([quickarchiver@bergercity.de](mailto:quickarchiver@bergercity.de)), supported by
[bergerdata](https://www.bergerdata.com).

Thanks to the Thunderbird add-on community, the Thunderbird developers, John Bieling for his development resources
and examples, Philippe Lieser for the original translation logic, and everyone contributing to the WebExtension APIs.
