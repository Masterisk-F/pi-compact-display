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
 * tools.ts の renderCall と index.ts の mcp 整形ロジックを抽出したもの。
 */
export function formatCallLine(toolName: string, args: any): string {
  args = args ?? {};

  if (toolName === 'bash') {
    const cmd = typeof args.command === 'string' ? args.command : '';
    const truncated = cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
    return `$ ${truncated}`;
  }

  if (toolName === 'write') {
    const n = typeof args.content === 'string' ? args.content.split('\n').length : 0;
    const path = typeof args.path === 'string' ? args.path : '...';
    return `write ${path}` + (n > 0 ? ` (${n} lines)` : '');
  }

  if (toolName === 'edit') {
    const path = typeof args.path === 'string' ? args.path : '...';
    return `edit ${path}`;
  }

  if (toolName === 'mcp') {
    // ベース名は getEffectiveToolName に統一 (例: mcp:read)。グループヘッダーと
    // コール行の表示が食い違わないようにするために独自の 'mcp call <tool>' は使わない。
    const base = getEffectiveToolName(toolName, args);
    // Parse args.args (JSON string) for display
    let actualArgs: Record<string, unknown> = {};
    if (typeof args.args === 'string') {
      try {
        actualArgs = JSON.parse(args.args);
      } catch {
        actualArgs = {};
      }
    }
    const keys = Object.keys(actualArgs);
    let argsStr = '';
    if (keys.length > 0) {
      const parts = keys.map((k: string) => {
        const v = actualArgs[k];
        const vStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
        const truncatedV = vStr.length > 30 ? vStr.slice(0, 27) + '...' : vStr;
        return `${k}: ${truncatedV}`;
      });
      argsStr = ` { ${parts.join(', ')} }`;
    }
    return `${base}${argsStr}`;
  }

  return getEffectiveToolName(toolName, args);
}

/**
 * ツール結果から「画面に出すテキスト」を決める。
 *
 * Pi はツールごとに主データの置き場が違う:
 *   - edit  : result.content は "Successfully replaced N block(s)..." のみで、
 *             差分本体は result.details.diff にある
 *   - write : result.content は "Successfully wrote N bytes..." のみで、
 *             書き込み内容は args.content にある
 *   - その他 : result.content が実行結果そのもの
 *
 * また result.content は複数の text ブロックを持ちうる (MCP 系ツールなど)。
 * Pi 本体の getTextOutput と同じく全ブロックを改行で連結する。
 * 最初の 1 件だけを見ると 2 件目以降が消える。
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
    if (typeof c === "string" && c) return c;
  }

  // 既定: content の全 text ブロックを改行で連結する
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b?.text ?? "")
    .join("\n");
}

/**
 * 整形済みのツール結果テキストを着色する。
 *
 * edit の diff は行頭の +/- で意味が変わるため、Pi 本体と同じ renderDiff を使って
 * 削除行を赤・追加行を緑で描画する。他ツールの出力は一律 toolOutput 色のまま。
 * (formatOutput は ANSI を除去するため、必ず整形後に呼ぶこと)
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

