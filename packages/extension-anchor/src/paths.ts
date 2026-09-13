/**
 * 路径归一与比较。**实现在 `@anchor/core`**（S5 起线2 也要用，所以搬上去了）。
 *
 * @anchor 这个文件保留下来只有一个作用：让线1 内部的 `from '../paths.ts'` 继续成立，
 *         不必在十几个文件里改导入路径。**新增代码请直接从 `@anchor/core` 导入。**
 *         唯一还住在这里的是 `countTextLines` 的转发（它也搬进 core 了）。
 */

export { basenameOf, countTextLines, normPath, samePath } from '@anchor/core';
