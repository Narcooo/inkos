---
name: inkos-long-story-analysis
description: 长篇小说拆稿、文风分析与可迁移机制提炼。Use when analyzing a full novel or long sample without copying its expression.
---
# Long-form story analysis

Use this skill when the user asks to deconstruct, compare, learn from, or continue from a long novel or substantial sample.

- Preserve the source as traceable material with `ingest_material` when it comes from a file, PDF, URL, or upload.
- Analyze semantic mechanisms: reader promise, conflict escalation, character motivation, information release, scene function, emotional payoff, volume rhythm, prose behavior, and continuity load.
- Keep source evidence pointers. Separate direct observation from inference.
- Extract reusable craft, not names, wording, scene order, or signature combinations.
- If the user explicitly wants the active book to consult this source later, call `manage_book_reference(action="bind")` with the user's natural-language purposes. Binding is guidance, never canon.
- If the user only asks a question, answer it; do not start writing or editing a book.
- Respond in the user's language.

Load `references/analysis-lens.md` only for a full decomposition or comparison deliverable.
