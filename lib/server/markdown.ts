import { formatDateTime, formatDuration } from '@/lib/format';
import type { MeetingMeta, Minutes } from '@/lib/types';

/** 議事録を Markdown にする。これがそのまま minutes.md になり、コピー・DL の中身にもなる。 */
export function minutesToMarkdown(minutes: Minutes, meta: MeetingMeta): string {
  const lines: string[] = [
    `# ${meta.title}`,
    '',
    `- 日時: ${formatDateTime(meta.startedAt)}`,
    `- 長さ: ${formatDuration(meta.durationSec)}`,
    '',
    '## 要約',
    '',
    minutes.summary,
    '',
    '## 決定事項',
    '',
  ];

  if (minutes.decisions.length === 0) {
    lines.push('（なし）');
  } else {
    for (const d of minutes.decisions) {
      lines.push(`- ${d.text}`);
      if (d.context) lines.push(`  - 背景: ${d.context}`);
    }
  }

  lines.push('', '## ToDo', '');

  if (minutes.todos.length === 0) {
    lines.push('（なし）');
  } else {
    lines.push('| 担当 | タスク | 期限 |', '| --- | --- | --- |');
    for (const t of minutes.todos) {
      lines.push(`| ${t.assignee ?? '未定'} | ${t.task} | ${t.due ?? '未定'} |`);
    }
  }

  if (minutes.openQuestions.length > 0) {
    lines.push('', '## 未解決の論点', '');
    for (const q of minutes.openQuestions) lines.push(`- ${q}`);
  }

  return `${lines.join('\n')}\n`;
}

/** JSON にパースできなかった場合に、生の出力をそのまま議事録として残す。 */
export function rawToMarkdown(raw: string, meta: MeetingMeta): string {
  return [
    `# ${meta.title}`,
    '',
    `- 日時: ${formatDateTime(meta.startedAt)}`,
    `- 長さ: ${formatDuration(meta.durationSec)}`,
    '',
    '> 構造化された議事録の生成に失敗したため、モデルの出力をそのまま記録しています。',
    '',
    raw.trim(),
    '',
  ].join('\n');
}
