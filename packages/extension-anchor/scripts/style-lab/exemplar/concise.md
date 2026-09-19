<!--
「标准示范」—— 讲解的**长相与口吻以此为准**（D89 起草，D90 由用户定稿为标准）。

  * `ANCHOR_EXEMPLAR_START` 标记之后的全部内容会**原样**进 system prompt 的「示范」小节。
  * 上面的代码块别动 —— 示范讲的就是它（scripts/style-lab/anchors/ring_buffer.c，行号=编辑器行号）。
  * 要制定**更详细 / 更精简**的示范：复制本文件、换个名字（文件名就是变体名，
    例如 detailed.md / concise.md），只改标记之后的内容 ——
    实验台把 exemplar/ 下每一个 .md 都当一个变体跑，`--only standard,concise` 可以选着跑。
  * 想要"没有示范"的对照（现行简约档指令），跑实验台时加 `--baseline`。
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

**summary** ：这是一个固定大小的环形缓冲区，用来在写入方和读取方之间传递整数，双方不需要互相等待。它始终空着一个格子，用来区分“空”和“满”。

**第 1 步：写入（第 14-23 行）**

目标是把一个整数放进去。如果已经满了，就拒绝，返回失败，避免覆盖还没取走的数据；如果没满，就放进去并返回成功。

**第 2 步：读取（第 25-33 行）**

目标是从中取出一个整数。如果是空的，就拒绝，返回失败，因为没有数据可以取；如果不空，就取出一个整数并返回成功。
