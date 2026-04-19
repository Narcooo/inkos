<p align="center">
  <img src="assets/logo.svg" width="120" height="120" alt="InkOS Logo">
  <img src="assets/inkos-text.svg" width="240" height="65" alt="InkOS">
</p>

<h1 align="center">自律型小説執筆 AIエージェント</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/v/@actalk/inkos.svg?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL%20v3-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/Narcooo/inkos/stargazers"><img src="https://img.shields.io/github/stars/Narcooo/inkos?style=flat&logo=github&color=yellow" alt="GitHub stars"></a>
  <a href="https://www.npmjs.com/package/@actalk/inkos"><img src="https://img.shields.io/npm/dm/@actalk/inkos?color=cb3837&logo=npm&label=downloads" alt="npm downloads"></a>
  <a href="https://clawhub.ai/narcooo/inkos"><img src="https://img.shields.io/badge/🦞%20ClawHub-Skill-FF6B35?labelColor=1a1a1a" alt="ClawHub Skill"></a>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a> | 日本語
</p>

---

小説の執筆・監査・修正を自律的に行うオープンソースCLIエージェント。人間によるレビューゲートにより、常にコントロールを維持できます。LitRPG、プログレッションファンタジー、異世界転生、ロマンタジー、SF など多数のジャンルに対応。続編・スピンオフ・二次創作・文体模倣ワークフローを内蔵。

**InkOS Studio 2.0 正式リリース！** — `inkos` を実行してローカル Web ワークベンチを起動。書籍管理、章のレビュー＆編集、リアルタイム執筆進捗、市場レーダー、アナリティクス、AI検出、スタイル分析、ジャンル管理、デーモン制御、真実ファイル編集 — CLI の全機能をビジュアルで利用可能。

**InkOS TUI 正式リリース！** — `inkos tui` を実行してフルスクリーンのインタラクティブダッシュボードを起動。会話型創作、自然言語での書籍操作、スラッシュコマンド自動補完、テーマアニメーション——TUI、Studio、OpenClaw が同一のインタラクションカーネルを共有。

**英語ネイティブ小説執筆に対応！** — 10種類の英語ジャンルプロファイルを内蔵し、専用のペーシングルール、疲労語リスト、監査ディメンションを搭載。`--lang en` を設定するだけですぐに始められます。

## クイックスタート

### インストール

```bash
npm i -g @actalk/inkos
```

### OpenClaw 🦞 経由で使用

