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

**summary** ：此文件实现固定容量 `RB_SIZE` 的环形缓冲区，底层是数组 `buf`，读位置是 `head`，写位置是 `tail`。`rb_push(rb, v)` 尝试把整数 `v` 写入缓冲区；`rb_pop(rb, out)` 尝试从缓冲区取出一个整数，并通过 `out` 返回给调用者。写入方和读取方不需要互相等待。空与满用“始终保留一个空位”区分：`head == tail` 表示空；`tail` 的下一个位置等于 `head` 表示满。

**第 1 步：写入——检查满，写入 `v`，推进 `tail`（第 14-23 行）**

`rb_push` 的第二个参数 `v` 是本次要写入缓冲区的整数；`rb` 指向目标缓冲区。

- 计算下一个写入位置（第 16 行）：`next = (rb->tail + 1) % RB_SIZE`。`next` 是写入 `v` 之后 `tail` 应处的位置，也是判断满的依据。
- 满判据 `next == rb->head`（第 17-18 行）：
  - True：缓冲区满。`tail` 当前格子是最后一个可用空位；若写入 `v` 并令 `tail = next`，`tail` 会与 `head` 重合，而 `head == tail` 已被定义为空，满和空无法区分。因此返回 `false`，不写入 `v`。
  - False：`next` 与 `head` 不重合，至少有一个空位。继续写入。
- 写入与推进顺序（第 20-21 行）：先执行 `rb->buf[rb->tail] = v`，把 `v` 存入 `tail` 当前格子；再执行 `rb->tail = next`。若先推进 `tail`，调用 `rb_pop` 的代码可能在新位置读到尚未写入的数据；先写后移保证 `tail` 更新时 `v` 已经就绪。最后返回 `true`。

**第 2 步：读取——检查空，读出数据，推进 `head`（第 25-33 行）**

`rb_pop` 的第二个参数 `out` 是指向调用者变量的指针，用来接收读出的整数。

- 空判据 `rb->head == rb->tail`（第 27-29 行）：
  - True：没有数据可读。`head` 与 `tail` 相等表示已写入的数据全部取走。返回 `false`，不修改 `*out`。
  - False：存在可读数据，继续。
- 读出与推进顺序（第 30-31 行）：先执行 `*out = rb->buf[rb->head]`，把 `head` 当前格子的数据交给调用者；再执行 `rb->head = (rb->head + 1) % RB_SIZE`。若先推进 `head`，该格子会被视为可写，调用 `rb_push` 的代码可能覆盖尚未交给 `*out` 的数据；先读后移保证数据已经交给调用者。最后返回 `true`。
