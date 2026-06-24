# Gemini Auth Search

**[English](README.md) | [中文](README.zh-CN.md)**

> **⚡ 一行安装（Claude Code / agent）：** 复制下面这句，粘贴给你的 agent ——
>
> ```
> 帮我安装这个系统级的 Claude Code skill（通过 Gemini OAuth 做免费 web search，不需要 API key）：https://github.com/Clickist/gemini-auth-search
> ```


通过 **Gemini grounding + Google OAuth** 实现免费网页搜索 —— 不需要付费 API key。

**你需要：** 一个 Google 账号（推荐 Google One AI Pro 订阅，免费版有地区限制）+ 能访问 Google 服务的网络环境 + Node.js 18+。

它借用 Google 的 Cloud Code Assist API。你只需用 Google 账号登录一次，之后就能发送搜索查询，返回带真实来源 URL 的接地（grounded）答案。

## 谁能用

你需要一个被 **Antigravity** OAuth 应用识别的 Google 账号：

- ✅ **Google One AI Pro** 订阅者 —— 实测可用。Antigravity 应用能识别你的订阅（`paidTier: g1-pro-tier`）并授予使用权限。
- ✅ 处于免费版支持地区的账号。
- ⚠️ 处于**不支持地区**的账号拿不到免费版配额，但只要有 Pro 订阅，Antigravity / Pro 这条路仍然能用。

> 另一个 Gemini CLI OAuth 应用在免费版上有地区限制，经常返回"你所在地区不可用"。**Antigravity 应用才是可靠的路径** —— 本项目默认用它。

## 你能得到什么

一个函数 `geminiSearch(query)`，它会：

1. 用你的 Google 账号认证（浏览器 OAuth，一次即可）。
2. 本地缓存 token，过期时自动刷新。
3. 把你的查询发给 Gemini，开启 Google Search grounding。
4. 返回：`{ answer, sources[], citations[], searchQueries[] }`

```javascript
import { geminiSearch } from "./gemini-search.mjs";

const result = await geminiSearch("最新 Rust 版本发布说明");
console.log(result.answer);    // 接地的答案文本
console.log(result.sources);   // [{ title, url }, ...]
```

或者当命令行用：

```bash
node gemini-search.mjs "你的搜索查询"
```

首次运行会打开浏览器进行 Google 登录。后续运行会复用缓存在 `~/.gemini/oauth_creds_antigravity.json` 的 token。

## 边界 —— 它做不到的事

依赖它之前请了解这些限制：

- **模型锁定在 `gemini-2.5-flash`。** `gemini-2.5-pro` 在这个端点存在但返回 503（无容量）。Gemini 3.x 模型返回 404。不要尝试换模型。
- **它是单轮 grounding，不是深度研究。** 每次调用只搜一轮然后回答。没有多轮自动深挖 —— Gemini Deep Research 是另一个消费者产品，不通过这个 API 暴露。要研究深度，得自己在应用层编排多次调用。
- **grounding 无法通过配置强制。** `dynamicRetrievalConfig` / `MODE_DYNAMIC` 在这个内部端点会被拒绝。参考实现用 system prompt 来引导 Gemini 去搜索。
- **Gemini 可能跳过搜索**，对它自认为知道的问题直接凭记忆作答（比如"今天几号"），返回空的来源。参考实现里有这个检查 —— 把空来源当作"未验证的答案"对待。
- **来源只有 Google Search。** `googleSearch` 工具是 Google 独占的；这条路没有 Brave / Bing 选项。
- **有频率限制。** 即便是 Pro，密集请求也会被限速。正确的 `User-Agent` 头（`antigravity/hub/...`）能解锁更宽松的限额 —— 实现里已经帮你设好了。

## 工作原理（一段话）

你通过 Google OAuth 登录，使用 Antigravity 应用凭证（公共的 OAuth 客户端应用凭证，源码里 base64 编码存放）。OAuth 流程会在你的账号上开通一个 Cloud Code Assist 项目。然后你调用 `streamGenerateContent`，把 `{ googleSearch: {} }` 作为工具传入；Gemini 内部使用 Google Search，返回答案以及 `groundingMetadata`（含来源 URL 和它实际执行的查询）。

## 环境要求

- Node.js 18+（使用内置的 `fetch`、`http`、`crypto`）。
- 一个 Google 账号（推荐 Pro 订阅 —— 见上文）。
- 一次性 OAuth 登录用的浏览器。

## 作为 Claude Code skill 使用

装上它，让 Claude Code 能做 Gemini grounding 搜索：

```bash
# 1. 创建 skill 目录
mkdir -p ~/.claude/skills/gemini-grounding-search

# 2. 把两个文件拷进去
curl -o ~/.claude/skills/gemini-grounding-search/SKILL.md \
  https://raw.githubusercontent.com/Clickist/gemini-auth-search/main/claude-skill/SKILL.md
curl -o ~/.claude/skills/gemini-grounding-search/gemini-search.mjs \
  https://raw.githubusercontent.com/Clickist/gemini-auth-search/main/gemini-search.mjs
```

之后 `gemini-grounding-search` 这个 skill 就系统级可用了。或者直接把本 README 顶部那一行提示词粘贴给你的 agent，让它帮你装。

> 脚本和 `SKILL.md` 放在一起 —— Claude Code 读取 skill 后，通过 Bash 执行 `node gemini-search.mjs "<查询>"`。首次搜索会触发浏览器 OAuth 登录。

## License

MIT
