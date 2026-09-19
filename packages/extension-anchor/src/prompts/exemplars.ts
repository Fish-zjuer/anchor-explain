/**
 * 三档风格各自的「示范」正文（D93：三档全部示范驱动）。
 *
 * @anchor 唯一的编辑面是 scripts/style-lab/exemplar/<档位名>.md —— 用户在那里改，
 *         实验台跑它；这里的常量必须与对应文件 ANCHOR_EXEMPLAR_START 标记之后的正文
 *         **一字不差**，test/exemplars.test.ts 的耦合锁逼着两边同步
 *         （锁红了 = 改了示范忘了重新生成这边）。
 *         模板字符串里的反引号都带了转义 —— 示范正文里有大量代码标识符。
 */

export const STANDARD_EXEMPLAR = `**summary** ：此文件实现固定容量 \`RB_SIZE\` 的环形缓冲区，底层是数组 \`buf\`，读位置是 \`head\`，写位置是 \`tail\`。\`rb_push(rb, v)\` 尝试把整数 \`v\` 写入缓冲区；\`rb_pop(rb, out)\` 尝试从缓冲区取出一个整数，并通过 \`out\` 返回给调用者。写入方和读取方不需要互相等待。空与满用“始终保留一个空位”区分：\`head == tail\` 表示空；\`tail\` 的下一个位置等于 \`head\` 表示满。

**第 1 步：写入——检查满，写入 \`v\`，推进 \`tail\`（第 14-23 行）**

\`rb_push\` 的第二个参数 \`v\` 是本次要写入缓冲区的整数；\`rb\` 指向目标缓冲区。

- 计算下一个写入位置（第 16 行）：\`next = (rb->tail + 1) % RB_SIZE\`。\`next\` 是写入 \`v\` 之后 \`tail\` 应处的位置，也是判断满的依据。
- 满判据 \`next == rb->head\`（第 17-18 行）：
  - True：缓冲区满。\`tail\` 当前格子是最后一个可用空位；若写入 \`v\` 并令 \`tail = next\`，\`tail\` 会与 \`head\` 重合，而 \`head == tail\` 已被定义为空，满和空无法区分。因此返回 \`false\`，不写入 \`v\`。
  - False：\`next\` 与 \`head\` 不重合，至少有一个空位。继续写入。
- 写入与推进顺序（第 20-21 行）：先执行 \`rb->buf[rb->tail] = v\`，把 \`v\` 存入 \`tail\` 当前格子；再执行 \`rb->tail = next\`。若先推进 \`tail\`，调用 \`rb_pop\` 的代码可能在新位置读到尚未写入的数据；先写后移保证 \`tail\` 更新时 \`v\` 已经就绪。最后返回 \`true\`。

**第 2 步：读取——检查空，读出数据，推进 \`head\`（第 25-33 行）**

\`rb_pop\` 的第二个参数 \`out\` 是指向调用者变量的指针，用来接收读出的整数。

- 空判据 \`rb->head == rb->tail\`（第 27-29 行）：
  - True：没有数据可读。\`head\` 与 \`tail\` 相等表示已写入的数据全部取走。返回 \`false\`，不修改 \`*out\`。
  - False：存在可读数据，继续。
- 读出与推进顺序（第 30-31 行）：先执行 \`*out = rb->buf[rb->head]\`，把 \`head\` 当前格子的数据交给调用者；再执行 \`rb->head = (rb->head + 1) % RB_SIZE\`。若先推进 \`head\`，该格子会被视为可写，调用 \`rb_push\` 的代码可能覆盖尚未交给 \`*out\` 的数据；先读后移保证数据已经交给调用者。最后返回 \`true\`。`;

export const CONCISE_EXEMPLAR = `**summary** ：这是一个固定大小的环形缓冲区，用来在写入方和读取方之间传递整数，双方不需要互相等待。它始终空着一个格子，用来区分“空”和“满”。

**第 1 步：写入（第 14-23 行）**

目标是把一个整数放进去。如果已经满了，就拒绝，返回失败，避免覆盖还没取走的数据；如果没满，就放进去并返回成功。

**第 2 步：读取（第 25-33 行）**

目标是从中取出一个整数。如果是空的，就拒绝，返回失败，因为没有数据可以取；如果不空，就取出一个整数并返回成功。`;

