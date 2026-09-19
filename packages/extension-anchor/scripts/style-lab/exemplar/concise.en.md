<!--
The "concise exemplar", English side (D97) — faithful translation of concise.md (user's D93 final).

  * Everything after the `ANCHOR_EXEMPLAR_START` marker goes verbatim into the system prompt's
    example section when `anchorExplain.language` is "en".
  * The sync test (test/exemplars.test.ts) pins the constant CONCISE_EXEMPLAR_EN to the content
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

**summary**: This is a fixed-size ring buffer that passes integers between a writer and a reader, neither of them waiting for the other. It always keeps one slot empty, which is what tells "empty" and "full" apart.

**Step 1: Write (lines 14-23)**

The goal is to put an integer in. If the buffer is already full, it refuses and returns failure, so data that has not been taken yet is not overwritten; if it is not full, the integer goes in and it returns success.

**Step 2: Read (lines 25-33)**

The goal is to take an integer out. If the buffer is empty, it refuses and returns failure, because there is nothing to take; if it is not empty, it takes one integer out and returns success.
