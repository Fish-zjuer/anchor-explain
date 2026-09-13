/**
 * 配置的**读取侧**：vscode 设置 + `SecretStorage`。
 * 事实源：docs/CONTRACTS.md §6。算配置的纯逻辑在 `../config.ts`。
 *
 * @anchor 两条读取路径的分工是 D25 的取舍：
 *   - `apiKey` **优先从 `SecretStorage` 读**（`preferSecretStorage` 默认 true）——
 *     它不进 settings.json，也就不进 git、不进截图、不进同步。
 *   - 取不到才回落到设置里的 `apiKey`（有人就是喜欢一个文件管全部）。
 *
 * `providers` 里那份 apiKey 是**明文**，所以设置界面里要说清这件事；
 * 存 key 的正路是 `Anchor: 设置 API Key` 命令。
 */

import * as vscode from 'vscode';
import { apiKeySecretName, resolveConfig } from '../config.ts';
import type { AnchorConfig } from '../config.ts';

const SECTION = 'anchorExplain';

export async function readAnchorConfig(context: vscode.ExtensionContext): Promise<AnchorConfig> {
  // 每次讲解都现读一次：改完设置不必重载窗口（这正是 ExplainProvider 保持"一个函数"的好处）
  const settings = vscode.workspace.getConfiguration(SECTION);
  const raw = {
    providers: settings.get('providers'),
    activeProvider: settings.get('activeProvider'),
    maxFetchRounds: settings.get('maxFetchRounds'),
    preferSecretStorage: settings.get('preferSecretStorage'),
    temperature: settings.get('temperature'),
  };

  const config = resolveConfig(raw);
  if (!config.provider) return config;

  if (config.preferSecretStorage) {
    try {
      const stored = await context.secrets.get(apiKeySecretName(config.providerId));
      if (stored) return { ...config, provider: { ...config.provider, apiKey: stored } };
    } catch (err) {
      // SecretStorage 在某些环境（远程/无 keyring）会抛。**不能因此让讲解不可用**，
      // 静默回落到设置里的 key；真要排查时日志里有。
      console.error('[anchor] 读 SecretStorage 失败，回落到设置里的 apiKey：', err);
    }
  }

  return config;
}

/** 存 key 的那条命令的服务端。返回是否真的存进去了，好让调用方给出如实的提示。 */
export async function storeApiKey(context: vscode.ExtensionContext, providerId: string): Promise<boolean> {
  const key = await vscode.window.showInputBox({
    title: `Anchor：${providerId} 的 API Key`,
    prompt: '存进 VS Code 的 SecretStorage（不写进 settings.json）。留空则删除已存的 key。',
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) return false; // 用户按 Esc

  const name = apiKeySecretName(providerId);
  if (key.trim() === '') {
    await context.secrets.delete(name);
    void vscode.window.showInformationMessage(`Anchor：已删除 ${providerId} 的 API Key。`);
    return true;
  }

  await context.secrets.store(name, key.trim());
  void vscode.window.showInformationMessage(`Anchor：已把 ${providerId} 的 API Key 存进 SecretStorage。`);
  return true;
}

/** 供设置命令挑选 provider id：优先用已配置的那些，一个都没有时退回默认 id。 */
export function configuredProviderIds(): string[] {
  const providers = vscode.workspace.getConfiguration(SECTION).get('providers');
  if (typeof providers !== 'object' || providers === null) return [];
  return Object.keys(providers as Record<string, unknown>);
}
