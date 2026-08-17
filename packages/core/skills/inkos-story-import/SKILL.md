---
name: inkos-story-import
description: 导入已有小说、逆向重建设定与续写工程，并区分母本参考。Use for importing manuscripts or attaching external canon safely.
---
# Story import and reconstruction

Use this skill when the user wants an existing manuscript to become an editable, continuable InkOS project.

- Determine the user's intent before acting:
  - `import_chapters`: the text becomes real chapters in the active book and InkOS reconstructs state.
  - `ingest_material`: the text remains reference material only.
  - `manage_book_reference`: an archived source should guide future chapters for user-stated purposes.
- Preserve chapter order with natural chapter-number ordering. Confirm the continuation point when the active book already has chapters.
- Never treat a user's own manuscript as an imitation target by default.
- After import, report imported chapter count, detected gaps, reconstructed facts, uncertainties, and the next safe continuation point.
- Do not invent missing canon to make the project look complete. Mark uncertainty for later confirmation.
- Respond in the user's language.

Load `references/reconstruction-rubric.md` for large or inconsistent manuscripts.
