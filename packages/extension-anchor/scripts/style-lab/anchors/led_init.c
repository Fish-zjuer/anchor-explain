/* 板级 LED 初始化：GPIO 时钟 + 引脚配置全部走宏，换板子只改宏 */
#include <stdint.h>

#define LED_GPIO_CLK_EN()   (*(volatile uint32_t *)0x40023830u |= (1u << 3))
#define LED_MODE_REG        (*(volatile uint32_t *)0x48000400u)
#define LED_ODR_REG         (*(volatile uint32_t *)0x48000414u)
#define LED_PIN             5u
#define LED_MODE_OUTPUT     (1u << (LED_PIN * 2))

void led_init(void)
{
    LED_GPIO_CLK_EN();          /* 先开时钟：时钟没开的寄存器写了也白写 */

    uint32_t mode = LED_MODE_REG;
    mode &= ~(3u << (LED_PIN * 2));   /* 清掉这个引脚原来的两位模式 */
    mode |= LED_MODE_OUTPUT;          /* 01 = 通用输出 */
    LED_MODE_REG = mode;              /* 读-改-写：别的引脚的模式不能动 */

    LED_ODR_REG &= ~(1u << LED_PIN);  /* 输出低电平：这块板低电平点亮 */
}
