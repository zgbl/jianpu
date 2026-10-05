# OpenRouter 视觉识谱测试

项目根目录 `.env`（此文件已由忽略规则排除在 Git 外）配置：

```dotenv
OPENROUTER_API_KEY=你的OpenRouter密钥
# 可选默认模型；也可在页面选择或输入
OPENROUTER_MODEL=provider/model
```

重启本地开发服务后，进入“大模型读谱”页面，切到“上传图片 · 在线识别”，服务商选择 **OpenRouter（多模型）**。模型目录会列出可接收图片的模型；在“模型 ID”输入框按名称搜索，或输入完整 ID，例如 `openai/gpt-4o`。运行时由 OpenRouter 按该模型与提供方路由的价格从 OpenRouter 账户扣费。

每次请求开始后，页面立即显示“已向 OpenRouter 提交请求”，并每隔数秒提示连接状态。模型送来文本后，页面显示收到的原始增量、累计字数和首次输出耗时。若一直没有文本，心跳只表示本机服务仍等待 OpenRouter 响应，不代表模型已有可见内容；超时、余额不足或模型报错时会显示错误，不会把半截 JSON 当成完整乐谱。

OpenRouter 的 HTTP 接口兼容 OpenAI Chat Completions，端点为 `https://openrouter.ai/api/v1/chat/completions`；本功能使用流式响应。可在 [OpenRouter Models](https://openrouter.ai/models) 查看完整模型 ID 与图像输入能力。
