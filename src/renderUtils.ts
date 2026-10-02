import { renderDiff } from "@earendil-works/pi-coding-agent";
import { getEffectiveToolName, ToolConfig } from './config';
import { sanitizeToolText } from './sanitize';

export function formatOutput(input: string, config: ToolConfig, expanded: boolean): string {
  // ツール出力はホストの getTextOutput と同じ意味論 (stripAnsi + 制御文字除去 + CR 除去) で
  // 無害化してから整形する。グループカード展開時と拡張 default ルートがホストの
  // サニタイザを迂回して ANSI/OSC-8 バイトが端末に届かないようにするため。
  let lines = sanitizeToolText(input).split('\n');

  if (config.noPadding) {
    lines = lines.filter(line => line.trim() !== '');
  }

  if (!expanded && config.outputLines !== undefined) {
    lines = lines.slice(0, config.outputLines);
  }

  return lines.join('\n');
}

/**
 * ツール呼び出しの1行表示 (グループカードのコール行・ツールのコール行表示で共用)。
 * tools.ts の renderCall から抽出したもの。mcp も他のツールと同じ規則で整形する。
 */
export function formatCallLine(toolName: string, args: any): string {
  args = args ?? {};

  let line: string;
  if (toolName === 'bash') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    // 切り詰めない: Text コンポーネントが端末幅で折り返すため、長いコマンドでも
    // 末尾 (実行内容そのもの) が失われない。ホストの formatBashCall と同じ方針。
    line = `$ ${cmd}`;
  } else if (toolName === 'write') {
    const n = typeof args.content === 'string' ? args.content.split('\n').length : 0;
    const path = typeof args.path === 'string' ? args.path : '...';
    line = `write ${path}` + (n > 0 ? ` (${n} lines)` : '');
  } else if (toolName === 'edit') {
    const path = typeof args.path === 'string' ? args.path : '...';
    line = `edit ${path}`;
  } else {
    line = getEffectiveToolName(toolName, args);
  }

  return sanitizeToolText(line);
}

/**
 * ツール結果から「画面に出すテキスト」を決める (edit は details.diff、write は args.content に本体がある)。
 * content は全 text ブロックを改行連結する — Pi 本体 getTextOutput と同じで、1 件目だけ見ると 2 件目以降が消える。
 */
export function resolveResultText(toolName: string, args: any, result: any): string {
  // edit の差分 (成功時のみ。エラー時は content にエラー文が入っている)
  if (toolName === "edit" && !result?.isError) {
    const diff = result?.details?.diff;
    if (typeof diff === "string" && diff) return diff;
  }

  // write の書き込み内容 (成功時のみ。エラー時は content にエラー文が入っている)
  if (toolName === "write" && !result?.isError) {
    const c = args?.content;
    if (typeof c === "string") return c;
  }

  // 既定: content の全 text ブロックを改行で連結する
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b?.text ?? "")
    .join("\n");
}

/**
 * 整形済みのツール結果テキストを着色する。edit の diff のみ行頭 +/- に意味があるため renderDiff を使う。
 * (formatOutput は ANSI を除去するので、必ず整形後に呼ぶこと)
 */
export function colorizeResult(toolName: string, text: string, theme: any): string {
  if (!text) return "";

  const colorizePlain = (t: string) =>
    t.split("\n").map((l: string) => theme.fg("toolOutput", l)).join("\n");

  if (toolName !== "edit") return colorizePlain(text);

  try {
    return renderDiff(text);
  } catch {
    // テーマ未初期化などで renderDiff が失敗しても表示は壊さない
    return colorizePlain(text);
  }
}

