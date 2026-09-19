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

**summary** ：这个文件实现一个固定大小的环形缓冲区。它用一个数组循环存放整数，`head` 记录读位置，`tail` 记录写位置。`rb_push` 尝试写入一个整数；`rb_pop` 尝试读出一个整数。写入方和读取方不需要互相等待。空和满的判据、以及为什么这样判，在第 2 步和第 3 步逐行解释。

**第 1 步：先看数据结构和两个位置（第 1-12 行）**

- 第 1-3 行：注释。说明这是一个环形缓冲区，只有一个写入方和一个读取方，不需要加锁。注释里提到空和满的判据是“留一个空位”：`head == tail` 是空，`(tail + 1) % N == head` 是满。这里只是注释，不是可执行代码；`N` 对应下面的 `RB_SIZE`。具体为什么，在第 2 步第 17 行展开。
- 第 4 行：`#include <stdbool.h>`。引入 `bool`、`true`、`false`。没有它，函数不能直接返回 `true` 或 `false`。
- 第 6 行：`#define RB_SIZE 16`。宏定义。编译前，代码里所有 `RB_SIZE` 都会替换成 `16`。所以数组 `buf` 有 16 个 `int` 格子，下标是 0 到 15。
- 第 8 行：`typedef struct {`。开始定义一个结构体，并准备用 `typedef` 给它起一个类型名。
- 第 9 行：`int buf[RB_SIZE];`。定义一个整数数组 `buf`，长度是 `RB_SIZE`，也就是 16。它用于存放缓冲区里的整数。下标从 0 到 15。
- 第 10 行：`int head;`。定义一个整数 `head`，用于存放读位置。`rb_pop` 会从 `head` 指向的格子取数据。
- 第 11 行：`int tail;`。定义一个整数 `tail`，用于存放写位置。`rb_push` 会把数据写进 `tail` 指向的格子。
- 第 12 行：`} ring_buffer_t;`。结束结构体定义，并把这种结构体命名为 `ring_buffer_t`。以后写 `ring_buffer_t rb;` 就能定义一个这样的缓冲区。

**第 2 步：写入——满了不写，没满就写入并移动写位置（第 14-23 行）**

- 第 14 行：`bool rb_push(ring_buffer_t *rb, int v)`。定义函数 `rb_push`。返回类型是 `bool`，表示成功或失败。参数 `rb` 是一个指针，指向要操作的缓冲区；参数 `v` 是本次要写入的整数。
- 第 15 行：`{`。函数体开始。
- 第 16 行：`int next = (rb->tail + 1) % RB_SIZE;`。定义一个整数 `next`，用于存放“如果写入当前 `tail` 格，写位置下一步应该到哪里”。`rb->tail` 表示“`rb` 指向的结构体里的 `tail` 成员”，等价于 `(*rb).tail`。`+ 1` 是往后走一格。`% RB_SIZE` 是取余数：如果 `tail` 是 15，`(15 + 1) % 16` 得到 0，于是下标从末尾绕回开头。`next` 是写入之后 `tail` 要去的新位置，也是判断满的依据。
- 第 17 行：`if (next == rb->head) {`。判断缓冲区是否已经满了。这里不能只看 `tail == head`，因为 `tail == head` 已经被定义为“空”。满要用“写位置的下一个位置撞上读位置”表示，也就是 `next == head`。具体推演：假设 `RB_SIZE` 是 16，`head` 是 0，`tail` 是 15。此时已经写入但还没读走的数据在 `buf[0]` 到 `buf[14]`，一共 15 个。`tail` 指向 `buf[15]`，这是最后一个空位。如果这时再把一个整数写进 `buf[15]`，然后执行 `tail = (15 + 1) % 16`，`tail` 就会变成 0。于是 `head` 是 0，`tail` 也是 0。可是 `head == tail` 已经被用来表示“空”。刚写满却变得像“空”，读取方就无法区分到底是满还是空。所以最后一个空位不能写。当 `next == head` 时，就是这种情况：再写一个，`tail` 就会和 `head` 重合。因此这个条件表示满，直接返回 `false`。如果 `next != head`，说明至少还有一个空位可以写。
- 第 18 行：`return false;`。如果满了，就返回 `false`，表示这次写入失败。调用者看到 `false` 就知道数据没有放进去。
- 第 19 行：`}`。结束 `if`。
- 第 20 行：`rb->buf[rb->tail] = v;`。把整数 `v` 写进 `tail` 当前指向的格子。注意这里用的是 `tail`，不是 `next`。`tail` 是当前可写的位置；`next` 是写完之后要移动到的位置。
- 第 21 行：`rb->tail = next;`。写入完成后，把 `tail` 更新成 `next`。这样下一个数据会写到新的位置。顺序必须是先写数据，再移动 `tail`；如果先移动 `tail`，读的一方可能以为有新数据，但数据其实还没写好。
- 第 22 行：`return true;`。返回 `true`，表示写入成功。
- 第 23 行：`}`。函数结束。

**第 3 步：读取——空了不读，有数据就读出并移动读位置（第 25-33 行）**

- 第 25 行：`bool rb_pop(ring_buffer_t *rb, int *out)`。定义函数 `rb_pop`。返回类型是 `bool`，表示成功或失败。参数 `rb` 指向缓冲区。参数 `out` 是一个指针，指向调用者提供的整数变量；函数成功时会把读出的整数写进 `*out`。
- 第 26 行：`{`。函数体开始。
- 第 27 行：`if (rb->head == rb->tail) {`。判断缓冲区是否为空。`head` 是读位置，`tail` 是写位置。两者相等，说明已经写入的数据全部被取走了，没有数据可读。具体推演：初始时 `head == tail`，表示空；每写入一个数据，`tail` 往后移一格；每读出一个数据，`head` 往后移一格；当 `head` 追上 `tail`，就读完了。
- 第 28 行：`return false;`。如果为空，就返回 `false`，表示读取失败。这里不修改 `*out`，调用者不能把 `*out` 当成有效数据。
- 第 29 行：`}`。结束 `if`。
- 第 30 行：`*out = rb->buf[rb->head];`。把 `head` 当前格子的整数赋给 `*out`。`*out` 表示“`out` 指针指向的那个变量”。这样调用者就能拿到读出的数据。
- 第 31 行：`rb->head = (rb->head + 1) % RB_SIZE;`。读出之后，把 `head` 往后移一格。`% RB_SIZE` 同样是为了让下标到末尾后回到 0。顺序必须是先读出数据，再移动 `head`；如果先移动 `head`，写的一方可能覆盖还没交出去的数据。
- 第 32 行：`return true;`。返回 `true`，表示读取成功。
- 第 33 行：`}`。函数结束。

**补充：几个容易卡住的点**

- 空：`head == tail`。满：`next == head`，也就是 `(tail + 1) % RB_SIZE == head`。
- 留一个空位：数组有 16 个格子，但最多存 15 个整数。这样满和空不会都表现为 `head == tail`。
- `% RB_SIZE` 的作用：让下标在 0 到 15 之间循环。`tail + 1` 到 16 时，取余变成 0；`head + 1` 到 16 时也一样。数组就像首尾相接。
- `rb->tail` 和 `*out` 的语法：`rb` 是结构体指针，`rb->tail` 是取它指向的结构体里的 `tail` 成员；`out` 是整数指针，`*out` 是取出 `out` 指向的那个整数变量。
- 为什么写入方和读取方不需要互相等待：写入方只改 `tail`，读取方只改 `head`。双方通过 `head` 和 `tail` 判断能不能写、能不能读。这个示例约定只有一个写入方和一个读取方，所以不需要加锁。
