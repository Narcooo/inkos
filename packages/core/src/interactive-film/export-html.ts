import type { StoryGraph } from "./graph-schema.js";

const PLAYER_JS = String.raw`
(function(){
  function h(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  var vars = {};
  (GRAPH.variables||[]).forEach(function(v){ vars[v.name] = v.default; });
  var nodeById = {}; (GRAPH.nodes||[]).forEach(function(n){ nodeById[n.id] = n; });
  var endingByNode = {}; (GRAPH.endings||[]).forEach(function(e){ endingByNode[e.nodeId] = e; });
  var speakerNames = Object.create(null); (GRAPH.characters||[]).forEach(function(c){ speakerNames[c.id] = c.name; });
  function evalCond(c){ if(!c) return true; var v = vars[c.var];
    switch(c.op){ case ">=": return Number(v)>=Number(c.value); case "<=": return Number(v)<=Number(c.value); case ">": return Number(v)>Number(c.value); case "<": return Number(v)<Number(c.value); case "==": return v===c.value; case "!=": return v!==c.value; } return true; }
  function applyEffects(effects){ (effects||[]).forEach(function(e){
    if(e.op==="add") vars[e.var]=Number(vars[e.var]||0)+Number(e.value); else if(e.op==="sub") vars[e.var]=Number(vars[e.var]||0)-Number(e.value); else vars[e.var]=e.value; }); }
  function visible(node){ return (node.choices||[]).filter(function(c){ return evalCond(c.condition); }); }
  var root = document.getElementById("if-player");
  function hud(){ var s = Object.keys(vars).map(function(k){ return h(k)+": "+h(String(vars[k])); }).join("  ·  "); return s ? '<div class="hud">'+s+'</div>' : ''; }
  function render(node){
    if(!node){ root.innerHTML = "<p>节点缺失</p>"; return; }
    var html = hud();
    if(node.imageSlot && node.imageSlot.assetRef && ASSETS[node.imageSlot.assetRef]) html += '<img class="scene" src="'+ASSETS[node.imageSlot.assetRef]+'" alt=""/>';
    if(node.title) html += '<h2>'+h(node.title)+'</h2>';
    if(node.sceneDesc) html += '<p class="scene-desc">'+h(node.sceneDesc)+'</p>';
    (node.dialogue||[]).filter(function(d){ return evalCond(d.condition); }).forEach(function(d){ html += '<p class="line"><b>'+h(speakerNames[d.speaker] || d.speaker)+'：</b>'+h(d.text)+'</p>'; });
    var end = endingByNode[node.id] || node.type==="ending";
    if(end){ var e = endingByNode[node.id];
      html += '<div class="ending"><div class="ending-type">'+h(e?e.type:"ending")+'</div><div class="ending-title">'+h(e?e.title:(node.title||"结局"))+'</div></div>';
      html += '<button class="restart">重新开始</button>';
      root.innerHTML = html;
      root.querySelector(".restart").onclick = function(){ start(); };
      return;
    }
    var vis = visible(node);
    html += '<div class="choices">';
    vis.forEach(function(c,i){ html += '<button class="choice" data-i="'+i+'">'+h(c.text)+'</button>'; });
    html += '</div>';
    if(vis.length===0) html += '<p class="deadend">（没有可走的选项）</p>';
    root.innerHTML = html;
    Array.prototype.forEach.call(root.querySelectorAll(".choice"), function(btn){
      btn.onclick = function(){ var c = vis[parseInt(btn.getAttribute("data-i"),10)]; applyEffects(c.effects); render(nodeById[c.targetNodeId]); };
    });
  }
  function start(){ vars = {}; (GRAPH.variables||[]).forEach(function(v){ vars[v.name]=v.default; }); var s = (GRAPH.nodes||[]).filter(function(n){return n.type==="start";})[0] || GRAPH.nodes[0]; render(s); }
  start();
})();
`;

const CSS = String.raw`
  body{font-family:system-ui,'PingFang SC',sans-serif;background:#14110f;color:#eee;margin:0;display:flex;justify-content:center;}
  #wrap{max-width:680px;width:100%;padding:24px;}
  h1{font-size:18px;color:#caa;}
  #if-player .scene{width:100%;border-radius:10px;margin-bottom:12px;}
  #if-player h2{font-size:20px;margin:8px 0;}
  .scene-desc{color:#bbb;} .line{margin:6px 0;} .line b{color:#d8b27a;}
  .hud{font-size:12px;color:#998;border:1px solid #333;border-radius:8px;padding:6px 10px;margin-bottom:12px;display:inline-block;}
  .choices{display:flex;flex-direction:column;gap:8px;margin-top:16px;}
  .choice{text-align:left;padding:12px 16px;border:1px solid #444;border-radius:10px;background:#1d1916;color:#eee;cursor:pointer;font-size:15px;}
  .choice:hover{border-color:#caa;}
  .ending{margin-top:20px;padding:16px;border:1px solid #553;border-radius:10px;}
  .ending-type{font-size:12px;color:#caa;text-transform:uppercase;} .ending-title{font-size:22px;margin-top:4px;}
  .restart{margin-top:12px;padding:10px 18px;border-radius:8px;background:#caa;color:#14110f;border:none;cursor:pointer;}
`;

// Escape only `<` so an embedded `</script>` inside a JSON string value cannot break out of the <script> tag.
// JSON.parse reads < back as `<`. Do NOT strip whitespace.
function esc(s: string): string {
  return s.replace(/</g, "\\u003c");
}

// Escape user-controlled strings before interpolating into the HTML template itself (title, h1).
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPlayableHtml(
  graph: StoryGraph,
  opts?: { assetDataUris?: Record<string, string>; title?: string },
): string {
  const title = opts?.title ?? graph.title ?? graph.projectId;
  const graphJson = esc(JSON.stringify(graph));
  const assetsJson = esc(JSON.stringify(opts?.assetDataUris ?? {}));
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escHtml(title)}</title><style>${CSS}</style></head>
<body><div id="wrap"><h1>${escHtml(title)}</h1><div id="if-player" data-if-player></div></div>
<script>var GRAPH=${graphJson};var ASSETS=${assetsJson};</script>
<script>${PLAYER_JS}</script>
</body></html>`;
}
