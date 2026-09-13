/*
 * ring_buffer.h —— S9a 的跨文件样本（也是用户在说的那类代码的形状）
 *
 * @anchor 存在的理由：`main.c` 里那个环形队列，**它的容量宏与结构体都不在 main.c 里**
 *         —— 这正是"没有跨文件的理解"的具体形状。有了这个文件，冒烟才能断言
 *         "模型真的能读到锚点文件之外的那个文件，并把行号一起拿到"。
 */

#ifndef RING_BUFFER_H
#define RING_BUFFER_H

#include <stddef.h>
#include <stdint.h>

/* 队列容量。改这个值会同时改变 main.c 里 rb_push 的行为（宏 → 行为，跨文件）。 */
#define RB_CAPACITY 16

/* 环形队列。head 是取出位置，tail 是写入位置，count 是当前元素个数。 */
typedef struct {
  uint8_t data[RB_CAPACITY];
  size_t head;
  size_t tail;
  size_t count;
} ring_buffer_t;

void rb_init(ring_buffer_t *rb);
int rb_push(ring_buffer_t *rb, uint8_t value);
int rb_pop(ring_buffer_t *rb, uint8_t *out);
void rb_dump(const ring_buffer_t *rb);

#endif /* RING_BUFFER_H */
