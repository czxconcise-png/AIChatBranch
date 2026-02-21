# Chrome Web Store 上架检查清单（国内开发者）

适用项目：`AI Chat Branch`  
目标：按步骤逐项勾选，完成上架前准备。

---

## 0. 账号与发布资格

- [x] 注册 Chrome Web Store 开发者账号并支付一次性注册费（USD $5）
  - 链接：https://developer.chrome.com/docs/webstore/register
- [x] 开启 Google 账号两步验证（2-Step Verification）
  - 链接：https://developer.chrome.com/docs/webstore/program-policies/two-step-verification
- [x] （如面向欧盟用户）完成 Trader / Non-Trader 声明
  - 链接：https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure

---

## 1. 插件包与 Manifest 检查

- [x] 使用 Manifest V3（`manifest_version: 3`）
  - 你的项目当前：已是 MV3
  - 参考：https://developer.chrome.com/docs/extensions/mv3/intro/
- [x] 核对基础字段：`name` / `version` / `description` / `icons`
  - 你的项目当前：已具备
  - 参考：https://developer.chrome.com/docs/extensions/reference/manifest
- [x] 确认权限最小化（只保留必要权限）
  - 你的项目当前：`tabs`, `sidePanel`, `storage`, `activeTab`, `scripting`, `optional_host_permissions:https://*/*`
  - 审查结论：已移除 `content_scripts:<all_urls>`，改为“点击 Track 时按站点授权”模式；上架文案与隐私页需明确用途
  - 参考（权限）：https://developer.chrome.com/docs/extensions/reference/permissions-list

---

## 2. 隐私与数据披露（重点）

- [ ] 在商店 Privacy 标签页准确填写“收集了什么数据、用途、是否共享”
  - 链接（发布流程）：https://developer.chrome.com/docs/webstore/publish
- [ ] 准备并填写可公开访问的隐私政策 URL（建议必须提供）
  - 链接（隐私政策要求）：https://developer.chrome.com/docs/webstore/program-policies/privacy
- [ ] 明确披露自动命名的数据流：对话内容会发送到用户配置的 API / 内置 API 用于生成标题
  - 链接（Limited Use）：https://developer.chrome.com/docs/webstore/program-policies/limited-use
- [ ] 确保隐私说明与真实行为一致（不能“写不收集”但代码实际有传输）
  - 链接（政策总览）：https://developer.chrome.com/docs/webstore/program-policies/policies

---

## 3. 商店展示素材与文案

- [ ] Extension 图标（至少 128x128）准备完成
  - 链接（素材规格）：https://developer.chrome.com/docs/webstore/images
- [ ] 至少 1 张商店截图（建议 3-5 张，展示核心流程）
  - 链接（素材规格）：https://developer.chrome.com/docs/webstore/images
- [ ] 小宣传图（440x280，建议提供，利于展示）
  - 链接（素材规格）：https://developer.chrome.com/docs/webstore/images
- [ ] 商店文案完成：一句话价值、核心功能、适用场景、隐私说明
  - 链接（发布页字段）：https://developer.chrome.com/docs/webstore/publish

---

## 4. 上架前自测

- [ ] 在干净 Chrome 用户配置下安装测试包（避免本地缓存干扰）
- [ ] 核验核心流程：
  - [ ] Track Tab 正常
  - [ ] Duplicate Tab 自动挂子节点
  - [ ] 手动粘贴同会话 URL 能挂到树中（稳定性略低于 Duplicate）
  - [ ] 自动命名按最新回复触发
  - [ ] 节点点击切换与定位可用
  - [ ] 快照回看可用
- [ ] 检查报错：`chrome://extensions` -> 打开开发者模式 -> 查看 Service Worker / Side Panel 错误日志
  - 链接（调试文档）：https://developer.chrome.com/docs/extensions/get-started/tutorial/debug

---

## 5. 提交与发布

- [ ] 打包 zip（包含插件根目录文件，勿多包一层无关目录）
- [ ] 在 Developer Dashboard 创建新项目并上传 zip
- [ ] 逐项填写 Store listing / Privacy / Distribution
- [ ] 提交审核并记录版本号、提交日期、审核结果
  - 链接（发布流程）：https://developer.chrome.com/docs/webstore/publish

---

## AI Chat Branch 额外提醒（你这个项目）

- [ ] 在 listing 里明确一句话说明：本扩展可管理 AI 对话分支，也可用于通用网页标签页分叉管理。
- [ ] 在隐私政策里写清楚：
  - 自动命名会读取当前对话内容片段并发送到 AI 接口做标题生成；
  - 用户可切换 API 方式，需自行承担对应服务条款与数据合规责任。
- [ ] 若后续你把权限从 `<all_urls>` 缩小，记得同步更新商店说明与隐私政策。