export const DETAILED_EXEMPLAR = `**summary** ：这个文件实现一个固定大小的环形缓冲区。它用一个数组循环存放整数，\`head\` 记录读位置，\`tail\` 记录写位置。\`rb_push\` 尝试写入一个整数；\`rb_pop\` 尝试读出一个整数。写入方和读取方不需要互相等待。空和满的判据、以及为什么这样判，在第 2 步和第 3 步逐行解释。

**第 1 步：先看数据结构和两个位置（第 1-12 行）**

- 第 1-3 行：注释。说明这是一个环形缓冲区，只有一个写入方和一个读取方，不需要加锁。注释里提到空和满的判据是“留一个空位”：\`head == tail\` 是空，\`(tail + 1) % N == head\` 是满。这里只是注释，不是可执行代码；\`N\` 对应下面的 \`RB_SIZE\`。具体为什么，在第 2 步第 17 行展开。
- 第 4 行：\`#include <stdbool.h>\`。引入 \`bool\`、\`true\`、\`false\`。没有它，函数不能直接返回 \`true\` 或 \`false\`。
- 第 6 行：\`#define RB_SIZE 16\`。宏定义。编译前，代码里所有 \`RB_SIZE\` 都会替换成 \`16\`。所以数组 \`buf\` 有 16 个 \`int\` 格子，下标是 0 到 15。
- 第 8 行：\`typedef struct {\`。开始定义一个结构体，并准备用 \`typedef\` 给它起一个类型名。
- 第 9 行：\`int buf[RB_SIZE];\`。定义一个整数数组 \`buf\`，长度是 \`RB_SIZE\`，也就是 16。它用于存放缓冲区里的整数。下标从 0 到 15。
- 第 10 行：\`int head;\`。定义一个整数 \`head\`，用于存放读位置。\`rb_pop\` 会从 \`head\` 指向的格子取数据。
- 第 11 行：\`int tail;\`。定义一个整数 \`tail\`，用于存放写位置。\`rb_push\` 会把数据写进 \`tail\` 指向的格子。
- 第 12 行：\`} ring_buffer_t;\`。结束结构体定义，并把这种结构体命名为 \`ring_buffer_t\`。以后写 \`ring_buffer_t rb;\` 就能定义一个这样的缓冲区。

**第 2 步：写入——满了不写，没满就写入并移动写位置（第 14-23 行）**

- 第 14 行：\`bool rb_push(ring_buffer_t *rb, int v)\`。定义函数 \`rb_push\`。返回类型是 \`bool\`，表示成功或失败。参数 \`rb\` 是一个指针，指向要操作的缓冲区；参数 \`v\` 是本次要写入的整数。
- 第 15 行：\`{\`。函数体开始。
- 第 16 行：\`int next = (rb->tail + 1) % RB_SIZE;\`。定义一个整数 \`next\`，用于存放“如果写入当前 \`tail\` 格，写位置下一步应该到哪里”。\`rb->tail\` 表示“\`rb\` 指向的结构体里的 \`tail\` 成员”，等价于 \`(*rb).tail\`。\`+ 1\` 是往后走一格。\`% RB_SIZE\` 是取余数：如果 \`tail\` 是 15，\`(15 + 1) % 16\` 得到 0，于是下标从末尾绕回开头。\`next\` 是写入之后 \`tail\` 要去的新位置，也是判断满的依据。
- 第 17 行：\`if (next == rb->head) {\`。判断缓冲区是否已经满了。这里不能只看 \`tail == head\`，因为 \`tail == head\` 已经被定义为“空”。满要用“写位置的下一个位置撞上读位置”表示，也就是 \`next == head\`。具体推演：假设 \`RB_SIZE\` 是 16，\`head\` 是 0，\`tail\` 是 15。此时已经写入但还没读走的数据在 \`buf[0]\` 到 \`buf[14]\`，一共 15 个。\`tail\` 指向 \`buf[15]\`，这是最后一个空位。如果这时再把一个整数写进 \`buf[15]\`，然后执行 \`tail = (15 + 1) % 16\`，\`tail\` 就会变成 0。于是 \`head\` 是 0，\`tail\` 也是 0。可是 \`head == tail\` 已经被用来表示“空”。刚写满却变得像“空”，读取方就无法区分到底是满还是空。所以最后一个空位不能写。当 \`next == head\` 时，就是这种情况：再写一个，\`tail\` 就会和 \`head\` 重合。因此这个条件表示满，直接返回 \`false\`。如果 \`next != head\`，说明至少还有一个空位可以写。
- 第 18 行：\`return false;\`。如果满了，就返回 \`false\`，表示这次写入失败。调用者看到 \`false\` 就知道数据没有放进去。
- 第 19 行：\`}\`。结束 \`if\`。
- 第 20 行：\`rb->buf[rb->tail] = v;\`。把整数 \`v\` 写进 \`tail\` 当前指向的格子。注意这里用的是 \`tail\`，不是 \`next\`。\`tail\` 是当前可写的位置；\`next\` 是写完之后要移动到的位置。
- 第 21 行：\`rb->tail = next;\`。写入完成后，把 \`tail\` 更新成 \`next\`。这样下一个数据会写到新的位置。顺序必须是先写数据，再移动 \`tail\`；如果先移动 \`tail\`，读的一方可能以为有新数据，但数据其实还没写好。
- 第 22 行：\`return true;\`。返回 \`true\`，表示写入成功。
- 第 23 行：\`}\`。函数结束。

**第 3 步：读取——空了不读，有数据就读出并移动读位置（第 25-33 行）**

- 第 25 行：\`bool rb_pop(ring_buffer_t *rb, int *out)\`。定义函数 \`rb_pop\`。返回类型是 \`bool\`，表示成功或失败。参数 \`rb\` 指向缓冲区。参数 \`out\` 是一个指针，指向调用者提供的整数变量；函数成功时会把读出的整数写进 \`*out\`。
- 第 26 行：\`{\`。函数体开始。
- 第 27 行：\`if (rb->head == rb->tail) {\`。判断缓冲区是否为空。\`head\` 是读位置，\`tail\` 是写位置。两者相等，说明已经写入的数据全部被取走了，没有数据可读。具体推演：初始时 \`head == tail\`，表示空；每写入一个数据，\`tail\` 往后移一格；每读出一个数据，\`head\` 往后移一格；当 \`head\` 追上 \`tail\`，就读完了。
- 第 28 行：\`return false;\`。如果为空，就返回 \`false\`，表示读取失败。这里不修改 \`*out\`，调用者不能把 \`*out\` 当成有效数据。
- 第 29 行：\`}\`。结束 \`if\`。
- 第 30 行：\`*out = rb->buf[rb->head];\`。把 \`head\` 当前格子的整数赋给 \`*out\`。\`*out\` 表示“\`out\` 指针指向的那个变量”。这样调用者就能拿到读出的数据。
- 第 31 行：\`rb->head = (rb->head + 1) % RB_SIZE;\`。读出之后，把 \`head\` 往后移一格。\`% RB_SIZE\` 同样是为了让下标到末尾后回到 0。顺序必须是先读出数据，再移动 \`head\`；如果先移动 \`head\`，写的一方可能覆盖还没交出去的数据。
- 第 32 行：\`return true;\`。返回 \`true\`，表示读取成功。
- 第 33 行：\`}\`。函数结束。

**补充：几个容易卡住的点**

- 空：\`head == tail\`。满：\`next == head\`，也就是 \`(tail + 1) % RB_SIZE == head\`。
- 留一个空位：数组有 16 个格子，但最多存 15 个整数。这样满和空不会都表现为 \`head == tail\`。
- \`% RB_SIZE\` 的作用：让下标在 0 到 15 之间循环。\`tail + 1\` 到 16 时，取余变成 0；\`head + 1\` 到 16 时也一样。数组就像首尾相接。
- \`rb->tail\` 和 \`*out\` 的语法：\`rb\` 是结构体指针，\`rb->tail\` 是取它指向的结构体里的 \`tail\` 成员；\`out\` 是整数指针，\`*out\` 是取出 \`out\` 指向的那个整数变量。
- 为什么写入方和读取方不需要互相等待：写入方只改 \`tail\`，读取方只改 \`head\`。双方通过 \`head\` 和 \`tail\` 判断能不能写、能不能读。这个示例约定只有一个写入方和一个读取方，所以不需要加锁。`;

