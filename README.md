# AUL Repo Manager — MCP Server

`server_name`: **`aul_uploader`**

基于 [Model Context Protocol](https://spec.modelcontextprotocol.io/) 的 stdio MCP 服务器，用于通过 AI（TRAE / Claude Code 等）向 AUL 远程游戏库上传游戏、读取配置、获取/上传封面、提取 APK 包名等。远程仓库（默认）：

| library | 仓库 | 分支 |
| --- | --- | --- |
| `desktop` | `znm2500/AU-Launcher-Repo`（主 GitHub；同步镜像 `znm1145/AU-Launcher-Repo` on GitCode） | `data` |
| `mobile`  | `znm2500/AUL-Mobile-Repo`（主 GitHub；同步镜像 `znm1145/AUL-Mobile-Repo` on GitCode） | `data` |

封面命名：`{game_id}.webp`。
安装包命名：`{game_id}_{version}_{flavor}_{channel}.{apk|7z|zip|rar}`。

---

## 1. 环境与安装

```bash
cd mcp-server
npm install
```

- Node.js ≥ 18（Windows 下确保 `node` 在 PATH 里）。
- 无 build 步骤，`node index.js` 直接启动。

---

## 2. 接入方式 — 本地（Stdio）

所有支持 **Model Context Protocol** 的客户端（TRAE、Claude Code、Cline/RooCode in VS Code、Windsurf、Cursor 等）都可以接这个服务器。本地接入的方式都是一样的：**让 AI 客户端以子进程方式启动 `node index.js`，并通过 stdin/stdout（stdio transport）与子进程交换 JSON-RPC**。

配置文件位置因客户端而异，但 **`mcpServers` 的 JSON 结构是统一的**：

```json
{
  "mcpServers": {
    "aul_uploader": {
      "command": "node",
      "args": [
        "C:\\Users\\Weaver\\Documents\\GitHub\\AUL-Repo-Manager\\mcp-server\\index.js"
      ]
    }
  }
}
```

> **说明**：
> - `args[0]` 是 **绝对路径**（相对路径取决于 AI 客户端的工作目录，容易出错，建议写绝对）。
> - Windows 下不要硬编码 `C:\Program Files\nodejs\node.exe`，直接写 `node`（依赖 PATH 解析）兼容性更好。
> - macOS / Linux 上同理：`"command": "node"`，args 改成对应绝对路径。

### 2.1 Claude Code（Anthropic）

全局写在 `~/.claude/mcp.json`（`%USERPROFILE%\.claude\mcp.json` on Windows），或只在某项目里生效就写 `<project>/.claude.json`。格式与上面完全一致。

参考：[Claude Code 官方文档 → MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)

### 2.2 TRAE

打开 TRAE 设置 → 「MCP 服务器」→ 新增 stdio server，直接粘贴上面的 JSON 即可；或编辑 TRAE 的全局 MCP 配置文件（一般在 `%USERPROFILE%\.trae-cn\mcp.json` 或 TRAE 数据目录下的对应文件）。

### 2.3 VS Code — Cline / RooCode / MCP 插件

- **Cline（原 RooCode）**：VS Code 扩展设置里找到 "Cline: MCP Servers" 项，粘贴与上面相同的 `mcpServers` JSON。
- **MCP 官方扩展**（`ModelContextProtocol.mcp-vscode`）：打开命令面板 → **MCP: Configure MCP Servers**，再加一条 `aul_uploader`。
- 其他 AI Agent 扩展（Code GPT、Continue、Solo 等）：基本都在扩展设置里提供 `mcpServers` 字段，格式一致。

### 2.4 Windsurf / Cursor

两者都支持 MCP。在设置里找到 "MCP" / "Tools" 节，添加 server：
- **Name**：`aul_uploader`
- **Command**：`node`
- **Args**：`["D:\\path\\to\\index.js"]`

具体入口随版本会变化，以客户端为准。

---

## 3. 接入方式 — 远程（HTTP / SSE）

如果想让**另一台电脑**、**服务器上常驻**的 AI 客户端也能调用同一套 MCP 工具，不用把代码和依赖拷过去，直接在有代码/Token 的机器上起一个 HTTP/SSE 服务端即可。

**启动服务端（本地或服务器）：**

```bash
# 监听所有网卡（0.0.0.0:3001），局域网内任一台机器都能连
node index.js --serve 3001

# 或绑定内网特定 IP
node index.js --serve 3001 --host 192.168.1.20
```

启动成功后会打印：
```
=== AUL Uploader MCP Server (SSE / HTTP) running ===
  Health check : http://0.0.0.0:3001/health
  SSE endpoint : http://0.0.0.0:3001/sse
  Message POST : http://0.0.0.0:3001/message
```

**端点说明（单端口统一提供）：**

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/health` | GET | 健康检查，返回工具数量、活跃 SSE 会话数 |
| `/sse`    | GET | **SSE 下行**，客户端以 EventSource 方式挂上来收 JSON-RPC |
| `/message`| POST | **客户端上行**，把 JSON-RPC 请求 POST 回来 |

**客户端配置（SSE transport）—— 通用结构：**

```json
{
  "mcpServers": {
    "aul_uploader_remote": {
      "transport": "sse",
      "url": "http://<服务器IP或域名>:3001/sse"
    }
  }
}
```

### 3.1 Claude Code（SSE）

把上面的 SSE 配置加到 `~/.claude/mcp.json` 或 `.claude.json`。Claude Code 支持 `transport: sse` + `url`。

### 3.2 TRAE（SSE）

在 TRAE 的「远程 MCP 服务器」里添加，URL 填 `http://<host>:3001/sse`，transport 选 SSE。

### 3.3 VS Code / 其他 IDE

大部分 Agent 扩展对 SSE 的配置名可能略有不同：有的叫 `transport: "streamable-http"`，有的直接用 `url` + `type: "http"`。格式不同时以该客户端官方文档为准，但**服务端 `/sse` + `/message` 的组合是 SSE transport 规范定义的**，按规范实现的客户端都能接。

### 3.4 安全提醒（跨公网部署必看）

当前 SSE transport **本身不提供鉴权**，所以：
1. 内网/VPN 场景：`--host` 绑内网 IP，直接用就好。
2. 跨公网：
   - 前面套 Nginx / Caddy 反代成 HTTPS；
   - 叠加一层鉴权（Basic Auth、`Authorization: Bearer <secret>` Header、IP 白名单三者至少选一个）；
   - 或用 Tailscale/ZeroTier 之类的组网工具把它暴露在虚拟内网。

---

## 4. 启动方式总览

```bash
# (1) 默认 / 显式：Stdio 子进程（本地 AI 客户端接入）
node index.js

# (2) HTTP/SSE 服务器（远程 AI 客户端接入）
node index.js --serve 3001
node index.js --serve 3001 --host 192.168.1.20

# (3) 单次 CLI 工具调试
node index.js --cli <tool> '<json_args>'
```

三种模式**二选一**启动，优先级：`--cli` > `--serve` > 默认 Stdio。

---

## 5. CLI 调试模式

`index.js` 自带 `--cli` 参数，方便离线测试单个工具（不经过 MCP stdio 握手）：

```bash
node index.js --cli <tool_name> '<json_args>'
# 例：
node index.js --cli get_config '{"library":"desktop"}'
node index.js --cli get_apk_id  '{"apk_path":"D:/games/app.apk"}'
node index.js --cli get_cover_image '{"library":"desktop","game_id":"my_game","output_path":"D:/temp/cover.webp"}'
```

成功输出（第一行 JSON）：
```json
{"ok":true,"...":"..."}
```

失败输出（第一行 JSON 含 `error`）：
```json
{"error":"APK 解析失败：invalid zip header"}
```

---

## 6. 工具总览

| # | 工具 | 说明 | 必须 Token |
| ---: | --- | --- | --- |
| 1 | `check_tokens` | 验证 GitHub / GitCode Token 是否可用及权限 | 两个平台 Token |
| 2 | `get_config` | 读取远程库配置（支持按 ID / 名称搜索游戏） | 否（CDN 读取） |
| 3 | `get_cover_image` | ⭐ 下载远程封面为本地文件（CDN 优先，失败回退 GitHub API） | 否（一般情况） |
| 4 | `upload_cover_image` | ⭐ 上传/更新单张封面 | GitHub Token + 可选 GitCode Token |
| 5 | `release_game_asset` | ⭐ 发布安装包（创建 GitHub Release + 附件 + GitCode 同步） | GitHub Token + 可选 GitCode Token |
| 6 | `add_game_entry` | ⭐ 新增/更新游戏条目（更新 data/{library}/config.json + 两个平台 commit push） | GitHub Token + 可选 GitCode Token |
| 7 | `full_upload_game` | ⭐ 一键完整上传：封面 + 安装包 + 游戏条目 | GitHub Token + 可选 GitCode Token |
| 8 | `get_apk_id` | ⭐ 解析 APK 提取包名 → 点号换下划线 → 生成 `game_id`，返回 `version_name` / `version_code` | 否（纯本地） |

---

## 7. 工具详解

### 7.1 `check_tokens`

验证 GitHub / GitCode Token 对仓库的权限（读 + 写），并判断 Token 类型（Classic / Fine-grained / PAT4AI）。

**参数**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `token_gh` | string | ✅ | GitHub Token |
| `token_gc` | string | ❌ | GitCode Token（未提供时跳过 GitCode 校验） |

**返回示例**

```json
{
  "ok": true,
  "github": {
    "valid": true,
    "token_type": "classic",
    "username": "znm2500",
    "scopes": ["repo", "workflow"],
    "permissions": { "repo_read": true, "repo_write": true, "release_write": true }
  },
  "gitcode": {
    "valid": false,
    "error": "未提供 token_gc，跳过 GitCode 校验"
  }
}
```

---

### 7.2 `get_config`

读取远程 `{library}/config.json`，可按 `game_id` / `game_name` / `game_name_en` 搜索游戏；不指定时返回全量列表。

**参数**

| 字段 | 类型 | 必填 | 默认 |
| --- | --- | --- | --- |
| `library` | `"desktop"` / `"mobile"` | ❌ | `"desktop"` |
| `game_id` | string | ❌ | — |
| `game_name` | string | ❌ | — |
| `game_name_en` | string | ❌ | — |
| `case_sensitive` | boolean | ❌ | `false` |
| `return_all_on_empty` | boolean | ❌ | `true` |

**返回示例**（按 ID 搜）

```json
{
  "ok": true,
  "library": "desktop",
  "source": "jsdelivr",
  "games": [
    {
      "id": "some_id",
      "name": "游戏名",
      "name_en": "Some Name",
      "version": "1.0",
      "channel": "release",
      "size": "1.2GB",
      "tags": ["fps"],
      "flavor": "standard"
    }
  ],
  "total_games": 1
}
```

---

### 7.3 `get_cover_image` ⭐

从远程库下载封面图 `{game_id}.webp`。优先走 **jsDelivr CDN**（速度快、无需 Token），CDN 失败时自动回退到 **GitHub Contents API**（base64 解码写盘）。

**典型场景**：本地没有封面 → 先从远程已有游戏拉一张当素材 → 直接喂给 `upload_cover_image` / `full_upload_game`。

**参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `library` | `"desktop"` / `"mobile"` | ✅ | — | — |
| `game_id` | string | ✅ | — | 与远程文件名一致 |
| `output_path` | string | ❌ | `%TEMP%/aul_cover_{id}_{ts}.webp` | 本地保存绝对路径 |
| `use_cdn` | boolean | ❌ | `true` | 是否先尝试 CDN |
| `token_gh` | string | ❌ | — | 只在走 GitHub 回退失败时偶尔需要 |

**返回示例**

```json
{
  "ok": true,
  "game_id": "my_steam_game",
  "library": "desktop",
  "source": "jsdelivr",
  "source_url": "https://cdn.jsdelivr.net/gh/znm2500/AU-Launcher-Repo@data/my_steam_game.webp",
  "saved_path": "D:\\covers\\reuse.webp",
  "size_bytes": 87342
}
```

---

### 7.4 `upload_cover_image`

上传/更新一张封面图到 `data` 分支根目录。自动用 `sharp` 压缩（长边 460、质量 80、格式强制 webp → `{id}.webp`）。

**参数**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `library` | enum | ✅ | `desktop` / `mobile` |
| `game_id` | string | ✅ | 游戏 ID |
| `image_path` | string | ✅ | 本地图片路径（任意常见格式均可，会被转 webp） |
| `token_gh` | string | ✅ | GitHub Token |
| `token_gc` | string | ❌ | 提供则同步到 GitCode |

**返回**：`{ ok, original_size, compressed_size, github_sha, gitcode_sha?, message }`

---

### 7.5 `release_game_asset`

发布安装包。步骤：
1. 创建/更新 GitHub Release（tag 形如 `{game_id}-v{version}-{flavor}-{channel}`）；
2. 删除旧同名附件，上传新附件（受 GitHub 2GB 单文件限制；超限仅做文件提交）；
3. 提供 `token_gc` 时，GitCode 也创建同名 Release 并上传附件。

**参数**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `library` | enum | ✅ | — |
| `game_id` | string | ✅ | — |
| `version` | string | ✅ | 语义版本（推荐）或任意版本号 |
| `flavor` | `"standard"` / `"dlc"` / `"mod"` | ❌ | 默认 `standard` |
| `channel` | `"release"` / `"beta"` | ❌ | 默认 `release` |
| `asset_path` | string | ✅ | 本地安装包（.apk / .7z / .zip / .rar） |
| `description` | string | ❌ | Release 描述，可用 Markdown |
| `token_gh` | string | ✅ | — |
| `token_gc` | string | ❌ | — |

**返回**：`{ ok, github_release, gitcode_release?, warnings?, direct_commit_gh?, direct_commit_gc? }`

---

### 7.6 `add_game_entry`

往 `{library}/config.json` 里**合并**（按 `id` 去重）一个游戏条目。如果 tags 是 `["mobile"]` 但 `library=desktop`，会额外自动把 tags 追加为 `["mobile", ...]`。提交到 GitHub 并可选同步到 GitCode。

**参数**

| 字段 | 类型 | 必填 |
| --- | --- | --- |
| `library` | enum | ✅ |
| `game` | object | ✅ 结构与 [GameAdder.vue 输出一致](file:///c:/Users/Weaver/Documents/GitHub/AUL-Repo-Manager/src/components/GameAdder.vue#L18-L59)，含 `id / name / name_en / version / channel / size / tags / cover / downloadUrl / flavor / downloadScript` |
| `token_gh` | string | ✅ |
| `token_gc` | string | ❌ |

**返回**：`{ ok, github_commit_sha, gitcode_commit_sha?, new_count, total_count, added_or_updated, game }`

---

### 7.7 `full_upload_game` ⭐

一步完成 **封面上传 + 安装包发布 + 游戏条目添加**。内部自动根据返回的 sha 拼 `jsdelivr` 直链填到 `game.cover` 与 `game.downloadUrl`，无需用户操心。

**参数** = `upload_cover_image` + `release_game_asset` + `add_game_entry` 的并集：
- 必要：`library / token_gh / game(id,name,name_en,version,channel,size,tags) / asset_path / cover_image_path`
- 可选：`flavor / channel / description / cover_version_msg / asset_version_msg / token_gc`

**返回**：`{ ok, cover_upload, asset_release, game_entry, game }`

---

### 7.8 `get_apk_id` ⭐

纯本地解析 APK，提取 `packageName` 并把 `.` 替换成 `_` 生成符合 AUL 规则的 `game_id`。同时返回 `versionName` / `versionCode`。

**参数**

| 字段 | 类型 | 必填 |
| --- | --- | --- |
| `apk_path` | string | ✅ 本地 APK 绝对路径 |

**返回示例**

```json
{
  "ok": true,
  "package_name": "com.example.mygame",
  "game_id": "com_example_mygame",
  "version_name": "1.0.0",
  "version_code": 100
}
```

---

## 8. 常见工作流

### 8.1 桌面端：上传新游戏

```
get_apk_id 或自己决定 game_id
   ↓
full_upload_game(
  library="desktop",
  game.id=...,
  cover_image_path="D:/pics/xxx.png",
  asset_path="D:/games/xxx.7z",
  token_gh=...,
  token_gc=...
)
```

### 8.2 移动端：上传新 APK

```
get_apk_id(apk_path="D:/apk/app.apk")
  → 拿到 { game_id, version_name }
full_upload_game(
  library="mobile",
  game.id=...,
  game.version=version_name,
  asset_path=apk_path,
  cover_image_path=...
)
```

### 8.3 本地没封面 → 复用远程已有封面

```
get_cover_image(
  library="desktop",
  game_id="existing_game",
  output_path="D:/temp/cover.webp"
)
  → 返回 { saved_path }

full_upload_game(
  cover_image_path = saved_path,
  ...
)
```

### 8.4 只读操作（免 Token）

- 查询已有游戏：`get_config`
- 下载封面：`get_cover_image`
- 生成 ID：`get_apk_id`

这些不需要任何 Token，可直接调用。

---

## 9. 同步工具描述到 TRAE 目录

`tools/*.json` + `SERVER_METADATA.json` 需要拷贝到 TRAE 的 solo agent lite 目录下，TRAE 才能在 UI 侧展示新工具：

```
源：mcp-server/
  ├─ SERVER_METADATA.json
  └─ tools/*.json

目标：
%USERPROFILE%\.trae-cn\mcps\s_AUL-Repo-Manager-ff6bc2c0\solo_agent_lite\aul_uploader\
  ├─ SERVER_METADATA.json
  └─ tools\*.json
```

（Windows PowerShell 一键复制命令）：
```powershell
$src = "c:\Users\Weaver\Documents\GitHub\AUL-Repo-Manager\mcp-server"
$dst = "$env:USERPROFILE\.trae-cn\mcps\s_AUL-Repo-Manager-ff6bc2c0\solo_agent_lite\aul_uploader"
New-Item -ItemType Directory -Force -Path (Join-Path $dst "tools") | Out-Null
Copy-Item -Force (Join-Path $src "SERVER_METADATA.json") $dst
Get-ChildItem (Join-Path $src "tools") -Filter *.json | ForEach-Object {
  Copy-Item -Force $_.FullName (Join-Path $dst "tools")
}
```

---

## 10. 依赖说明

| 包 | 用途 |
| --- | --- |
| `@modelcontextprotocol/sdk` | MCP stdio 服务端 SDK |
| `apk-info-parser` | 本地解析 APK 清单（packageName / versionName / versionCode） |
| `axios` | HTTP 请求 GitHub / GitCode / jsDelivr |
| `sharp` | 封面自动转 webp 并压缩（长边 460，质量 80） |

---

## 11. 错误排查

| 症状 | 常见原因 | 解决 |
| --- | --- | --- |
| `node.exe not found` | TRAE 配置里写死了错误的 node 路径 | 改成 `"command": "node"` 让 PATH 解析 |
| `access denied` 写 `.trae-cn` 失败 | 直接在 MCP 工具里写 TRAE 配置目录受限制 | 写到项目 `mcp-server/`，再用 PowerShell `Copy-Item` 同步 |
| CLI 测试 JSON 解析错误 | PowerShell `Out-File` 默认加 UTF-8 BOM | 用 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` 或直接单行命令 |
| 封面上传后 CDN 不刷新 | jsDelivr 有 ~10 分钟缓存 | 等待，或后续用 `purge` 接口刷新 |
| Release 附件失败 > 2 GB | GitHub Release 单文件上限 2 GB | 脚本会自动 fallback 成直接 commit 到 data 分支；返回会带 `direct_commit_gh` 字段 |
