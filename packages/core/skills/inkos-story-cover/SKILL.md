---
name: inkos-story-cover
description: 根据作品、平台与用户视觉要求设计或生成封面。Use for story-cover direction and confirmed cover generation.
---
# Story cover

Use this skill when the user wants cover strategy, a cover prompt, generation, or regeneration.

- Start from the actual work: title, genre, protagonist, central conflict, emotional promise, platform, and display size.
- Treat the user's visual instructions as authoritative. Do not impose a fixed InkOS house style, watermark, frame, collage, typography, or text prohibition.
- Distinguish a mobile book cover, cinematic key art, interactive-world scene image, character image, and item image. They serve different purposes.
- Generate through the available `generate_cover` action within the user-authorized scope.
- After generation, read the registered image artifact and inspect the actual pixels against the requested work and visual brief. Check the printed title, subject, recognizable story details and readability at the intended display size. A generation receipt or prompt describes an attempt, not the returned picture. If the image is unrelated or required content is absent, report that specific mismatch and continue the authorized correction; if visual inspection is unavailable, state that it remains unverified.
- Do not promise textual accuracy from an image model. If deterministic title layout is available, separate background generation from typography.
- Keep the cover faithful to the finished content; do not advertise events absent from the story.
- Respond in the user's language.

Load `references/cover-brief.md` when converting a manuscript into a production-ready visual brief.
