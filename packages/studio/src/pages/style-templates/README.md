# Style Templates

Built-in style templates live here as independent JSON files.

Each file must match the `StyleRevisionTemplate` shape from `style-revision-templates.ts`:

- `id`: stable template id.
- `label`: localized display name for `zh`, `en`, and `ko`.
- `description`: localized short explanation for `zh`, `en`, and `ko`.
- `rules`: localized style instructions for `zh`, `en`, and `ko`.

The Studio app imports these files in `style-revision-templates.ts`, so adding a built-in style now only requires creating a JSON file and registering it in that import list.
