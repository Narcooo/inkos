import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadChaptersFromPath,loadChapterSource } from "../agent/chapter-import-source.js";
import {createWorkManifest,saveWorkManifest} from '../harness/work-store.js';
import {syncWorkSourceArtifacts} from '../harness/source-sync.js';

describe("loadChaptersFromPath", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("loads unpadded chapter files in natural numeric order", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-chapter-import-"));
    roots.push(root);
    const source = join(root, "chapters");
    await mkdir(source);
    await Promise.all([
      writeFile(join(source, "10_终局.md"), "ten"),
      writeFile(join(source, "2_转折.md"), "two"),
      writeFile(join(source, "1_开端.md"), "one"),
    ]);

    const chapters = await loadChaptersFromPath(source);

    expect(chapters.map((chapter) => chapter.title)).toEqual(["开端", "转折", "终局"]);
    expect(chapters.map((chapter) => chapter.content)).toEqual(["one", "two", "ten"]);
  });

  it('pins a registered directory’s membership and revisions before the parent changes, and resumes from snapshots after current files disappear',async()=>{
    const root=await mkdtemp(join(tmpdir(),'inkos-pinned-directory-'));roots.push(root);
    await saveWorkManifest(root,createWorkManifest({id:'source',title:'Source',profileId:'longform-novel',language:'en'}));
    const directory=join(root,'works/source/source/chapters');await mkdir(directory,{recursive:true});
    await syncWorkSourceArtifacts({projectRoot:root,workId:'source',accept:true,writes:[
      {relativePath:'works/source/source/chapters/2_Return.md',content:'# Chapter 2: Return\n\nMara returns.\n'},
      {relativePath:'works/source/source/chapters/1_Key.md',content:'# Chapter 1: Key\n\nThe key is on the desk.\n'},
    ]});
    const initial=await loadChapterSource(root,directory);
    expect(initial.chapters.map(chapter=>chapter.title)).toEqual(['Key','Return']);
    expect(initial.lineage).toHaveLength(2);
    expect(initial.lineage.every(source=>source.sourceArtifactId&&source.sourceRevisionId)).toBe(true);
    await syncWorkSourceArtifacts({projectRoot:root,workId:'source',accept:true,writes:[
      {relativePath:'works/source/source/chapters/1_Key.md',content:'# Chapter 1: Key\n\nThe key is on the shelf.\n'},
      {relativePath:'works/source/source/chapters/10_Later.md',content:'# Chapter 10: Later\n\nThe owner leaves.\n'},
    ]});
    const fresh=await loadChapterSource(root,directory);expect(fresh.chapters).toHaveLength(3);expect(fresh.chapters[0]).not.toEqual(initial.chapters[0]);
    await writeFile(join(root,'works/source/source/unregistered.md'),'A file outside the registered source inventory.');
    await expect(loadChapterSource(root,join(root,'works/source/source/unregistered.md'))).rejects.toMatchObject({code:'SOURCE_ARTIFACT_REQUIRED'});
    await rm(directory,{recursive:true});
    expect(await loadChapterSource(root,directory,undefined,initial.lineage)).toEqual(initial);
    const originalFile=await loadChapterSource(root,join(directory,'1_Key.md'),undefined,initial.lineage);
    expect(originalFile.lineage).toEqual([initial.lineage[0]]);
    expect(originalFile.chapters[0]?.content).toBe('The key is on the desk.');
  });

  it("treats a non-empty headingless file as one chapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-single-chapter-import-"));
    roots.push(root);
    const source = join(root, "harbor-letter.md");
    await writeFile(source, "# The Harbor Letter\n\nAt midnight, the bell rang once.\n", "utf-8");

    await expect(loadChaptersFromPath(source)).resolves.toEqual([{
      title: "The Harbor Letter",
      content: "At midnight, the bell rang once.",
    }]);
  });

  it("keeps a failed explicit split pattern as an error", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-custom-split-import-"));
    roots.push(root);
    const source = join(root, "novel.txt");
    await writeFile(source, "Only body text.", "utf-8");

    await expect(loadChaptersFromPath(source, "^Part\\s+(.+)$"))
      .rejects.toThrow(/No chapters found/);
  });
});
