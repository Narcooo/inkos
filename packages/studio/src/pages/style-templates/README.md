# Style Templates

Built-in style templates live here as independent JSON files.

Each file must match the `StyleRevisionTemplate` shape from `style-revision-templates.ts`:

- `id`: stable template id.
- `label`: localized display name for `zh`, `en`, and `ko`.
- `description`: localized short explanation for `zh`, `en`, and `ko`.
- `rules`: localized style instructions for `zh`, `en`, and `ko`.

The Studio app imports these files in `style-revision-templates.ts` as a fallback, and the Studio server also reads this directory at runtime through `/api/v1/style-templates`.

When Studio is running from the built `dist` frontend, edits to these JSON files are reflected after refreshing the browser page. Adding a new built-in style still requires creating a JSON file and registering it in the import list so packaged builds keep a fallback copy.
