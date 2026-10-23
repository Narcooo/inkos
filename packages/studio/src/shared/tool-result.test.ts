import { describe, expect, it } from "vitest";
import { summarizeToolResult, exportedRevisionDownloads } from "./tool-result";

describe("summarizeToolResult", () => {
  it('pins export downloads to committed host revisions',()=>{
    const facts={kind:'work_package_exported',workId:'book',path:'source/exports/delivery.zip'};
    expect(exportedRevisionDownloads(facts)).toEqual([]);
    const artifact={workId:'book',artifactId:'delivery',revisionId:'r1',path:facts.path};
    expect(exportedRevisionDownloads({...facts,hostExecution:{status:'success',artifacts:[artifact]}})).toEqual([{...artifact,package:true}]);
    expect(exportedRevisionDownloads({...facts,hostExecution:{status:'failed',artifacts:[artifact]}})).toEqual([]);
    expect(exportedRevisionDownloads({...facts,hostExecution:{status:'success',artifacts:[{...artifact,workId:'other'}]}})).toEqual([]);
  });
  it("reads Pi text content blocks", () => {
    expect(summarizeToolResult({ content: [{ type: "text", text: "This operation was aborted" }] }))
      .toBe("This operation was aborted");
  });

  it("falls back to JSON for structured results", () => {
    expect(summarizeToolResult({ status: "cancelled", resumeCursor: "2" }))
      .toBe('{"status":"cancelled","resumeCursor":"2"}');
  });
  it("renders the model observation's display content without treating nested source JSON as another envelope", () => {
    const source = JSON.stringify({ status: "success", summary: "source", artifacts: [], observations: [], facts: {} });
    const observation = { status: "success", summary: "Read", content: source, artifacts: [], observations: [], facts: { kind: "artifact_read" } };
    expect(summarizeToolResult({ content: [{ type: "text", text: JSON.stringify(observation) }] })).toBe(source);
    expect(summarizeToolResult({ content: [{ type: "text", text: JSON.stringify(observation) }], details: { displayText: source } })).toBe(source);
  });
});
