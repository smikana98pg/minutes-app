# 構成の設計判断

## 相談内容

### 2026-08-25

**Q:** 会議中に立ち上げておくと議事録が自動生成されるアプリを作りたい。運用コストは完全にゼロにしたい。

**A:** Claude API には音声入力が無いため、構成は必ず3段（①音声取得 → ②文字起こし → ③議事録生成）になる。
無料化の要は③で、選択肢は次の3つだった。

| 案 | 品質 | 実装量 | 備考 |
| --- | --- | --- | --- |
| `claude -p`（Claude Code 定額枠） | Opus 5 そのまま | 小 | レート制限を消費。ネット接続は要 |
| ローカル LLM（Ollama + 4B級） | かなり落ちる | 中〜大 | 完全オフライン。8GB では 4B が上限 |
| 文字起こしまでで止めて手動で貼る | Opus 5 そのまま | 最小 | ひと手間かかる |

**結論:** `claude -p` を採用。マシンに Claude Code CLI がログイン済みで、追加課金ゼロのまま
Opus 5 の品質が得られるため。後から API キー方式へ差し替えられるよう
`lib/server/summarizer.ts` に `Summarizer` インターフェースを切ってある。

---

**Q:** 文字起こしをリアルタイムに回すか、会議後に一括で回すか。

**A:** このマシンは M1 / メモリ 8GB。会議中に推論を回すと Chrome のビデオ会議とメモリ・CPU を奪い合う。

**結論:** 会議後の一括処理。会議中は PCM を書き出すだけで負荷がほぼゼロになる。
副次的に、全体を通して処理できるぶん精度でも有利。

---

**Q:** DB を入れるか。

**結論:** 入れない。会議はせいぜい年数百件で、一覧はディレクトリを読むだけで足りる。
`data/meetings/<id>/` にファイルを並べる形にすると、「保存 = Markdown を書く」で
Markdown 出力の要件も同時に満たせる。

## 詰まったところ

### 2026-08-25

- **状況:** `claude -p` にユーザープロンプト側でスキーマを指定して JSON を返させようとした。
- **問題:** スキーマを完全に無視され、`meeting` / `agenda_items` / `action_items` など独自のキー構成で返ってきた。
- **原因:** CLI 経由には structured outputs のような保証が無く、ユーザープロンプト内のスキーマは
  単なる要望として扱われる。
- **解決策:** スキーマを `--system-prompt` 側に移し、「スキーマに無いキーを追加してはいけない」と明示した。
  これで安定した。加えてパース失敗時に1回だけ再試行し、それでも駄目なら生テキストを
  `minutes.md` に残すフォールバックを入れてある（議事録を失うより良い）。

- **状況:** `next build` で `Static analysis determined that this filesystem access causes the whole project to be traced` という警告。
- **原因:** `lib/server/config.ts` の `path.join(process.cwd(), p)` が動的なため、
  Turbopack がプロジェクト全体を出力に含めようとしていた。
- **解決策:** ローカル専用でトレースは不要なので `path.join(/* turbopackIgnore: true */ process.cwd(), p)` を付けた。

## 汎用的な知見の置き場所

ブラウザでの音声キャプチャ、`claude -p` の使い方、whisper.cpp の運用は他プロジェクトでも使えるため
`~/.claude/knowledge/` 側に置いた。

- [web_audio.md](~/.claude/knowledge/web_audio.md) — マイク＋タブ音声のミックス、AudioWorklet の罠
- [dev_tools.md](~/.claude/knowledge/dev_tools.md) — `claude -p` の headless 利用、whisper.cpp
