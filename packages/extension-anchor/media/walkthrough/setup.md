### 1. 填一个端点

在设置里搜 `anchorExplain.providers`，填 baseUrl 与模型名 —— 一个 OpenAI 兼容实现同时覆盖
OpenAI / DeepSeek / 通义 / 本地 Ollama，端点与模型名由你选。

```json
{ "default": { "baseUrl": "https://api.deepseek.com/v1", "tier1Model": "deepseek-chat" } }
```

### 2. 存 Key

**不要把 key 写进 `settings.json`** —— 那份文件会被同步、被截图、被提交。
用下面这条命令存进 SecretStorage（不进设置文件，也不进这个仓库）：

[设置 API Key](command:anchorExplain.setApiKey)

### 3. 核对一眼

存完按「显示状态」，它会报出当前用的是哪个端点、哪个模型、最多取件几次。
配错了在这里就该看出来，而不是等讲解失败：

[显示状态](command:anchorExplain.showState)
