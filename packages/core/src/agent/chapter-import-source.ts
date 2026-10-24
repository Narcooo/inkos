import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { splitChapters, type SplitChapter } from "../utils/chapter-splitter.js";
import {loadWorkManifest} from '../harness/work-store.js';
import {readArtifactRevision} from '../harness/artifact-reader.js';
import {WorkResourceIdSchema,type WorkLineage,type WorkManifest} from '../harness/contracts.js';

const CHAPTER_FILENAME_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function compareChapterSourceNames(left: string, right: string): number {
  return CHAPTER_FILENAME_COLLATOR.compare(left, right);
}

/**
 * Load chapters from a local source path for `import_chapters`.
 *
 * - Directory mode: each `.md`/`.txt` file becomes one chapter, in filename
 *   natural numeric order. The chapter title is the filename without its extension and
 *   without a leading numeric prefix (e.g. `03_风暴.md` → `风暴`).
 * - Single-file mode: the file is split into chapters with `splitChapters`,
 *   using `splitPattern` as a custom heading regex when provided. A non-empty
 *   file without chapter headings becomes one chapter when no custom pattern
 *   was requested.
 *
 * This mirrors the pure loading logic of `inkos import chapters` in the CLI
 * so the agent tool does not depend on the CLI package.
 */
export async function loadChaptersFromPath(
  sourcePath: string,
  splitPattern?: string,
): Promise<ReadonlyArray<SplitChapter>> {
  const sourceStat = await stat(sourcePath);

  if (sourceStat.isDirectory()) {
    const entries = await readdir(sourcePath);
    const textFiles = entries
      .filter((f) => f.endsWith(".md") || f.endsWith(".txt"))
      .sort(compareChapterSourceNames);

    if (textFiles.length === 0) {
      throw new Error(`No .md or .txt files found in ${sourcePath}.`);
    }

    return Promise.all(
      textFiles.map(async (f) => {
        const content = await readFile(join(sourcePath, f), "utf-8");
        const title = f.replace(/\.(md|txt)$/, "").replace(/^\d+[_\-\s]*/, "");
        return { title, content };
      }),
    );
  }

  const text = await readFile(sourcePath, "utf-8");
  return chaptersFromText(text,sourcePath,splitPattern);
}

/** Registered sources keep their exact revision identity across import/resume. */
export async function loadChapterSource(projectRoot:string,sourcePath:string,splitPattern?:string,previousSources:readonly WorkLineage[]=[]):Promise<{chapters:ReadonlyArray<SplitChapter>;lineage:WorkLineage[]}>{
  const parts=relative(projectRoot,sourcePath).split(sep);
  if(parts[0]==='works'&&WorkResourceIdSchema.safeParse(parts[1]).success){
    let work:WorkManifest|undefined;
    try{work=await loadWorkManifest(projectRoot,parts[1]!);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const path=parts.slice(2).join('/');
    if(work){
      const current=work.artifacts.flatMap(artifact=>{
        const revision=artifact.revisions.find(item=>item.id===artifact.currentRevisionId);
        return revision?[{artifactId:artifact.id,revisionId:revision.id,path:revision.path}]:[];
      });
      const pinned=previousSources.filter(source=>source.sourceWorkId===work.id&&source.sourceArtifactId&&source.sourceRevisionId).map(source=>{
        const revision=work.artifacts.find(artifact=>artifact.id===source.sourceArtifactId)?.revisions.find(item=>item.id===source.sourceRevisionId);
        if(!revision)throw Object.assign(new Error('A pinned chapter source revision is no longer registered.'),{code:'SOURCE_SNAPSHOT_MISSING'});
        return{artifactId:source.sourceArtifactId!,revisionId:source.sourceRevisionId!,path:revision.path};
      });
      const single=pinned.find(source=>source.path===path)??current.find(source=>source.path===path);
      if(single)return loadChapterArtifactSource(projectRoot,{workId:work.id,artifactId:single.artifactId,revisionId:single.revisionId},splitPattern,previousSources);
      const prefix=path.endsWith('/')?path:path+'/';
      const inDirectory=(source:{path:string})=>source.path.startsWith(prefix)&&!source.path.slice(prefix.length).includes('/')&&(source.path.endsWith('.md')||source.path.endsWith('.txt'));
      const originalMembers=pinned.filter(inDirectory);
      const members=(originalMembers.length?originalMembers:current.filter(inDirectory)).sort((a,b)=>compareChapterSourceNames(a.path,b.path));
      if(members.length){
        const sources=await Promise.all(members.map(source=>readArtifactRevision({projectRoot,workId:work.id,artifactId:source.artifactId,revisionId:source.revisionId})));
        if(sources.some(source=>!source.revision.contentType.startsWith('text/')&&source.revision.contentType!=='application/json'))throw Object.assign(new Error('Chapter import requires text source artifacts'),{code:'SOURCE_NOT_TEXT'});
        return{chapters:sources.map(source=>({title:basename(source.revision.path).replace(/\.(md|txt)$/,'').replace(/^\d+[_\-\s]*/,''),content:source.bytes.toString('utf8')})),
          lineage:sources.map(source=>({relation:'derived-from',sourceWorkId:source.work.id,sourceArtifactId:source.artifact.id,sourceRevisionId:source.revision.id})),
        };
      }
      throw Object.assign(new Error('Select a registered text artifact or a directory containing registered text sources in this Work.'),{code:'SOURCE_ARTIFACT_REQUIRED'});
    }
  }
  return{chapters:await loadChaptersFromPath(sourcePath,splitPattern),lineage:[]};
}

export async function loadChapterArtifactSource(projectRoot:string,reference:{workId:string;artifactId:string;revisionId?:string},splitPattern?:string,previousSources:readonly WorkLineage[]=[]):Promise<{chapters:ReadonlyArray<SplitChapter>;lineage:WorkLineage[]}>{
  const previous=previousSources.find(source=>source.sourceWorkId===reference.workId&&source.sourceArtifactId===reference.artifactId&&source.sourceRevisionId);
  const source=await readArtifactRevision({projectRoot,...reference,revisionId:reference.revisionId??previous?.sourceRevisionId});
  if(!source.revision.contentType.startsWith('text/')&&source.revision.contentType!=='application/json')throw Object.assign(new Error('Chapter import requires a text source artifact'),{code:'SOURCE_NOT_TEXT'});
  return{chapters:chaptersFromText(source.bytes.toString('utf8'),source.revision.path,splitPattern),lineage:[{relation:'derived-from',sourceWorkId:source.work.id,sourceArtifactId:source.artifact.id,sourceRevisionId:source.revision.id}]};
}

function chaptersFromText(text:string,sourcePath:string,splitPattern?:string):ReadonlyArray<SplitChapter>{
  const chapters = splitChapters(text, splitPattern);

  if (chapters.length === 0) {
    if (!splitPattern && text.trim()) {
      const lines = text.trim().split(/\r?\n/);
      const heading = lines[0]?.match(/^#\s+(.+)$/);
      const title = heading?.[1]?.trim()
        || basename(sourcePath).replace(/\.(md|txt)$/i, "");
      const content = (heading ? lines.slice(1) : lines).join("\n").trim();
      if (content) return [{ title, content }];
    }
    throw new Error(
      `No chapters found in ${sourcePath}. ` +
      `The default pattern matches "第X章/第X回" and "Chapter N" heading lines. ` +
      `Pass splitPattern with a custom regex if the source uses a different heading style.`,
    );
  }

  return chapters;
}
