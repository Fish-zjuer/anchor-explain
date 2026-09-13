/**
 * 给 LLM 的工具定义。事实源：docs/CONTRACTS.md §8（**冻结**）。
 *
 * @anchor §8 的 JSON 一个字都不许改（名称、description、properties、required 四项）。
 *         这里唯一做的事是把它**包成 OpenAI 兼容的 function 形状** ——
 *         前者是契约，后者是厂商格式，两者不是一个东西，别混在一起改。
 *
 * 本文件属 orchestrator/，**禁止 import 'vscode'**。
 */

import type { ContextRequest } from '@anchor/core';

/** §8 原文。改这里等于改契约，须先改 CONTRACTS.md。 */
export const FETCH_CONTEXT_TOOL = {
  name: 'fetch_context',
  description: '当截图区域信息不足、无法准确讲解时，请求获取当前文档的额外上下文。',
  parameters: {
    type: 'object',
    properties: {
      request_type: { enum: ['page_range', 'dom_subtree', 'file'] },
      start: { type: 'number', description: '起始页/行' },
      end: { type: 'number', description: '结束页/行' },
      reason: { type: 'string', description: '为什么需要这段上下文' },
    },
    required: ['request_type', 'reason'],
  },
} as const;

/** OpenAI 兼容端点期望的 `tools` 数组形状。 */
export function openAITools(): readonly unknown[] {
  return [{ type: 'function', function: FETCH_CONTEXT_TOOL }];
}

/** 输出契约：模型必须吐这个形状的 JSON（§3.3 会逐条校验，不合规就重试一次）。 */
export const EXPLANATION_JSON_SHAPE = `{
  "title": "整段讲解的标题（可省）",
  "summary": "一到两句总述，必须非空",
  "confidence": 0.0,
  "steps": [
    {
      "location": { "filePath": "<必须与锚点同一个文件>", "lineStart": 1, "lineEnd": 2 },
      "title": "这一步的标题",
      "intro": "这一步要解决什么",
      "text": "这一步的解释正文，必须非空",
      "highlights": [
        {
          "location": { "filePath": "<同上>", "lineStart": 1, "lineEnd": 1 },
          "narration": "这一行的讲解",
          "emphasis": "primary | context | definition | caveat"
        }
      ]
    }
  ]
}`;

/**
 * 把模型给的 tool_call 参数解析成 `ContextRequest`。
 *
 * **只做形状解析，不做业务校验** —— 合法性（类型是否被允许、区间是否越界、是否重复取件）
 * 全部归 `validateContextRequest`（§3.2）。分开的理由：形状错误是"模型没按格式说话"，
 * 业务拒绝是"模型说了合法的话但这次不许"，两者的回灌文案与调试含义完全不同。
 *
 * **`start` / `end` / `path` 之外的自定义键也会带过去**（`params` 是 `Record<string, any>`）：
 * §8 的 schema 里没有 `path` 这一项，但 §3.2 规则 3 要检查 `params.path` ——
 * 模型很自然会自己加上它。**丢掉它会让规则 3 永远无从检查**（这一条 S3 踩过：
 * 取件请求全被判"只允许取锚点所在的文件"，因为 path 在解析这一步就没了）。
 */
export function parseContextRequest(rawArguments: string): ContextRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const raw = parsed as Record<string, unknown>;
  const type = raw.request_type;
  if (type !== 'page_range' && type !== 'dom_subtree' && type !== 'file') return null;
  if (typeof raw.reason !== 'string' || raw.reason.trim() === '') return null;

  const params: Record<string, unknown> = {};
  // start/end 是 number（§8），但页/行号必须是整数 —— 这里保留原值，
  // 由 §3.2 的规则 2/3 判"是不是整数"，这样拒绝原因里能带上模型实际给的值。
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'request_type' || k === 'reason') continue;
    params[k] = v;
  }

  return { type, params, reason: raw.reason };
}
