/*
 * main.c — Anchor Explain 线1 的验收样本（给讲解链路看的，不是给编译器看的）。
 *
 * 第 40-48 行是 S1/S2 的默认选区，正好框住一个完整的出队函数。
 * 改动上方任意一行都会让行号错位，进而让这两个文件里的断言失效：
 *   packages/core/src/fakes/fakeEditorPort.ts
 *   packages/core/src/fakes/fakeProvider.ts
 */

#include <stdio.h>

#define RB_CAPACITY 16

typedef struct {
    int data[RB_CAPACITY];
    size_t head;
    size_t tail;
    size_t count;
} ring_buffer_t;

static void rb_init(ring_buffer_t *rb)
{
    rb->head = 0;
    rb->tail = 0;
    rb->count = 0;
}

static int rb_push(ring_buffer_t *rb, int value)
{
    if (rb->count == RB_CAPACITY) {
        return -1;
    }

    rb->data[rb->tail] = value;
    rb->tail = (rb->tail + 1) % RB_CAPACITY;
    rb->count++;
    return 0;
}

static int rb_pop(ring_buffer_t *rb, int *out)
{
    if (rb->count == 0) return -1;

    *out = rb->data[rb->head];
    rb->head = (rb->head + 1) % RB_CAPACITY;
    rb->count--;
    return 0;
}

static void rb_dump(const ring_buffer_t *rb)
{
    printf("count=%zu head=%zu tail=%zu\n", rb->count, rb->head, rb->tail);
}

int main(void)
{
    ring_buffer_t rb;
    int value = 0;

    rb_init(&rb);

    for (int i = 0; i < 20; i++) {
        if (rb_push(&rb, i) != 0) {
            printf("push %d rejected: queue full\n", i);
            break;
        }
    }

    while (rb_pop(&rb, &value) == 0) {
        printf("pop %d\n", value);
    }

    rb_dump(&rb);
    return 0;
}
