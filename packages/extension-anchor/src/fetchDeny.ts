/**
 * 取件的**黑名单**：哪些路径任何档位都不读。**闸门与候选清单共用这一份**（S9a-fix10）。
 *
 * @anchor 为什么单独一个文件：这两处必须**逐字同源**。清单是"这次能读什么"的说明书、
 *         闸门是"这次真读了什么"的执行者 —— 两边判据只要差一条，就会出现
 *         "清单里列着、取件时被拒"（模型白烧一轮，用户以为扩展坏了）或更糟的
 *         "清单里没列、取件却放行"（范围失控）。放在一处就没有第二种可能。
 *
 *         这几条不是"洁癖"，是这个功能**必须有**的：模型能读工作区里的任意文件之后，
 *         `.env`、私钥、`.npmrc` 里的 token 都在它的射程内。宁可少读一个文件，
 *         也不要让一次讲解把密钥发到远端模型去。
 *
 * 本文件是纯字符串判断、**禁止 import 'vscode'**（与 `relatedFiles.ts` 同一个立场）。
 */

import { basenameOf, normPath } from '@anchor/core';

/** 依赖、构建产物、版本控制目录：不读。它们是噪音，且常常巨大。 */
export const DENIED_DIR_SEGMENTS: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.vscode-test',
  '.tmp-preview',
];

/** 按文件名不读的：密钥与凭据。 */
export const DENIED_FILE_PATTERNS: readonly RegExp[] = [
  /^\.env/i,
  /\.pem$/iu,
  /\.key$/iu,
  /\.p12$/iu,
  /\.pfx$/iu,
  /\.jks$/iu,
  /^id_(rsa|dsa|ecdsa|ed25519)/iu,
  /^\.npmrc$/iu,
  /^\.netrc$/iu,
  /^credentials(\.|$)/iu,
];

/** 这个路径按约定不读吗（`any` 档也照挡 —— 它不是范围问题，是"不许外发"的底线）。 */
export function isDeniedPath(filePath: string): boolean {
  const segments = normPath(filePath).split('/');
  if (segments.some((segment) => DENIED_DIR_SEGMENTS.includes(segment))) return true;
  const name = basenameOf(filePath);
  return DENIED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}
