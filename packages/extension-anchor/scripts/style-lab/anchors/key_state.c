/* 按键扫描：每 10ms 调一次，消抖 + 长按检测 */
#include <stdint.h>
#include <stdbool.h>

#define DEBOUNCE_TICKS 3
#define LONG_PRESS_TICKS 100

typedef enum { KEY_IDLE, KEY_DOWN, KEY_HELD } key_state_t;

typedef struct {
    key_state_t state;
    uint16_t counter;
    bool last_raw;
} key_scanner_t;

/* 返回：0=无事件 1=短按 2=长按触发 */
int key_scan(key_scanner_t *k, bool raw_now)
{
    int event = 0;

    if (raw_now && !k->last_raw) {
        k->counter = 0;
        k->state = KEY_DOWN;
    }

    if (k->state == KEY_DOWN) {
        if (raw_now) {
            k->counter++;
            if (k->counter >= LONG_PRESS_TICKS) {
                k->state = KEY_HELD;
                event = 2;
            }
        } else if (k->counter >= DEBOUNCE_TICKS) {
            event = 1;          /* 抬起时按住了足够久：一次有效短按 */
            k->state = KEY_IDLE;
        } else {
            k->state = KEY_IDLE; /* 抖动：太短，当作没按 */
        }
    }

    k->last_raw = raw_now;
    return event;
}
