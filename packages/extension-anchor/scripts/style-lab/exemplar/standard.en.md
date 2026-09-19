<!--
The "standard exemplar", English side (D97) — faithful translation of standard.md (user's D90 final).

  * Everything after the `ANCHOR_EXEMPLAR_START` marker goes verbatim into the system prompt's
    example section when `anchorExplain.language` is "en".
  * Do not touch the code block — the exemplar explains exactly that file
    (scripts/style-lab/anchors/ring_buffer.c; line numbers are editor line numbers).
  * The sync test (test/exemplars.test.ts) pins the constant STANDARD_EXEMPLAR_EN to the content
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

**summary**: This file implements a ring buffer of fixed capacity `RB_SIZE`, backed by the array `buf`, with the read position in `head` and the write position in `tail`. `rb_push(rb, v)` tries to write the integer `v` into the buffer; `rb_pop(rb, out)` tries to take an integer out of the buffer and hand it to the caller through `out`. The writer and the reader do not need to wait for each other. Empty and full are told apart by "always keep one slot empty": `head == tail` means empty; the slot after `tail` coinciding with `head` means full.

**Step 1: Write — check full, write `v`, advance `tail` (lines 14-23)**

The second parameter `v` of `rb_push` is the integer to write into the buffer this time; `rb` points at the target buffer.

- Compute the next write position (line 16): `next = (rb->tail + 1) % RB_SIZE`. `next` is where `tail` will be once `v` is written, and it is also the basis for the full check.
- The full condition `next == rb->head` (lines 17-18):
  - True: the buffer is full. The slot at `tail` is the last free slot; if `v` were written and `tail` set to `next`, `tail` would coincide with `head` — and since `head == tail` is defined as empty, full and empty would be indistinguishable. So it returns `false`, and `v` is not written.
  - False: `next` does not coincide with `head` — at least one slot is free. Continue with the write.
- Order of writing and advancing (lines 20-21): first `rb->buf[rb->tail] = v`, storing `v` into the slot currently at `tail`; then `rb->tail = next`. If `tail` were advanced first, the code calling `rb_pop` could read data at the new position that has not been written yet; write-then-advance guarantees `v` is already in place by the time `tail` moves. Finally it returns `true`.

**Step 2: Read — check empty, take the value, advance `head` (lines 25-33)**

The second parameter `out` of `rb_pop` is a pointer to a caller variable that receives the integer read out.

- The empty condition `rb->head == rb->tail` (lines 27-29):
  - True: there is nothing to read. `head` equal to `tail` means everything written has been taken. It returns `false` and does not modify `*out`.
  - False: there is data to read. Continue.
- Order of reading and advancing (lines 30-31): first `*out = rb->buf[rb->head]`, handing the data in the slot at `head` to the caller; then `rb->head = (rb->head + 1) % RB_SIZE`. If `head` were advanced first, that slot would count as writable, and the code calling `rb_push` could overwrite data not yet handed to `*out`; read-then-advance guarantees the data has been handed over first. Finally it returns `true`.
