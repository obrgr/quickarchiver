# Add-on listing templates

These instructions apply to this directory and its language subdirectories.
The constraints below were specified by the repository owner for addons.thunderbird.net.

## Structure and audience

- Maintain matching templates in `de/`, `en/`, and `fr/`.
- Write for Thunderbird users, not developers. Explain benefits and actual behavior without implementation details.
- Keep feature claims and compatibility information consistent with the repository documentation and manifest.

## Short description: `listing.md`

- Include only the short description as one plain-text paragraph.
- Maximum: 250 characters, including spaces and punctuation, excluding the trailing file newline.
- Use the available space where useful, without padding or exceeding the limit.
- No headings, Markdown formatting, links, release notes, or additional description sections.

## Long description: `description.html`

- Provide a ready-to-copy HTML fragment, not a full HTML document or Markdown.
- Only these tags and attributes are allowed:
  - `a`: `href`, `title`
  - `abbr`, `acronym`: `title`
  - `b`, `blockquote`, `code`, `em`, `i`, `li`, `ol`, `strong`, `ul`: no attributes
- Do not use other tags or attributes, including `html`, `head`, `body`, `h1`–`h6`, `p`, `br`, `div`, `class`, or `style`.
- Use `strong` for headings and blank lines between text paragraphs.
- Include links to the GitHub repository and README. Indicate that the README is in English in the German and French versions.
- Keep the long description in this separate file; do not add it to `listing.md`.

## Verification after edits

- Count the short description characters in every modified language and verify the 250-character limit.
- Check HTML tags, attributes, and nesting against the allowlist above.
- Keep translations equivalent in meaning and update README references if file locations change.
