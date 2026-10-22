import fs from 'fs';

export type DisplayMode = 'count_only' | 'lines' | 'default';

export interface ToolConfig {
  mode: DisplayMode;
  outputLines?: number;
  noPadding?: boolean;
  /** ツール個別設定: false を指定するとグローバルの grouping が true でもこのツールはグループ化から除外される */
  grouping?: boolean;
}

export interface UserConfig {
  noPadding?: boolean;
}

export type Config = Record<string, ToolConfig> & {
  user?: UserConfig;
  /** スキル呼び出し ([skill] 表示) の個別設定: noPadding を指定できる (UserConfig と同一構造) */
  skill?: UserConfig;
  /** Group consecutive lines-mode tool rows without crossing visible transcript content. */
  grouping?: boolean;
  /** グローバル設定: true でアシスタントメッセージ内の thinking ブロック表示を抑制する */
  hideThinking?: boolean;
  /** TUI-only (Pi 1.2.0 tested): fold intermediate assistant text/tools; final response stays visible. */
  turnFolding?: boolean;
  /**
   * 実行中の折りたたんだ過程カードに残す直近の行数 (アシスタントの進捗テキストとツール行)。
   * 実行終了後・履歴再表示時はプレビューを隠し、最終回答のみを表示する。
   * 既定は 3。ツールは各ツールの設定どおり (グループ化・count_only など) に折りたたんで表示する。
   * 解釈は turn.ts が持つ (この値は型と Proxy の除外のみを担う)。
   */
  turnPreviewRows?: number;
};

export function loadConfig(configPath: string): Config {
  let userConfig: Partial<Config> = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      userConfig = JSON.parse(content);
    } catch (e) {
      // Ignore parse errors and use empty
    }
  }

  // Proxy to return 'default' for any unconfigured tool
  return new Proxy(userConfig as Config, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop);
      }
      if (prop === 'then' || prop === 'toJSON') {
        return undefined;
      }
      if (prop in target) {
        return target[prop];
      }
      if (prop === 'user' || prop === 'skill' || prop === 'grouping' || prop === 'hideThinking' || prop === 'turnFolding' || prop === 'turnPreviewRows') {
        return undefined;
      }
      if ('default' in target) {
        return target['default'];
      }
      return { mode: 'default' };
    }
  });
}

export function getEffectiveToolName(toolName: string, args: any): string {
  if (!args || typeof args !== 'object') return toolName;

  // ゲートウェイ型ツールは tool / action 引数の値でサブツール名を決める。
  // ツール固有の引数名 (server / connect / describe 等) は評価しない。
  if (args.tool && typeof args.tool === 'string') return `${toolName}:${args.tool}`;
  if (args.action && typeof args.action === 'string') return `${toolName}:${args.action}`;
  return toolName;
}

export function resolveToolConfig(toolName: string, args: any, config: Config): ToolConfig {
  const effectiveName = getEffectiveToolName(toolName, args);
  if (effectiveName !== toolName && (effectiveName in config)) {
    return config[effectiveName];
  }
  return config[toolName];
}
