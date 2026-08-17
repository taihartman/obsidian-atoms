# Localization

**User-facing copy is never a string literal in source.** It lives in the locale catalog for that surface. A new language is a new catalog file, not a hunt through Kotlin, Swift, or TypeScript.

This is a shipping rule, not a suggestion. Agents follow it on every UI, toast, Notice, notification, content description, and store-facing sentence.

## Catalogs

| Surface | Catalog | Default locale |
|---|---|---|
| Android companion | `companion/android/app/src/main/res/values/strings.xml` | `values/` is English |
| iOS companion | `Localizable.xcstrings` (add with the first second language) | English |
| Plugin (`src/**`) | not catalogued yet | English in source until a claim opens one |
| tryatoms (`www/`) | page templates | English until a claim opens one |

A second Android language is `companion/android/app/src/main/res/values-<lang>/strings.xml` with the same keys. Do not fork copy by `if (locale)`.

## Do

- Read copy through the platform API: Compose `stringResource`, Android `context.getString` / `getQuantityString`, XML `@string/…`.
- Format with numbered placeholders (`%1$s`, `%1$d`). Never concatenate sentences.
- Use `<plurals>` for counts.
- Escape apostrophes in XML as `\'`.
- Keep protocol tokens as code constants: `Atoms System`, `Inbox.md`, stamps, log tags. Those are the wire, not prose. When the UI *mentions* them, the sentence still lives in the catalog.

## Don’t

- `Text("Save")`, `Toast.makeText(this, "Saved", …)`, `android:text="Capture"` in layout XML.
- Invent a parallel map, enum-of-sentences, or `when (lang)` in Kotlin.
- Put user-facing punctuation in code (`"Saved · $stamp"`). Format the whole line in the catalog.

## Plugin and www

Those trees still have English in source. Do not grow that. New user-facing sentences there need a catalog in the same change, or they wait for the claim that adds one. Do not “just this once” a Notice.

## Review

Android XML is gated by Lint `HardcodedText`. Kotlin is convention plus review: a quoted sentence the user can see is a bug.