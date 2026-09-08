import { writeFile } from 'node:fs/promises';

import { files, readMeta, updateMeta } from './store';
import { minutesToMarkdown, rawToMarkdown } from './markdown';
import { ClaudeCliSummarizer } from './summarizer';
import { segmentsToMarkdown, segmentsToPlainText, transcribe } from './transcribe';
import { pcmToWav } from './wav';

/** 同じ会議のパイプラインが二重に走らないようにする。 */
const running = new Set<string>();

/**
 * 会議終了後の処理をまとめて走らせる。
 *
 * WAV 化 → whisper で文字起こし → claude -p で議事録生成、の直列処理。
 * 各段で meta.json のステータスを更新し、クライアントのポーリングに進捗を見せる。
 *
 * リクエストを塞がないよう、呼び出し側は await せずに投げっぱなしにする。
 */
export async function runPipeline(id: string): Promise<void> {
  if (running.has(id)) return;
  running.add(id);

  try {
    const meta = await readMeta(id);

    // 1. 生 PCM に WAV ヘッダを付け、whisper が扱える音量まで揃える
    await updateMeta(id, { status: 'transcribing' });
    const { durationSec, rmsDbfs, gainDb } = await pcmToWav(files.pcm(id), files.wav(id));
    await updateMeta(id, { durationSec });

    // 2. ローカルの whisper.cpp で文字起こし
    const segments = await transcribe(files.wav(id));
    if (segments.length === 0) {
      // 何も録れていないのか、録れてはいるが小さすぎるのかで対処が変わるので
      // 実測した音量をそのまま出す。-60dBFS を下回るならマイクを疑う。
      throw new Error(
        `音声から発話を検出できませんでした（録音レベル ${rmsDbfs.toFixed(1)}dBFS` +
          `${gainDb >= 1 ? `／+${gainDb.toFixed(1)}dB 増幅後` : ''}）。` +
          'マイクが会議の音を拾えていない可能性があります。',
      );
    }
    await writeFile(files.transcriptMd(id), `${segmentsToMarkdown(segments)}\n`);

    // 3. Claude Code CLI の定額枠で議事録を生成
    await updateMeta(id, { status: 'summarizing' });
    const withDuration = { ...meta, durationSec };
    const result = await new ClaudeCliSummarizer().generate(
      segmentsToPlainText(segments),
      withDuration,
    );

    if (result.ok) {
      // タイトルはここで確定させ、meta.json と minutes.md で食い違わないようにする。
      // ユーザーが題名を付けていればそれを尊重し、既定のままならモデルの案を採る。
      const title =
        meta.title === '無題の会議' && result.minutes.title
          ? result.minutes.title
          : meta.title;
      const finalMeta = { ...withDuration, title };

      await writeFile(files.minutesJson(id), JSON.stringify(result.minutes, null, 2));
      await writeFile(files.minutesMd(id), minutesToMarkdown(result.minutes, finalMeta));
      await updateMeta(id, { status: 'done', title });
    } else {
      // JSON として読めなくても、生成された文章自体は捨てない
      await writeFile(files.minutesMd(id), rawToMarkdown(result.raw, withDuration));
      await updateMeta(id, { status: 'done', rawFallback: true });
    }
  } catch (e) {
    await updateMeta(id, {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    }).catch(() => {
      // meta.json すら書けない状態ならこれ以上できることはない
    });
  } finally {
    running.delete(id);
  }
}
