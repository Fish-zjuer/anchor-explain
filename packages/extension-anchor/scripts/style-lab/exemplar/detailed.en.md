<!--
The "detailed exemplar", English side (D97) — faithful translation of detailed.md (user's D93 final).

  * Everything after the `ANCHOR_EXEMPLAR_START` marker goes verbatim into the system prompt's
    example section when `anchorExplain.language` is "en".
  * The sync test (test/exemplars.test.ts) pins the constant DETAILED_EXEMPLAR_EN to the content
    after the marker — edit here, then regenerate the constant.
-->

## The code at the anchor

Source: `scripts/style-lab/anchors/ring_buffer.c` (the whole file, 33 lines; the line numbers in the exemplar are its editor line numbers).

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

## Explanation exemplar (the editing area)

<!-- ANCHOR_EXEMPLAR_START -->

**summary**: This file implements a fixed-size ring buffer. It stores integers in an array that wraps around; `head` is the read position, `tail` is the write position. `rb_push` tries to write an integer; `rb_pop` tries to read one out. The writer and the reader do not need to wait for each other. The conditions for empty and full, and why they are judged this way, are explained line by line in Step 2 and Step 3.

**Step 1: The data structure and the two positions first (lines 1-12)**

- Lines 1-3: comments. They say this is a ring buffer with one writer and one reader, so no lock is needed. The comments give the conditions for empty and full as "keep one slot empty": `head == tail` is empty, `(tail + 1) % N == head` is full. This is a comment, not executable code; `N` here corresponds to `RB_SIZE` below. Why exactly that is gets expanded at line 17, in Step 2.
- Line 4: `#include <stdbool.h>`. It brings in `bool`, `true`, and `false`. Without it, the functions cannot return `true` or `false` directly.
- Line 6: `#define RB_SIZE 16`. A macro definition. Before compilation, every `RB_SIZE` in the code is replaced with `16`. So the array `buf` has 16 `int` slots, indexed 0 to 15.
- Line 8: `typedef struct {`. It starts a struct definition and will use `typedef` to give the struct a type name.
- Line 9: `int buf[RB_SIZE];`. It defines an integer array `buf` of length `RB_SIZE`, that is, 16. It holds the integers of the buffer. Indices run from 0 to 15.
- Line 10: `int head;`. It defines an integer `head`, which holds the read position. `rb_pop` takes data from the slot `head` points at.
- Line 11: `int tail;`. It defines an integer `tail`, which holds the write position. `rb_push` writes data into the slot `tail` points at.
- Line 12: `} ring_buffer_t;`. It ends the struct definition and names this struct `ring_buffer_t`. From then on, writing `ring_buffer_t rb;` declares such a buffer.

**Step 2: Write — refuse when full; otherwise write and move the write position (lines 14-23)**

- Line 14: `bool rb_push(ring_buffer_t *rb, int v)`. It defines the function `rb_push`. The return type is `bool`, standing for success or failure. The parameter `rb` is a pointer to the buffer to operate on; the parameter `v` is the integer to write this time.
- Line 15: `{`. The function body starts.
- Line 16: `int next = (rb->tail + 1) % RB_SIZE;`. It defines an integer `next`, which holds "where the write position should go next if the slot at the current `tail` gets written". `rb->tail` means "the `tail` member of the struct that `rb` points at", equivalent to `(*rb).tail`. `+ 1` moves one slot forward. `% RB_SIZE` takes the remainder: if `tail` is 15, `(15 + 1) % 16` gives 0, so the index wraps from the end back to the start. `next` is the new position `tail` will move to after the write, and it is also the basis for the full check.
- Line 17: `if (next == rb->head) {`. It checks whether the buffer is already full. This cannot be decided by `tail == head` alone, because `tail == head` is already defined as "empty". Full is expressed as "the slot after the write position runs into the read position", that is, `next == head`. The walkthrough: suppose `RB_SIZE` is 16, `head` is 0, and `tail` is 15. The data written but not yet read sits in `buf[0]` through `buf[14]` — 15 values in total. `tail` points at `buf[15]`, the last free slot. If one more integer were written into `buf[15]` and then `tail = (15 + 1) % 16` ran, `tail` would become 0. Then `head` is 0 and `tail` is 0. But `head == tail` is already used to mean "empty". A buffer that has just become full would look "empty", and the reader could not tell full from empty. So the last free slot must not be written. When `next == head`, that is exactly the case: one more write and `tail` coincides with `head`. Therefore this condition means full, and it returns `false` right away. If `next != head`, at least one slot is still free to write.
- Line 18: `return false;`. If the buffer is full, it returns `false`: this write failed. Seeing `false`, the caller knows the value was not stored.
- Line 19: `}`. It ends the `if`.
- Line 20: `rb->buf[rb->tail] = v;`. It writes the integer `v` into the slot currently pointed at by `tail`. Note that this uses `tail`, not `next`. `tail` is the currently writable slot; `next` is where `tail` moves after the write.
- Line 21: `rb->tail = next;`. Once the write is done, `tail` is updated to `next`, so the next value goes into the new slot. The order must be: write the data first, then move `tail`; if `tail` moved first, the reader might think there is new data while it has not actually been written yet.
- Line 22: `return true;`. It returns `true`: the write succeeded.
- Line 23: `}`. The function ends.

**Step 3: Read — refuse when empty; otherwise read and move the read position (lines 25-33)**

- Line 25: `bool rb_pop(ring_buffer_t *rb, int *out)`. It defines the function `rb_pop`. The return type is `bool`, standing for success or failure. The parameter `rb` points at the buffer. The parameter `out` is a pointer to an integer variable provided by the caller; on success the function writes the value read out into `*out`.
- Line 26: `{`. The function body starts.
- Line 27: `if (rb->head == rb->tail) {`. It checks whether the buffer is empty. `head` is the read position and `tail` is the write position; when the two are equal, everything written has been taken — there is nothing to read. The walkthrough: initially `head == tail`, which means empty; each write moves `tail` one slot forward; each read moves `head` one slot forward; when `head` catches up with `tail`, everything has been read.
- Line 28: `return false;`. If the buffer is empty, it returns `false`: this read failed. It does not modify `*out`, and the caller must not treat `*out` as valid data.
- Line 29: `}`. It ends the `if`.
- Line 30: `*out = rb->buf[rb->head];`. It assigns the integer at the slot `head` points at to `*out`. `*out` means "the variable that the pointer `out` points at". This is how the caller receives the value that was read.
- Line 31: `rb->head = (rb->head + 1) % RB_SIZE;`. After reading, `head` moves one slot forward. `% RB_SIZE` again keeps the index wrapping back to 0 after the end. The order must be: read the data first, then move `head`; if `head` moved first, the writer could overwrite data that has not been handed over yet.
- Line 32: `return true;`. It returns `true`: the read succeeded.
- Line 33: `}`. The function ends.

**Addendum: the points that usually trip people up**

- Empty: `head == tail`. Full: `next == head`, that is, `(tail + 1) % RB_SIZE == head`.
- One slot left empty: the array has 16 slots but holds at most 15 integers, so full and empty never both look like `head == tail`.
- What `% RB_SIZE` does: it keeps the index cycling between 0 and 15. When `tail + 1` reaches 16, the remainder makes it 0; the same for `head + 1`. The array behaves as if its two ends were joined.
- The syntax of `rb->tail` and `*out`: `rb` is a pointer to a struct, and `rb->tail` takes the `tail` member of the struct it points at; `out` is a pointer to an integer, and `*out` is the integer variable `out` points at.
- Why the writer and the reader do not need to wait for each other: the writer only changes `tail`, and the reader only changes `head`. Each side decides whether it can write or read from `head` and `tail`. The comments assume exactly one writer and one reader, so no lock is needed.
