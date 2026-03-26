const fs = require('fs');
const f = 'd:/projects/InkOS/inkos/packages/core/src/__tests__/writer-prompts.test.ts';
let c = fs.readFileSync(f, 'utf-8');

// 1. Make buildPrompt helper async with Promise<string> return type
c = c.replace(
  '  function buildPrompt(',
  '  async function buildPrompt('
);
c = c.replace(
  '): string {',
  '): Promise<string> {'
);

// 2. Add await to all buildPrompt() calls  
c = c.replace(
  /const result = buildPrompt\(/g,
  'const result = await buildPrompt('
);

// 3. Make all it() callbacks async (match both normal and nested patterns)
c = c.replace(
  /it\("([^"]+)", \(\) => \{/g,
  'it("$1", async () => {'
);

fs.writeFileSync(f, c, 'utf-8');
console.log('Fixed ' + c.split('await buildPrompt').length + ' await calls');
