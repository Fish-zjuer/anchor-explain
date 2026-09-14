/**
 * `pdfjs-dist` 只给 `pdf.mjs` 配了 `pdf.d.mts`，**worker 那份没有类型声明**（D74）。
 *
 * @anchor 为什么在这里补一条最小声明而不是 `as any` 撒过去：声明让"我们到底用它哪一部分"
 *         留在**类型面**上（我们只要 `WorkerMessageHandler` 一个导出，挂到
 *         `globalThis.pdfjsWorker` 上让 pdf.js 认出来）。用 `as any` 就等于把这个知识
 *         埋进一句强制转换里，下一个人不知道边界在哪。
 *
 * 事实源：`node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs` 的结尾有
 * `export { WorkerMessageHandler }`，而 `legacy/build/pdf.mjs` 里读的正是
 * `globalThis.pdfjsWorker?.WorkerMessageHandler`。
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  /** pdf.js 在主线程里跑 worker 代码的入口 */
  export const WorkerMessageHandler: unknown;
}
