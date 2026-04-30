```
  cd /Users/daiwenkai/kevindai_git_home/inkos
  pnpm install
  pnpm build
  node packages/cli/dist/index.js --help
```

在其他项目中使用
```
  REPO=/Users/daiwenkai/kevindai_git_home/inkos

  mkdir -p /tmp/inkos-demo
  cd /tmp/inkos-demo

  node $REPO/packages/cli/dist/index.js init
  cp $REPO/.env.example .env
  # edit .env and fill INKOS_LLM_PROVIDER / BASE_URL /
  API_KEY / MODEL

  node $REPO/packages/cli/dist/index.js doctor
  node $REPO/packages/cli/dist/index.js book create
  --title "Test Novel" --genre xuanhuan  Novel"
  ```


 核心思路
  最稳的用法是两层控制：
  - 书级控制：inkos book create --brief brief.md
  - 章级控制：每次 inkos write next ... --context-file notes/ch01.md
  inkos init my-novel
  cd my-novel

  inkos book create \
    --title "我的小说" \
    --genre xuanhuan \
    --platform tomato \
    --target-chapters 200 \
    --chapter-words 3000 \
    --brief brief.md

  创建后，不要急着开写，先人工检查并修改这 3 个文件：

  - books/<book-id>/story/story_bible.md
  - books/<book-id>/story/volume_outline.md
  - books/<book-id>/story/book_rules.md

  这是最佳实践里最重要的一步。后面如果剧情跑偏，优先改这几个文件，不要只靠下一章 --context 临时补救。

  怎么一章一章生成
  最常用的是完整管线：

  inkos write next <book-id>

  如果你想指定“这一章重点写什么”，用：

  inkos write next <book-id> --context "本章只推进师徒决裂，不要打大决战，结尾埋下宗门追杀线索"

  更推荐把每章要求写成文件：

  inkos write next <book-id> --context-file notes/ch01.md
  inkos write next <book-id> --context-file notes/ch02.md 

重写章节
  inkos write rewrite my-book 12