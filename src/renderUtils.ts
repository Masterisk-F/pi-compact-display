import { getEffectiveToolName, ToolConfig } from './config';

export function formatOutput(input: string, config: ToolConfig, expanded: boolean): string {
  if (config.mode !== 'lines') {
    return input;
  }

  let lines = input.split('\n');

  if (config.noPadding) {
    lines = lines.filter(line => line.trim() !== '');
  }

  if (!expanded && config.outputLines !== undefined) {
    lines = lines.slice(0, config.outputLines);
  } else if (expanded) {
    // 全文表示時の上限（プランに記載の通り上限ありとする、例えば 1000行）
    lines = lines.slice(0, 1000);
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
    const action = args.action || (args.tool ? `call ${args.tool}` : '');
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
    return `mcp ${action}${argsStr}`;
  }

  return getEffectiveToolName(toolName, args);
}
