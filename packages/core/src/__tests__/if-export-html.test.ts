import { describe, expect, it } from "vitest";
import { buildPlayableHtml } from "../interactive-film/export-html.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";
import {runInNewContext} from 'node:vm';

const graph = StoryGraphSchema.parse({
  schemaVersion: 1, projectId: "p", title: "可玩样例", variables: [{ name: "trust", type: "counter", default: 0, desc: "" }],
  nodes: [
    { id: "s", type: "start", title: "开场", sceneDesc: "宫门前", imageSlot: { prompt: "宫门", assetRef: "works/p/source/assets/nodes/s.png" },
      choices: [{ id: "c", text: "去查", targetNodeId: "e", effects: [{ var: "trust", op: "add", value: 1 }] }] },
    { id: "e", type: "ending", title: "真相", choices: [] },
  ],
  endings: [{ id: "g1", nodeId: "e", title: "真相", type: "good" }],
});

describe("buildPlayableHtml", () => {
  it('renders a registered character name while retaining direct speaker labels and escaping their markup',()=>{
    const named=StoryGraphSchema.parse({...graph,characters:[{id:'actor-7',name:'陈姐'}],nodes:[{
      id:'end',type:'ending',title:'End',choices:[],dialogue:[
        {speaker:'actor-7',text:'The door closes.'},
        {speaker:'<narrator>',text:'Silence.'},
      ],
    }],endings:[]});
    const root={innerHTML:'',querySelector:()=>({}),querySelectorAll:()=>[]};
    const context={document:{getElementById:()=>root}};
    for(const script of buildPlayableHtml(named).split('<script>').slice(1))runInNewContext(script.split('</script>')[0],context);
    const labels=[...root.innerHTML.matchAll(/<b>(.*?)<\/b>/g)].map(match=>match[1]);
    expect(labels).toEqual([named.characters[0].name+'：','&lt;narrator&gt;：']);
  });
  it("is self-contained (no external http references)", () => {
    const html = buildPlayableHtml(graph);
    expect(html).toContain("<!doctype html>");
    expect(html).not.toMatch(/src=["']https?:\/\//);
    expect(html).not.toMatch(/href=["']https?:\/\//);
  });
  it("embeds the graph and a player marker", () => {
    const html = buildPlayableHtml(graph);
    expect(html).toContain("可玩样例");
    expect(html).toContain("trust"); // graph embedded
    expect(html).toMatch(/data-if-player|id="if-player"/); // player root marker
  });
  it("inlines provided asset data URIs", () => {
    const html = buildPlayableHtml(graph, { assetDataUris: { "works/p/source/assets/nodes/s.png": "data:image/png;base64,AAAA" } });
    expect(html).toContain("data:image/png;base64,AAAA");
  });

  // XSS: Fix 1 — title must be entity-escaped in <title> and <h1>
  it("escapes XSS payload in graph title (Fix 1)", () => {
    const xssGraph = StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: "xss-title",
      title: '</title><script>BAD</script>',
      nodes: [{ id: "s", type: "start", title: "start", choices: [] }],
    });
    const html = buildPlayableHtml(xssGraph);
    // The raw injection string must not appear — it should be entity-escaped
    expect(html).not.toContain('<script>BAD</script>');
    expect(html).toContain('&lt;script&gt;BAD&lt;/script&gt;');
  });

  // Determinism parity: relational ops must Number()-coerce both operands (mirrors evaluator.ts)
  it("player evalCond uses Number() coercion for relational ops (parity with evaluator)", () => {
    const html = buildPlayableHtml(graph);
    // All four relational ops must use Number(v) and Number(c.value)
    expect(html).toMatch(/Number\(v\)\s*>=\s*Number\(c\.value\)/);
    expect(html).toMatch(/Number\(v\)\s*<=\s*Number\(c\.value\)/);
    expect(html).toMatch(/Number\(v\)\s*>\s*Number\(c\.value\)/);
    expect(html).toMatch(/Number\(v\)\s*<\s*Number\(c\.value\)/);
    // Raw lexical comparison must not appear for relational ops
    expect(html).not.toMatch(/return v>=c\.value/);
    expect(html).not.toMatch(/return v<=c\.value/);
    expect(html).not.toMatch(/return v>c\.value/);
    expect(html).not.toMatch(/return v<c\.value/);
    // add/sub effects must Number()-coerce
    expect(html).toMatch(/Number\(vars\[e\.var\]\|\|0\)\+Number\(e\.value\)/);
    expect(html).toMatch(/Number\(vars\[e\.var\]\|\|0\)-Number\(e\.value\)/);
  });

  // XSS: Fix 2 — node content embedded in JSON is escaped by esc() so the raw onerror attribute never appears
  it("does not embed raw onerror attribute from node content (Fix 2)", () => {
    const xssGraph = StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: "xss-node",
      title: "safe title",
      nodes: [
        {
          id: "s",
          type: "start",
          title: '<img src=x onerror=alert(1)>',
          sceneDesc: "safe",
          dialogue: [{ speaker: '<b onerror=BAD>', text: 'hello' }],
          choices: [{ id: "c1", text: '<svg onload=evil()>', targetNodeId: "e" }],
        },
        { id: "e", type: "ending", title: "end", choices: [] },
      ],
    });
    const html = buildPlayableHtml(xssGraph);
    // esc() turns < into < in the JSON payload, so the literal tag never appears in the static HTML
    expect(html).not.toContain('<img src=x onerror=');
    expect(html).not.toContain('<b onerror=');
    expect(html).not.toContain('<svg onload=');
  });
});