/**
 * 英文面（D97）：`anchorExplain.language = "en"` 时进 prompt 的示范。
 * 编辑面是 `scripts/style-lab/exemplar/<档位名>.en.md`，同步锁与中文版共用同一个测试文件。
 * 内容是用户三份中文示范的**忠实翻译** —— 结构、判据、推演顺序一一对应，只换语言。
 */

export const STANDARD_EXEMPLAR_EN = `**summary**: This file implements a ring buffer of fixed capacity \`RB_SIZE\`, backed by the array \`buf\`, with the read position in \`head\` and the write position in \`tail\`. \`rb_push(rb, v)\` tries to write the integer \`v\` into the buffer; \`rb_pop(rb, out)\` tries to take an integer out of the buffer and hand it to the caller through \`out\`. The writer and the reader do not need to wait for each other. Empty and full are told apart by "always keep one slot empty": \`head == tail\` means empty; the slot after \`tail\` coinciding with \`head\` means full.

**Step 1: Write — check full, write \`v\`, advance \`tail\` (lines 14-23)**

The second parameter \`v\` of \`rb_push\` is the integer to write into the buffer this time; \`rb\` points at the target buffer.

- Compute the next write position (line 16): \`next = (rb->tail + 1) % RB_SIZE\`. \`next\` is where \`tail\` will be once \`v\` is written, and it is also the basis for the full check.
- The full condition \`next == rb->head\` (lines 17-18):
  - True: the buffer is full. The slot at \`tail\` is the last free slot; if \`v\` were written and \`tail\` set to \`next\`, \`tail\` would coincide with \`head\` — and since \`head == tail\` is defined as empty, full and empty would be indistinguishable. So it returns \`false\`, and \`v\` is not written.
  - False: \`next\` does not coincide with \`head\` — at least one slot is free. Continue with the write.
- Order of writing and advancing (lines 20-21): first \`rb->buf[rb->tail] = v\`, storing \`v\` into the slot currently at \`tail\`; then \`rb->tail = next\`. If \`tail\` were advanced first, the code calling \`rb_pop\` could read data at the new position that has not been written yet; write-then-advance guarantees \`v\` is already in place by the time \`tail\` moves. Finally it returns \`true\`.

**Step 2: Read — check empty, take the value, advance \`head\` (lines 25-33)**

The second parameter \`out\` of \`rb_pop\` is a pointer to a caller variable that receives the integer read out.

- The empty condition \`rb->head == rb->tail\` (lines 27-29):
  - True: there is nothing to read. \`head\` equal to \`tail\` means everything written has been taken. It returns \`false\` and does not modify \`*out\`.
  - False: there is data to read. Continue.
- Order of reading and advancing (lines 30-31): first \`*out = rb->buf[rb->head]\`, handing the data in the slot at \`head\` to the caller; then \`rb->head = (rb->head + 1) % RB_SIZE\`. If \`head\` were advanced first, that slot would count as writable, and the code calling \`rb_push\` could overwrite data not yet handed to \`*out\`; read-then-advance guarantees the data has been handed over first. Finally it returns \`true\`.`;

