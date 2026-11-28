# Legal library import format

The platform admin imports legislation, rulings, Official Gazette issues and synonyms from
**Platform → Legal library** (`POST /api/platform/library/import`). A file is UTF-8 JSON, up to
15 MB; split larger collections into several files. A complete example with fictional content is
in [`legal-library-sample.json`](legal-library-sample.json).

Only import texts you are allowed to republish. The system stores and shows them exactly as given.

## How an import behaves

- **Preview first.** "Preview" runs the whole import and rolls it back, so its counts are exactly
  what the import will do. Nothing is saved.
- **All or nothing.** If any record has an error, the file is rejected and every problem is listed
  by its path (for example `laws[3].articles[12].number`). A valid file is imported in one
  transaction.
- **Keys make it repeatable.** Every law, ruling and Gazette issue has a `key` you choose
  (2–120 letters, digits, `.`, `-`, `_`). Importing the same key again updates that record instead
  of adding a copy. Keep keys stable, e.g. `ps-law-2001-2`.
- **Articles are matched by number within their law.** A new text replaces the stored one.
  Articles already stored but absent from the file are kept (and counted in the summary), so the
  offices' saved items and case links never disappear.
- **References across files work.** A law can point to a Gazette issue, and a ruling to articles,
  that were imported earlier or are in the same file. A reference to something that cannot be found
  is skipped with a warning.

## Sections

All sections are optional, but a file must contain at least one record.

### `gazette` — Official Gazette issues (الوقائع الفلسطينية)

| field | required | notes |
|---|---|---|
| `key` | yes | stable identifier |
| `number` | yes | issue number, a positive whole number |
| `publishedOn` | no | `YYYY-MM-DD` |
| `items` | no | what the issue published, in order: `{ "title": "…", "law": "<law key>" }`; `law` is optional and links the item to an imported law |

### `laws` — legislation

| field | required | notes |
|---|---|---|
| `key` | yes | stable identifier |
| `jurisdiction` | yes | `ps` (Palestine), `jo` (Jordan) or `eg` (Egypt) |
| `kind` | no | `law` (default), `decree_law`, `regulation`, `decree`, `decision`, `order`, `other` |
| `title` | yes | the full official title |
| `number`, `year` | no | as published |
| `status` | no | `in_force` (default), `amended` or `repealed` |
| `statusNote` | no | what amended or repealed it |
| `publishedOn` | no | `YYYY-MM-DD` |
| `gazetteIssue` | no | key of a Gazette issue |
| `sourceUrl` | no | where the text was taken from (http or https) |
| `articles` | no | in order: `{ "number": "205", "text": "…", "status": "in_force", "note": "…" }` |

An article's `number` is text and unique within its law (`"205"`, `"12 مكرر"`). Its `status` uses the
same values as a law's. A repealed article, or any article of a repealed law, is never offered as
current: search hides it unless the user asks for repealed texts, and it is always labeled.

### `rulings` — court rulings

| field | required | notes |
|---|---|---|
| `key` | yes | stable identifier |
| `jurisdiction` | yes | `ps`, `jo` or `eg` |
| `court` | yes | `cassation`, `high`, `constitutional`, `appeal`, `first_instance`, `magistrate`, `other` |
| `courtName`, `caseNumber`, `year`, `decidedOn` | no | as published (`decidedOn` is `YYYY-MM-DD`) |
| `subject`, `summary` | no | weighted higher than the body in search |
| `text` | yes | the full ruling; remove personal data you are not allowed to publish |
| `articles` | no | the articles it applied: `{ "law": "<law key>", "number": "205" }` |

### `synonyms` — everyday wording mapped to legal terms

`{ "phrase": "انطرد من الشغل", "terms": ["فصل تعسفي"] }` — when a question contains the phrase,
the search also looks for the terms and ranks matches on them higher. Phrases are compared after
normalization (hamza forms, taa marbuta, alef maqsura and diacritics do not matter). Up to 10 terms
per phrase.

## Limits per file

2,000 laws · 3,000 articles per law · 5,000 rulings · 2,000 Gazette issues · 500 items per issue ·
5,000 synonyms · 100 article references per ruling · 15 MB.
