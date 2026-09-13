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
import { AnchorError } from '@anchor/core';
import { apiKeySecretName, mergeProvider, normalizeBaseUrl, resolveConfig } from '../config.ts';
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

/** 供设置命令挑选 provider id：**只认"值是一个对象"的键**（那才是 provider）。
 *
 * @anchor 不能直接把 `Object.keys` 交出去：用户手写坏过之后，`providers` 里会躺着
 *         `tier1Model` 这种**字段名当键**的残留（少写了一层）。把它当成 provider id 显示出来，
 *         用户看到的是"已有的：tier1Model"，然后我们的输入框会在他填 `DeepSeek` 时
 *         另开一个 provider，两边的值永远对不上（D63）。
 */
export function configuredProviderIds(): string[] {
  const providers = vscode.workspace.getConfiguration(SECTION).inspect<unknown>('providers')?.globalValue;
  if (typeof providers !== 'object' || providers === null) return [];
  return Object.entries(providers as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'object' && value !== null && !Array.isArray(value))
    .map(([key]) => key);
}

/** 用户设置里那个原始的 `providers`（可能是"少一层"的坏形状，交给纯函数去认）。 */
export function rawProviders(): unknown {
  return vscode.workspace.getConfiguration(SECTION).inspect<unknown>('providers')?.globalValue;
}

/** 某个 provider 的原始值。配置命令拿它预填输入框，免得"只改一个字段"要重打整行。 */
export function rawProvider(id: string): Record<string, unknown> | undefined {
  const providers = rawProviders();
  if (typeof providers !== 'object' || providers === null) return undefined;
  const value = (providers as Record<string, unknown>)[id];
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * `Anchor: 配置模型端点` 的**写入侧**：把 baseUrl 与模型名写进用户设置的 `providers[id]`。
 *
 * @anchor 为什么允许写设置（别处我们一律不碰用户的东西）：
 *         这一步本来就是用户必须做的事，而"让他手写一段嵌套 JSON"已经连续坑了两次
 *         （先是没有入口、后是 `activeProvider` 里塞了整段对象 —— D62）。
 *         约束仍然很紧：**只写扩展自己的配置节**、走官方 API（等价于他在设置界面里手改）、
 *         而且**只写 baseUrl 与模型名，永不写 apiKey**（那个只进 SecretStorage）。
 *
 * `inspect().globalValue` 而不是 `get()`：后者会把工作区级的值与默认值一起捞进来，
 * 一次"配置端点"就把别人的设置复制进用户设置 —— 那是污染，不是配置。
 *
 * **写完要验读**（D63）：`settings.json` 有语法错时 `update()` 可能抛错、也可能写进去却被忽略，
 * 而用户看到的都是"我明明填了"。所以这里写完立刻回读，读不回来就**明说失败**，
 * 别让调用方去打印一句"已写入 xxx"的成功文案。
 */
export async function writeProviderSettings(
  id: string,
  baseUrl: string,
  tier1Model: string,
): Promise<{ replaced: boolean; activeChanged: boolean }> {
  const settings = vscode.workspace.getConfiguration(SECTION);
  const merged = mergeProvider(rawProviders(), id, baseUrl, tier1Model);
  await settings.update('providers', merged.providers, vscode.ConfigurationTarget.Global);

  // 配完不指过去，用户会遇到最气人的一种失败：配置明明写对了，讲解却说"没有可用的 provider"
  const active = settings.inspect<string>('activeProvider')?.globalValue;
  const activeChanged = active !== id;
  if (activeChanged) await settings.update('activeProvider', id, vscode.ConfigurationTarget.Global);

  const readBack = rawProvider(id);
  if (!readBack || readBack.baseUrl !== normalizeBaseUrl(baseUrl)) {
    throw new AnchorError(
      'PROVIDER_ERROR',
      '设置没写进去（写完读回来还是旧的）。最常见的原因是 settings.json 里有语法错误 —— ' +
        'VS Code 会拒绝改一个坏掉的文件。打开它看一眼：语法错标红的那一行删掉再试一次。',
    );
  }

  return { replaced: merged.replaced, activeChanged };
}
