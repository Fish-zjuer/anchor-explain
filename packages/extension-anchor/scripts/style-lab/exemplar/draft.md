<!--
线二：示范文本（few-shot exemplar）—— 我起草，你来改。

这份初稿是按**现行简约档**写的。请把它改成你心里"像人话"的版本：

  * 只改「讲解示范」那一节（`ANCHOR_EXEMPLAR_START` 标记之后的全部内容）。
  * 上面的代码块别动 —— 示范讲的就是它。
  * 改完的文本会**原样**进 system prompt 的「示范」小节，所有变体都参考它
    （想对比"没有示范"的效果，跑实验台时加 `--no-exemplar`）。
  * 保持"summary / 第 N 步 / 子点"的形状即可 —— 模型输出的是讲解 JSON，
    示范告诉它的是"长相与口吻"；步骤的行号请保留真实行号（见代码块，编辑器行号从 1 起）。
  * 措辞完全随你：可以删掉"重点/上下文/定义/注意"这些标签，也可以换说法。
-->

## 锚点处的代码

来源：`scripts/style-lab/anchors/ring_buffer.c`（整个文件，共 33 行；示范里的行号就是这里的编辑器行号）。

```c
/* 环形缓冲区：单生产者、单消费者，无锁。
 * 满与空的判据是"留一个空位"：head == tail 是空，(tail + 1) % N == head 是满。
 */
#include <stdbool.h>

#define RB_SIZE 16

typedef struct {
    int buf[RB_SIZE];
    int head;   /* 消费者从这里取 */
    int tail;   /* 生产者往这里写 */
} ring_buffer_t;

bool rb_push(ring_buffer_t *rb, int v)
{
    int next = (rb->tail + 1) % RB_SIZE;
    if (next == rb->head) {
        return false;       /* 满了：留出的那个空位也被占掉会与空混淆 */
    }
    rb->buf[rb->tail] = v;
    rb->tail = next;
    return true;
}

bool rb_pop(ring_buffer_t *rb, int *out)
{
    if (rb->head == rb->tail) {
        return false;       /* 空：head 追上 tail */
    }
    *out = rb->buf[rb->head];
    rb->head = (rb->head + 1) % RB_SIZE;
    return true;
}
```

## 讲解示范（你的修改区）

<!-- ANCHOR_EXEMPLAR_START -->

**summary**：一圈缓冲：生产者往 tail 写、消费者从 head 取，互不等待；满和空靠"故意留一个空位"区分。

**第 1 步：写入——先占位，满了拒收（第 14-23 行）**

数据要进 `buf`，得先算出"下一个能写的位置"；那个位置被消费者占着就拒收，其余时候写完把 `tail` 往前挪一格。

- 重点（第 16-18 行）：`next == head` 就是"满"——这个空位再被占掉，空和满就分不出来了，所以宁可拒收。
- 上下文（第 20-21 行）：先写数据再挪 `tail`。顺序不能反：消费者看到 `tail` 变了就来读，那时数据必须已经在。

**第 2 步：读取——空了拒收，读完才让位（第 25-33 行）**

和写入完全对称：`head == tail` 是"空"；从旧 `head` 的位置读出数据，再把 `head` 往前挪，那个格子才重新变成"可写"。

- 重点（第 27-29 行）：`head == tail` 是"空"，返回 false——调用者拿到的不是垃圾值，是明确的"没有"。
- 注意（第 30-31 行）：先把数据交给 `*out`，再挪 `head`。顺序反了，数据还没读出去就被标记成"已读"。