InkOS は [OpenClaw](https://clawhub.ai) Skill として公開されており、互換エージェント（Claude Code、OpenClaw など）から呼び出し可能です：

```bash
clawhub install inkos          # ClawHub からインストール
```

npm でインストール済み、またはリポジトリをクローン済みの場合、`skills/SKILL.md` が含まれているため、ClawHub の別途インストールなしで 🦞 が直接読み取れます。

インストール後、Claw は InkOS のアトミックコマンドとコントロールサーフェス操作（`plan chapter`/`compose chapter`/`draft`/`audit`/`revise`/`write next`）を `exec` 経由で呼び出し可能で、`--json` 出力による構造化された意思決定が可能です。推奨フロー：`author_intent.md` または `current_focus.md` を更新し、`plan` / `compose` を実行、その後 `draft` または完全パイプラインの `write next` を選択。[ClawHub](https://clawhub.ai) で `inkos` を検索して閲覧することもできます。

### 設定

**方法1：グローバル設定（推奨、初回のみ）**

```bash
inkos config set-global \
  --lang en \
  --provider <openai|anthropic|custom> \
  --base-url <APIエンドポイント> \
  --api-key <APIキー> \
  --model <モデル名>

# provider: openai / anthropic / custom（OpenAI互換プロキシにはcustomを使用）
# base-url: APIプロバイダーURL
# api-key: APIキー
# model: モデル名
```

`--lang en` で英語をすべてのプロジェクトのデフォルト執筆言語に設定。`~/.inkos/.env` に保存されます。新規プロジェクトは追加設定なしですぐに使えます。

**方法2：プロジェクトごとの `.env`**

```bash
inkos init my-novel     # プロジェクトを初期化
# my-novel/.env を編集
```

```bash
# 必須
INKOS_LLM_PROVIDER=                               # openai / anthropic / custom（OpenAI互換APIにはcustomを使用）
INKOS_LLM_BASE_URL=                               # APIエンドポイント
INKOS_LLM_API_KEY=                                 # APIキー
INKOS_LLM_MODEL=                                   # モデル名

# 言語（グローバル設定またはジャンルのデフォルトに準拠）
# INKOS_DEFAULT_LANGUAGE=en                        # en または zh

# オプション
# INKOS_LLM_TEMPERATURE=0.7                       # Temperature
# INKOS_LLM_MAX_TOKENS=8192                        # 最大出力トークン数
# INKOS_LLM_THINKING_BUDGET=0                      # Anthropic拡張思考バジェット
```

プロジェクトの `.env` はグローバル設定を上書きします。上書きが不要な場合はスキップ可能です。

**方法3：マルチモデルルーティング（オプション）**

異なるエージェントに異なるモデルを割り当て、品質とコストのバランスを調整：

```bash
# 異なるエージェントに異なるモデル/プロバイダーを割り当て
inkos config set-model writer <model> --provider <provider> --base-url <url> --api-key-env <ENV_VAR>
inkos config set-model auditor <model> --provider <provider>
inkos config show-models        # 現在のルーティングを表示
```

明示的なオーバーライドがないエージェントはグローバルモデルにフォールバックします。

### v1.2 アップデート

**統一インタラクションカーネル + TUIダッシュボード + Studioアシスタント**

- **共有インタラクションランタイム**：TUI、Studio、`inkos interact`、OpenClaw Skillが単一のNL理解+実行カーネルを共有、15以上のインテント（執筆、修正、書き直し、リネーム、エクスポート、書籍切り替え等）をサポート
- **Ink TUIダッシュボード**：`inkos` でフルスクリーンの対話型ダッシュボード（Ink + React）を起動、会話型創作、スラッシュコマンド自動補完、テーマアニメーション、i18nバイリンガル対応
- **Studioアシスタントパネル**：右側AIアシスタントパネルが共有インタラクションカーネルに接続——自然言語で書籍操作（リネーム、執筆、監査、エクスポート）、リアルタイム実行状態表示
- **会話型ブック作成**：自然言語の対話で書籍設定を段階的にブレスト、ドラフト完成後ワンクリック作成
- **全書エンティティリネーム**：`rename 林烬 to 張三` または `/rename 林烬 => 張三`——全章+真実ファイルを一括スキャン＆置換
- **`inkos interact`**：共有インタラクションJSONエンドポイント、OpenClaw/外部Agentから直接呼び出し可能
- **Thinkingモデル温度クランプ**：kimi-k2.5等のthinkingモデルをtemperature=1に自動固定、per-call温度オーバーライドと互換
- **Studio不要コード削除**：未使用のshadcnコンポーネントと依存関係を削除、-2800行

### 最初の本を書く

英語ジャンルプロファイルではデフォルトで英語が使用されます。ジャンルを選んで始めましょう：

```bash
inkos book create --title "The Last Delver" --genre litrpg     # LitRPG小説（デフォルトで英語）
inkos write next my-book          # 次の章を執筆（フルパイプライン：draft → audit → revise）
inkos status                      # ステータスを確認
inkos review list my-book         # 下書きをレビュー
inkos review approve-all my-book  # 一括承認
inkos export my-book --format epub  # EPUB形式でエクスポート（スマホ/Kindleで読める）
```

言語はジャンルごとにデフォルトで設定されます。`--lang en` または `--lang zh` で明示的に上書き可能です。`inkos genre list` で利用可能なすべてのジャンルとデフォルト言語を確認できます。

<p align="center">
  <img src="assets/screenshot-terminal.png" width="700" alt="ターミナルスクリーンショット">
</p>

---

## 英語ジャンルプロファイル

InkOS には10種類の英語ネイティブジャンルプロファイルが同梱されています。各プロファイルにはジャンル固有のルール、ペーシング、疲労語検出、監査ディメンションが含まれます：

| ジャンル | 主要メカニクス |
|---------|--------------|
| **LitRPG** | 数値システム、パワースケーリング、ステータス成長 |
| **プログレッションファンタジー** | パワースケーリング、数値システム不要 |
| **異世界転生（Isekai）** | 時代考証、世界観の対比、文化的な異邦人体験 |
| **修行もの（Cultivation）** | パワースケーリング、境地の進行 |
| **システムアポカリプス** | 数値システム、サバイバルメカニクス |
| **ダンジョンコア** | 数値システム、パワースケーリング、領地管理 |
| **ロマンタジー** | 感情アーク、二重視点ペーシング |
| **SF** | 時代考証、技術の一貫性 |
| **タワークライマー** | 数値システム、階層進行 |
| **コージーファンタジー** | ローステークスペーシング、コンフォートファーストのトーン |

バイリンガルクリエイター向けに、5種類の中国語Web小説ジャンル（玄幻、仙侠、都市、ホラー、その他）にも対応しています。

すべてのジャンルに **疲労語リスト** が含まれています（例：LitRPGの場合 "delve"、"tapestry"、"testament"、"intricate"、"pivotal"）。監査エージェントがこれらを自動的にフラグ付けするため、他のAI生成小説と同じような文体になるのを防ぎます。

---

## 主な機能

### 33次元監査 + 脱AI化

継続性監査エージェントがすべての下書きを33の次元でチェックします：キャラクターの記憶、リソースの継続性、フック回収、アウトライン準拠、ナラティブペーシング、感情アークなど。内蔵のAI痕跡検出が「LLMの声」を自動的に捕捉 — 使いすぎの単語、単調な文型、過度な要約。監査に失敗すると自動修正ループがトリガーされます。

脱AI化ルールはWriterエージェントのプロンプトに組み込まれています：疲労語リスト、禁止パターン、スタイルフィンガープリント注入 — ソースレベルでAI痕跡を削減。`revise --mode anti-detect` で既存の章に対して専用の脱AI検出リライトを実行できます。

### 文体クローニング

`inkos style analyze` で参考テキストを分析し、統計的なフィンガープリント（文長分布、語頻度パターン、リズムプロファイル）とLLM可読のスタイルガイドを抽出。`inkos style import` でこのフィンガープリントを書籍にインジェクト — 以降のすべての章がその文体を採用し、修正エージェントが文体に対して監査を行います。

### クリエイティブブリーフ

`inkos book create --brief my-ideas.md` — ブレインストーミングノート、世界観設定書、キャラクターシートを渡せます。アーキテクトエージェントがゼロから生成するのではなく、ブリーフを基に構築（`story_bible.md` と `book_rules.md` を生成）し、ブリーフを `story/author_intent.md` に永続化して、初期化後も書籍の長期的な意図が失われないようにします。

### 入力ガバナンスコントロールサーフェス

すべての書籍に2つの長期保存型Markdownコントロールドキュメントが付属：

- `story/author_intent.md`：この書籍が長期的にどうあるべきか
- `story/current_focus.md`：次の1〜3章で注意を引き戻すべき事柄

執筆前に以下を実行できます：

```bash
inkos plan chapter my-book --context "まずメンターとの対立に注意を引き戻す"
inkos compose chapter my-book
```

これにより `story/runtime/chapter-XXXX.intent.md`、`context.json`、`rule-stack.yaml`、`trace.json` が生成されます。`intent.md` は人間が読める契約書で、その他は実行/デバッグ用のアーティファクトです。`plan` / `compose` はローカルドキュメントとステートのコンパイルのみを行うため、APIキーの設定完了前でも実行できます。

### 文字数管理

`draft`、`write next`、`revise` は同じ保守的な文字数ガバナーを共有：

- `--words` は正確なハード制限ではなく、目標バンドを設定
- 中国語の章はデフォルトで `zh_chars`、英語の章はデフォルトで `en_words` を使用
- 章がソフトバンドから逸脱した場合、InkOS はプロを乱暴にカットするのではなく、1回の補正正規化パス（圧縮または拡張）を実行する場合があります
- 1回のパス後もハードレンジを外れる場合、InkOS は保存しますが、結果とチャプターインデックスに可視的な文字数警告とテレメトリを表示

### 続編執筆

`inkos import chapters` で既存の小説テキストをインポートし、7つの真実ファイル（世界状態、キャラクターマトリクス、リソース台帳、プロットフックなど）を自動でリバースエンジニアリング。`Chapter N` とカスタム分割パターンに対応し、再開可能なインポートをサポート。インポート後、`inkos write next` でシームレスに物語を継続。

### 二次創作

`inkos fanfic init --from source.txt --mode canon` で原作素材から二次創作書籍を作成。4つのモード：canon（忠実な続編）、au（パラレルワールド）、ooc（キャラクター崩壊）、cp（カップリング重視）。原作インポーター、二次創作専用の監査ディメンション、設定の一貫性を保つ情報境界管理を搭載。

### マルチモデルルーティング

異なるエージェントに異なるモデルとプロバイダーを使用可能。WriterにClaude（より強力なクリエイティブ）、AuditorにGPT-4o（安価で高速）、Radarにローカルモデル（コストゼロ）。`inkos config set-model` でエージェントごとに設定可能；未設定のエージェントはグローバルモデルにフォールバック。

### デーモンモード + 通知

`inkos up` で自律的なバックグラウンドループを開始し、スケジュールに従って章を執筆。重要でない問題についてはパイプラインが完全無人で実行され、人間のレビューが必要な場合に一時停止。TelegramとWebhook（HMAC-SHA256署名 + イベントフィルタリング）による通知。`inkos.log`（JSON Lines）にログ出力、`-q` でクワイエットモード。

### ローカルモデル互換性

任意のOpenAI互換エンドポイント（`--provider custom`）に対応。ストリーム自動フォールバック — SSEがサポートされていない場合、InkOS は自動的に同期モードでリトライ。フォールバックパーサーが小型モデルの非標準出力を処理し、ストリーム中断時には部分コンテンツリカバリが作動。

### 信頼性

章ごとに自動ステートスナップショットを作成 — `inkos write rewrite` で任意の章を執筆前の状態にロールバック可能。Writerは執筆前チェックリスト（コンテキストスコープ、リソース、保留中のフック、リスク）と執筆後決済テーブルを出力し、Auditorが両方をクロスバリデーション。ファイルロックにより同時書き込みを防止。執筆後バリデーターにはクロスチャプター反復検出と11のハードルールによる自動スポット修正を搭載。

フックシステムはZodスキーマバリデーションを使用 — `lastAdvancedChapter` は整数、`status` は open/progressing/deferred/resolved のみ。LLMからのJSONデルタは `applyRuntimeStateDelta`（イミュータブル更新）と `validateRuntimeState`（構造チェック）を経て永続化。破損データは伝播されず、拒否されます。

ユーザー設定の `INKOS_LLM_MAX_TOKENS` がすべてのAPI呼び出しのグローバルキャップとして機能。`llm.extra` の予約キー（max_tokens、temperatureなど）は自動的に除去され、意図しないオーバーライドを防止。

---

## 仕組み

各章は複数のエージェントが順次処理し、人間の介入はゼロで作成されます：

<p align="center">
  <img src="assets/screenshot-pipeline.png" width="800" alt="パイプライン図">
</p>

| エージェント | 担当 |
|-------------|------|
| **Radar** | プラットフォームのトレンドと読者の好みをスキャンして物語の方向性に反映（プラグイン可能、スキップ可能） |
| **Planner** | 著者の意図 + 現在のフォーカス + メモリ取得結果を読み取り、章の意図（必須保持 / 必須回避）を生成 |
| **Composer** | すべての真実ファイルから関連性に基づいてコンテキストを選択し、ルールスタックとランタイムアーティファクトをコンパイル |
| **Architect** | 章の構造を計画：アウトライン、シーンビート、ペーシング目標 |
| **Writer** | コンパイル済みコンテキストから散文を生成（文字数管理、対話駆動） |
| **Observer** | 章テキストから9カテゴリのファクトを過剰抽出（キャラクター、ロケーション、リソース、関係性、感情、情報、フック、時間、身体状態） |
| **Reflector** | JSONデルタを出力（フルMarkdownではない）；コードレイヤーがZodスキーマバリデーション後にイミュータブル書き込みを実行 |
| **Normalizer** | 1パスの圧縮/拡張で章の文字数を目標バンドに収める |
| **Continuity Auditor** | 7つの正規真実ファイルに対して下書きを検証、33次元チェック |
| **Reviser** | 監査で発見された問題を修正 — 重大な問題は自動修正、その他は人間レビュー用にフラグ付け |

監査に失敗すると、パイプラインは自動的に修正→再監査ループに入り、すべての重大な問題が解決されるまで続きます。

### 正規真実ファイル

すべての書籍は7つの真実ファイルを唯一の情報源として維持します：

| ファイル | 目的 |
|---------|------|
| `current_state.md` | 世界状態：キャラクターの位置、関係性、知識、感情アーク |
| `particle_ledger.md` | リソース会計：アイテム、金銭、物資の数量と劣化追跡 |
| `pending_hooks.md` | 未解決のプロットスレッド：植えられた伏線、読者への約束、未解決の対立 |
| `chapter_summaries.md` | 章ごとのサマリー：キャラクター、主要イベント、状態変化、フックの動態 |
| `subplot_board.md` | サブプロット進行ボード：A/B/Cラインのステータス追跡 |
| `emotional_arcs.md` | 感情アーク：キャラクターごとの感情追跡と成長 |
| `character_matrix.md` | キャラクター相互作用マトリクス：遭遇記録、情報境界 |

継続性監査エージェントがすべての下書きをこれらのファイルに対してチェックします。キャラクターが目撃していないことを「覚えて」いたり、2章前に失った武器を取り出したりすると、監査エージェントがそれを検出します。

0.6.0以降、真実ファイルの権威あるソースはMarkdownから `story/state/*.json`（Zodスキーマバリデーション済み）に移行しました。SettlerはフルMarkdownファイルを出力せず、永続化前にイミュータブルに適用され構造的に検証されるJSONデルタを生成します。Markdownファイルは人間が読めるプロジェクションとして保持されます。既存書籍は初回実行時に自動マイグレーション。

Node 22+ では、SQLite時系列メモリデータベース（`story/memory.db`）が自動的に有効化され、過去のファクト、フック、チャプターサマリーの関連性ベースの取得をサポート — ファイル全量注入によるコンテキスト肥大化を防止。

<p align="center">
  <img src="assets/screenshot-state.png" width="800" alt="真実ファイルのスナップショット">
</p>

### コントロールサーフェスとランタイムアーティファクト

7つの真実ファイルに加え、InkOS はガードレールをカスタマイズからレビュー可能なコントロールドキュメントに分離します：

- `story/author_intent.md`：長期的な著者の意図
- `story/current_focus.md`：短期的なステアリング
- `story/runtime/chapter-XXXX.intent.md`：章の目標、保持/回避リスト、対立の解決
- `story/runtime/chapter-XXXX.context.json`：この章のために選択された実際のコンテキスト
- `story/runtime/chapter-XXXX.rule-stack.yaml`：優先度レイヤーとオーバーライド関係
- `story/runtime/chapter-XXXX.trace.json`：この章のコンパイルトレース

つまり、ブリーフ、アウトラインノード、ブックルール、現在のリクエストが1つのプロンプトブロブに混ぜ合わされることはなくなりました。InkOS はまずコンパイルし、それから執筆します。

### 執筆ルールシステム

Writerエージェントには約25の汎用執筆ルール（キャラクタークラフト、ナラティブテクニック、論理的一貫性、言語制約、脱AI化）があり、すべてのジャンルに適用されます。

その上に、各ジャンルには専用ルール（禁止事項、言語制約、ペーシング、監査ディメンション）があり、各書籍には独自の `book_rules.md`（主人公の性格、数値上限、カスタム禁止事項）、`story_bible.md`（世界観設定）、`author_intent.md`（長期的な方向性）、`current_focus.md`（短期的なステアリング）があります。`volume_outline.md` はデフォルトプランとして機能しますが、v2入力ガバナンスでは現在の章の意図を自動的にオーバーライドしなくなりました。

## 使用モード

InkOS は3つのインタラクションモードを提供し、すべて同じアトミック操作を共有します：

### 1. フルパイプライン（ワンコマンド）

```bash
inkos write next my-book              # Draft → audit → 自動修正、すべて一括
inkos write next my-book --count 5    # 5章連続で執筆
```

`write next` はデフォルトで `plan -> compose -> write` ガバナンスチェーンを使用します。以前のプロンプトアセンブリパスが必要な場合は、`inkos.json` で明示的に設定してください：

```json
{
  "inputGovernanceMode": "legacy"
}
```

デフォルトは `v2` になりました。`legacy` は明示的なフォールバックとして引き続き利用可能です。

### 2. アトミックコマンド（コンポーザブル、外部エージェントフレンドリー）

```bash
inkos plan chapter my-book --context "まずメンターとの対立にフォーカス" --json
inkos compose chapter my-book --json
inkos draft my-book --context "ダンジョンボス戦とパーティダイナミクスにフォーカス" --json
inkos audit my-book 31 --json
inkos revise my-book 31 --json
```

各コマンドは単一の操作を独立して実行。`--json` で構造化データを出力。`plan` / `compose` は入力を管理し、`draft` / `audit` / `revise` は散文と品質チェックを処理。外部AIエージェントから `exec` 経由で呼び出し可能で、スクリプトでも使用できます。

### 3. 自然言語エージェントモード

```bash
inkos agent "ダンジョン世界のヒーラークラスのMCを持つLitRPG小説を書いて"
inkos agent "次の章を書いて、ボス戦と戦利品の分配にフォーカス"
inkos agent "1つの呪文しか使えない魔法使いのプログレッションファンタジーを作成して"
```

18種類の組み込みツール（write_draft、plan_chapter、compose_chapter、audit_chapter、revise_chapter、scan_market、create_book、update_author_intent、update_current_focus、get_book_status、read_truth_files、list_books、write_full_pipeline、web_fetch、import_style、import_canon、import_chapters、write_truth_file）を搭載し、LLMがツール使用で呼び出し順序を決定。推奨エージェントフロー：まずコントロールサーフェスを調整し、次に `plan` / `compose`、その後ドラフトのみまたはフルパイプライン執筆を選択。

## CLIリファレンス

| コマンド | 説明 |
|---------|------|
| `inkos init [name]` | プロジェクトを初期化（nameを省略するとカレントディレクトリを初期化） |
| `inkos book create` | 新しい書籍を作成（`--genre`、`--chapter-words`、`--target-chapters`、`--brief <file>`、`--lang en/zh`） |
| `inkos book update [id]` | 書籍設定を更新（`--chapter-words`、`--target-chapters`、`--status`、`--lang`） |
| `inkos book list` | すべての書籍を一覧表示 |
| `inkos book delete <id>` | 書籍とそのすべてのデータを削除（`--force` で確認をスキップ） |
| `inkos genre list/show/copy/create` | ジャンルの表示、コピー、作成 |
| `inkos plan chapter [id]` | 次の章の `intent.md` を生成（`--context` / `--context-file` で現在のステアリング） |
| `inkos compose chapter [id]` | 次の章の `context.json`、`rule-stack.yaml`、`trace.json` を生成 |
| `inkos write next [id]` | フルパイプライン：次の章を執筆（`--words` でオーバーライド、`--count` でバッチ、`-q` クワイエットモード） |
| `inkos write rewrite [id] <n>` | 第N章をリライト（ステートスナップショットを復元、`--force` で確認をスキップ） |
| `inkos draft [id]` | ドラフトのみ執筆（`--words` で文字数をオーバーライド、`-q` クワイエットモード） |
| `inkos audit [id] [n]` | 特定の章を監査 |
| `inkos revise [id] [n]` | 特定の章を修正 |
| `inkos agent <instruction>` | 自然言語エージェントモード |
| `inkos review list [id]` | 下書きをレビュー |
| `inkos review approve-all [id]` | 一括承認 |
| `inkos status [id]` | プロジェクトのステータス |
| `inkos export [id]` | 書籍をエクスポート（`--format txt/md/epub`、`--output <path>`、`--approved-only`） |
| `inkos fanfic init` | 原作素材から二次創作書籍を作成（`--from`、`--mode canon/au/ooc/cp`） |
| `inkos config set-global` | グローバルLLM設定を設定（~/.inkos/.env） |
| `inkos config set-model <agent> <model>` | エージェントごとのモデルオーバーライド（`--base-url`、`--provider`、`--api-key-env`） |
| `inkos config show-models` | 現在のモデルルーティングを表示 |
| `inkos doctor` | セットアップの問題を診断（API接続テスト + プロバイダー互換性ヒント） |
| `inkos detect [id] [n]` | AIGC検出（`--all` で全章、`--stats` で統計） |
| `inkos style analyze <file>` | 参考テキストを分析してスタイルフィンガープリントを抽出 |
| `inkos style import <file> [id]` | スタイルフィンガープリントを書籍にインポート |
| `inkos import chapters [id] --from <path>` | 続編執筆用に既存の章をインポート（`--split`、`--resume-from`） |
| `inkos analytics [id]` / `inkos stats [id]` | 書籍分析（監査合格率、主要な問題、章ランキング、トークン使用量） |
| `inkos studio` | Webワークベンチを起動（`-p` でポート指定、デフォルト4567） |
| `inkos up / down` | デーモンの開始/停止（`-q` クワイエットモード、`inkos.log` に自動出力） |

`[id]` はプロジェクトに書籍が1つしかない場合に自動検出されます。すべてのコマンドが `--json` による構造化出力に対応。`draft` / `write next` / `plan chapter` / `compose chapter` は `--context` でステアリング可能、`--words` で目標章サイズをオーバーライド。`book create` は `--brief <file>` でクリエイティブブリーフを渡せます — アーキテクトがゼロから生成するのではなく、あなたのアイデアを基に構築します。`plan chapter` / `compose chapter` はライブLLMを必要としないため、APIセットアップ完了前でも管理された入力を確認できます。

## ロードマップ

- [x] ~~`packages/studio` Webワークベンチ（Vite + React + Hono）~~ — リリース済み、`inkos studio` で起動
- [ ] インタラクティブフィクション（分岐ナラティブ + 読者の選択）
- [ ] 部分的な章介入（章の半分をリライト + 真実ファイルの連鎖更新）
- [ ] カスタムエージェントプラグインシステム

## コントリビューション

コントリビューション歓迎。IssueまたはPRを作成してください。

```bash
pnpm install
pnpm dev          # すべてのパッケージのウォッチモード
pnpm test         # テストを実行
pnpm typecheck    # 出力なしで型チェック
```

## ライセンス

[AGPL-3.0](LICENSE)
