# Web research search providers

Ask the InkOS agent to research a factual setting, era, profession, or market.
Its `workspace__research_web` action searches for sources, extracts relevant page
excerpts, and saves a traceable Markdown report under `.inkos/research/`.
Research is reference material and does not modify story state.

New, unconfigured projects use [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
at `https://search.parallel.ai/mcp`. Search uses Fast mode. Search and page
extraction are free for light use, with no account or API key required; anonymous
usage limits apply. Requests send the research topic and selected source URLs to
Parallel. Page extraction returns relevant excerpts, not necessarily complete pages.

Studio **Project Settings → Research Search Provider** offers:

- **Automatic** (default): keeps Tavily when `TAVILY_API_KEY`, a project API key,
  an API key environment variable name, or a custom endpoint is configured;
  otherwise uses Parallel.
- **Parallel**: always uses anonymous Parallel MCP, even when Tavily credentials
  are present. Tavily credentials and custom endpoints are not sent to Parallel.
- **Tavily** or **Custom / Tavily-compatible**: keeps the existing search API
  behavior and direct URL fetching. These providers still require an API key.

You can also select a provider in `inkos.json`:

```json
{
  "researchSearch": {
    "enabled": true,
    "provider": "parallel"
  }
}
```

Existing saved provider selections and credentials remain in effect. A saved
`"enabled": false` now stops web research completely, including environment-key
fallback; enable it in Studio to resume research. Turning off research preserves
the selected provider and credentials. Profile permissions still govern access
to the research action.

Provider failures do not switch to another service. Search and fetch failures
appear in the report's partial failures; cancellation stops the action without
saving a report. Network operations have a 15-second deadline, and research
retains the existing quick, standard, and deep source-count budgets.
