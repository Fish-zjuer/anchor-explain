/**
 * 给 LLM 的工具定义。事实源：docs/CONTRACTS.md §8。
 *
 * @anchor §8 是契约，改它要先改 CONTRACTS.md —— **但契约不等于不能改**。
 *         这里曾长期缺一个 `path`：跨文件取件的"许可"只写在文档与系统提示里，
 *         而**模型唯一能看见的能力清单是这份 schema** —— 主流端点按 schema 生成参数，
 *         未声明的项模型基本不会给。于是模型根本没有"点名某个文件"这个动作，
 *         表现为"它就是没有往外读的想法"。S9a 实测返工时才看清：**许可必须可执行**（D67）。
 *
 *         另外两处同批改动：`description` 里删掉"当前文档"（它一直在说"只有这份文档"），
 *         `required` 补上 `start`/`end`（缺了只会白烧一轮取件预算，而它们每次取件都必然要有）。
 *
 * 本文件属 orchestrator/，**禁止 import 'vscode'**。
 */

import type { ContextRequest } from '@anchor/core';

/** §8 原文（S9a 修订见 `DECISIONS.md` D67，改动都记在 `CONTRACTS.md` §8）。 */
export const FETCH_CONTEXT_TOOL = {
  name: 'fetch_context',
  description:
    '当手里的信息不足、无法准确讲解时，请求额外上下文：当前文档的一段（按页/行），' +
    '或者与它逻辑相关的另一个文件的一小段。',
  parameters: {
    type: 'object',
    properties: {
      request_type: {
        enum: ['page_range', 'dom_subtree', 'file'],
        description: 'page_range = PDF 页码；file = 代码文件的行范围（也可以是别的文件）',
      },
      start: { type: 'number', description: '起始页/行（1-based，必须给）' },
      end: { type: 'number', description: '结束页/行（1-based，必须给）' },
      // 这一项是"能不能往外读"的关键：没有它，模型没有点名文件的手段
      path: {
        type: 'string',
        description:
          'request_type 为 file 时要读的文件；省略 = 锚点所在的文件。' +
          '写相对路径时按锚点文件所在目录算，例如 ring_buffer.h',
      },
      reason: { type: 'string', description: '为什么需要这段上下文' },
    },
    required: ['request_type', 'start', 'end', 'reason'],
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
      "location": { "filePath": "<文件路径：锚点文件，或你这次取件读过的文件>", "lineStart": 1, "lineEnd": 2 },
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
 * §8 现在**声明了** `path`（S9a 修订，D67），但解析侧仍然"声明什么不管、自定义键一律带过去" ——
 * 这一层只做形状解析，不做"字段是否在白名单里"的判断。丢掉未知键会让规则的演进
 * 变成一次静默的失败（S3 就踩过：`path` 在解析这一步没了，于是所有取件请求都被判成
 * "只允许取锚点所在的文件"）。
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