export const CONCISE_EXEMPLAR_EN = `**summary**: This is a fixed-size ring buffer that passes integers between a writer and a reader, neither of them waiting for the other. It always keeps one slot empty, which is what tells "empty" and "full" apart.

**Step 1: Write (lines 14-23)**

The goal is to put an integer in. If the buffer is already full, it refuses and returns failure, so data that has not been taken yet is not overwritten; if it is not full, the integer goes in and it returns success.

**Step 2: Read (lines 25-33)**

The goal is to take an integer out. If the buffer is empty, it refuses and returns failure, because there is nothing to take; if it is not empty, it takes one integer out and returns success.`;

export const DETAILED_EXEMPLAR_EN = `**summary**: This file implements a fixed-size ring buffer. It stores integers in an array that wraps around; \`head\` is the read position, \`tail\` is the write position. \`rb_push\` tries to write an integer; \`rb_pop\` tries to read one out. The writer and the reader do not need to wait for each other. The conditions for empty and full, and why they are judged this way, are explained line by line in Step 2 and Step 3.

**Step 1: The data structure and the two positions first (lines 1-12)**

- Lines 1-3: comments. They say this is a ring buffer with one writer and one reader, so no lock is needed. The comments give the conditions for empty and full as "keep one slot empty": \`head == tail\` is empty, \`(tail + 1) % N == head\` is full. This is a comment, not executable code; \`N\` here corresponds to \`RB_SIZE\` below. Why exactly that is gets expanded at line 17, in Step 2.
- Line 4: \`#include <stdbool.h>\`. It brings in \`bool\`, \`true\`, and \`false\`. Without it, the functions cannot return \`true\` or \`false\` directly.
- Line 6: \`#define RB_SIZE 16\`. A macro definition. Before compilation, every \`RB_SIZE\` in the code is replaced with \`16\`. So the array \`buf\` has 16 \`int\` slots, indexed 0 to 15.
- Line 8: \`typedef struct {\`. It starts a struct definition and will use \`typedef\` to give the struct a type name.
- Line 9: \`int buf[RB_SIZE];\`. It defines an integer array \`buf\` of length \`RB_SIZE\`, that is, 16. It holds the integers of the buffer. Indices run from 0 to 15.
- Line 10: \`int head;\`. It defines an integer \`head\`, which holds the read position. \`rb_pop\` takes data from the slot \`head\` points at.
- Line 11: \`int tail;\`. It defines an integer \`tail\`, which holds the write position. \`rb_push\` writes data into the slot \`tail\` points at.
- Line 12: \`} ring_buffer_t;\`. It ends the struct definition and names this struct \`ring_buffer_t\`. From then on, writing \`ring_buffer_t rb;\` declares such a buffer.

**Step 2: Write — refuse when full; otherwise write and move the write position (lines 14-23)**

- Line 14: \`bool rb_push(ring_buffer_t *rb, int v)\`. It defines the function \`rb_push\`. The return type is \`bool\`, standing for success or failure. The parameter \`rb\` is a pointer to the buffer to operate on; the parameter \`v\` is the integer to write this time.
- Line 15: \`{\`. The function body starts.
- Line 16: \`int next = (rb->tail + 1) % RB_SIZE;\`. It defines an integer \`next\`, which holds "where the write position should go next if the slot at the current \`tail\` gets written". \`rb->tail\` means "the \`tail\` member of the struct that \`rb\` points at", equivalent to \`(*rb).tail\`. \`+ 1\` moves one slot forward. \`% RB_SIZE\` takes the remainder: if \`tail\` is 15, \`(15 + 1) % 16\` gives 0, so the index wraps from the end back to the start. \`next\` is the new position \`tail\` will move to after the write, and it is also the basis for the full check.
- Line 17: \`if (next == rb->head) {\`. It checks whether the buffer is already full. This cannot be decided by \`tail == head\` alone, because \`tail == head\` is already defined as "empty". Full is expressed as "the slot after the write position runs into the read position", that is, \`next == head\`. The walkthrough: suppose \`RB_SIZE\` is 16, \`head\` is 0, and \`tail\` is 15. The data written but not yet read sits in \`buf[0]\` through \`buf[14]\` — 15 values in total. \`tail\` points at \`buf[15]\`, the last free slot. If one more integer were written into \`buf[15]\` and then \`tail = (15 + 1) % 16\` ran, \`tail\` would become 0. Then \`head\` is 0 and \`tail\` is 0. But \`head == tail\` is already used to mean "empty". A buffer that has just become full would look "empty", and the reader could not tell full from empty. So the last free slot must not be written. When \`next == head\`, that is exactly the case: one more write and \`tail\` coincides with \`head\`. Therefore this condition means full, and it returns \`false\` right away. If \`next != head\`, at least one slot is still free to write.
- Line 18: \`return false;\`. If the buffer is full, it returns \`false\`: this write failed. Seeing \`false\`, the caller knows the value was not stored.
- Line 19: \`}\`. It ends the \`if\`.
- Line 20: \`rb->buf[rb->tail] = v;\`. It writes the integer \`v\` into the slot currently pointed at by \`tail\`. Note that this uses \`tail\`, not \`next\`. \`tail\` is the currently writable slot; \`next\` is where \`tail\` moves after the write.
- Line 21: \`rb->tail = next;\`. Once the write is done, \`tail\` is updated to \`next\`, so the next value goes into the new slot. The order must be: write the data first, then move \`tail\`; if \`tail\` moved first, the reader might think there is new data while it has not actually been written yet.
- Line 22: \`return true;\`. It returns \`true\`: the write succeeded.
- Line 23: \`}\`. The function ends.

**Step 3: Read — refuse when empty; otherwise read and move the read position (lines 25-33)**

- Line 25: \`bool rb_pop(ring_buffer_t *rb, int *out)\`. It defines the function \`rb_pop\`. The return type is \`bool\`, standing for success or failure. The parameter \`rb\` points at the buffer. The parameter \`out\` is a pointer to an integer variable provided by the caller; on success the function writes the value read out into \`*out\`.
- Line 26: \`{\`. The function body starts.
- Line 27: \`if (rb->head == rb->tail) {\`. It checks whether the buffer is empty. \`head\` is the read position and \`tail\` is the write position; when the two are equal, everything written has been taken — there is nothing to read. The walkthrough: initially \`head == tail\`, which means empty; each write moves \`tail\` one slot forward; each read moves \`head\` one slot forward; when \`head\` catches up with \`tail\`, everything has been read.
- Line 28: \`return false;\`. If the buffer is empty, it returns \`false\`: this read failed. It does not modify \`*out\`, and the caller must not treat \`*out\` as valid data.
- Line 29: \`}\`. It ends the \`if\`.
- Line 30: \`*out = rb->buf[rb->head];\`. It assigns the integer at the slot \`head\` points at to \`*out\`. \`*out\` means "the variable that the pointer \`out\` points at". This is how the caller receives the value that was read.
- Line 31: \`rb->head = (rb->head + 1) % RB_SIZE;\`. After reading, \`head\` moves one slot forward. \`% RB_SIZE\` again keeps the index wrapping back to 0 after the end. The order must be: read the data first, then move \`head\`; if \`head\` moved first, the writer could overwrite data that has not been handed over yet.
- Line 32: \`return true;\`. It returns \`true\`: the read succeeded.
- Line 33: \`}\`. The function ends.

**Addendum: the points that usually trip people up**

- Empty: \`head == tail\`. Full: \`next == head\`, that is, \`(tail + 1) % RB_SIZE == head\`.
- One slot left empty: the array has 16 slots but holds at most 15 integers, so full and empty never both look like \`head == tail\`.
- What \`% RB_SIZE\` does: it keeps the index cycling between 0 and 15. When \`tail + 1\` reaches 16, the remainder makes it 0; the same for \`head + 1\`. The array behaves as if its two ends were joined.
- The syntax of \`rb->tail\` and \`*out\`: \`rb\` is a pointer to a struct, and \`rb->tail\` takes the \`tail\` member of the struct it points at; \`out\` is a pointer to an integer, and \`*out\` is the integer variable \`out\` points at.
- Why the writer and the reader do not need to wait for each other: the writer only changes \`tail\`, and the reader only changes \`head\`. Each side decides whether it can write or read from \`head\` and \`tail\`. The comments assume exactly one writer and one reader, so no lock is needed.`;
