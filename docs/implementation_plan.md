# AI Auto-Naming: Built-in + Custom API

## Architecture

```
默认模式（零配置）:
  扩展 ──→ Cloudflare Worker (你的代理) ──→ SiliconFlow API
                  ↑ API Key 藏在这里

自定义模式（高级用户）:
  扩展 ──→ 用户自己的 API URL (带用户自己的 Key)
```

## Proposed Changes

### 1. Cloudflare Worker (代理服务器)

#### [NEW] Cloudflare Worker

- 接收扩展的请求 `POST /v1/chat/completions`
- 转发到 SiliconFlow `https://api.siliconflow.cn/v1/chat/completions`
- 用环境变量 `SILICONFLOW_API_KEY` 注入 Authorization header
- 添加基本防护：验证 Origin / Referer，限制 `max_tokens ≤ 50`，防止滥用
- **免费额度**：Cloudflare Workers 每天 10 万次请求，足够个人/小规模使用

Worker 代码约 50 行，部署在 `https://aichattree-api.你的用户名.workers.dev`

---

### 2. Background Script

#### [MODIFY] [background.js](file:///d:/Antigraivity/AI%20Tab/background.js)

**A. 添加模型池和常量**

```javascript
const BUILTIN_API_URL = 'https://aichattree-api.xxx.workers.dev/v1';
const SILICONFLOW_MODELS = [
    'Qwen/Qwen2.5-7B-Instruct',
    'THUDM/glm-4-9b-chat',
    'internlm/internlm2_5-7b-chat',
    'Qwen/Qwen2-7B-Instruct',
    'Qwen/Qwen2-1.5B-Instruct',
];
const modelCooldowns = new Map(); // model → cooldown_until timestamp
```

**B. 新增 `generateTitleWithFallback(text, apiKey, baseUrl)`**

- 内置模式：不需要 apiKey（Worker 代理注入），遍历模型池
- 自定义模式：用用户的 apiKey + baseUrl + model，单模型调用
- 429 时标记冷却 60s，跳到下一个模型
- 全部失败 → `extractLabelFromNewText()` 兜底

**C. 修改 `handleSnapshotData`**

- 读取 `aiNamingType`：`'builtin'`（默认）/ `'custom'` / `'local'`
- `builtin` → `generateTitleWithFallback(text, null, BUILTIN_API_URL)`
- `'custom'` → `generateTitleFromOpenAICompatible(text, userKey, userModel, userUrl)`
- `'local'` → `extractLabelFromNewText()`

---

### 3. Settings UI

#### [MODIFY] [sidepanel.html](file:///d:/Antigraivity/AI%20Tab/sidepanel/sidepanel.html)

命名方式下拉菜单改为三个选项：

```html
<select id="setting-naming-type">
  <option value="builtin">AI 自动命名（内置，推荐）</option>
  <option value="custom">自定义 API</option>
  <option value="local">本地算法</option>
</select>
```

- 选 `builtin`：不显示任何配置字段
- 选 `custom`：显示 Base URL / API Key / Model 输入框（保留现有 UI）
- 选 `local`：不显示任何配置字段

#### [MODIFY] [sidepanel.js](file:///d:/Antigraivity/AI%20Tab/sidepanel/sidepanel.js)

- 更新 `updateSettingsUI`：根据三种模式显示/隐藏字段
- 更新 `openSettings` / `saveNamingSettings`：默认值改为 `'builtin'`
- 测试连接：builtin 模式下测试 Worker 代理，custom 模式测试用户 URL

---

## Implementation Order

1. **先完成扩展端代码**（background.js + sidepanel）— 用 `BUILTIN_API_URL` 占位
2. **部署 Cloudflare Worker** — 我来写 Worker 代码，指导你部署
3. **替换占位 URL** — 填入真实 Worker 地址
4. **测试 + 提交**

## Verification Plan

### Manual Verification
1. 设置为 `builtin` 模式，追踪一个 AI 对话标签，验证自动命名生效
2. 快速多次触发命名，验证 429 模型轮换
3. 设置为 `custom` 模式，输入自己的 API Key，验证自定义 API 可用
4. 设置为 `local` 模式，验证本地算法兜底
5. Worker 防护：用 curl 直接请求 Worker，验证非扩展来源被拒绝
