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

## 2. TRAE 接入（stdio）

在 TRAE 的 MCP 配置里添加：

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

**关键提醒（Windows）：**
- 不建议硬编码 `C:\Program Files\nodejs\node.exe`，直接写 `node`（通过 PATH 解析）兼容性更好。
- 修改配置后需要在 TRAE 里重载 MCP 服务。

---

## 3. CLI 调试模式

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

## 4. 工具总览

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

## 5. 工具详解

### 5.1 `check_tokens`

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

### 5.2 `get_config`

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

### 5.3 `get_cover_image` ⭐

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

### 5.4 `upload_cover_image`

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

### 5.5 `release_game_asset`

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

### 5.6 `add_game_entry`

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

### 5.7 `full_upload_game` ⭐

一步完成 **封面上传 + 安装包发布 + 游戏条目添加**。内部自动根据返回的 sha 拼 `jsdelivr` 直链填到 `game.cover` 与 `game.downloadUrl`，无需用户操心。

**参数** = `upload_cover_image` + `release_game_asset` + `add_game_entry` 的并集：
- 必要：`library / token_gh / game(id,name,name_en,version,channel,size,tags) / asset_path / cover_image_path`
- 可选：`flavor / channel / description / cover_version_msg / asset_version_msg / token_gc`

**返回**：`{ ok, cover_upload, asset_release, game_entry, game }`

---

### 5.8 `get_apk_id` ⭐

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

## 6. 常见工作流

### 6.1 桌面端：上传新游戏

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

### 6.2 移动端：上传新 APK

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

### 6.3 本地没封面 → 复用远程已有封面

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

### 6.4 只读操作（免 Token）

- 查询已有游戏：`get_config`
- 下载封面：`get_cover_image`
- 生成 ID：`get_apk_id`

这些不需要任何 Token，可直接调用。

---

## 7. 同步工具描述到 TRAE 目录

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

## 8. 依赖说明

| 包 | 用途 |
| --- | --- |
| `@modelcontextprotocol/sdk` | MCP stdio 服务端 SDK |
| `apk-info-parser` | 本地解析 APK 清单（packageName / versionName / versionCode） |
| `axios` | HTTP 请求 GitHub / GitCode / jsDelivr |
| `sharp` | 封面自动转 webp 并压缩（长边 460，质量 80） |

---

## 9. 错误排查

| 症状 | 常见原因 | 解决 |
| --- | --- | --- |
| `node.exe not found` | TRAE 配置里写死了错误的 node 路径 | 改成 `"command": "node"` 让 PATH 解析 |
| `access denied` 写 `.trae-cn` 失败 | 直接在 MCP 工具里写 TRAE 配置目录受限制 | 写到项目 `mcp-server/`，再用 PowerShell `Copy-Item` 同步 |
| CLI 测试 JSON 解析错误 | PowerShell `Out-File` 默认加 UTF-8 BOM | 用 `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))` 或直接单行命令 |
| 封面上传后 CDN 不刷新 | jsDelivr 有 ~10 分钟缓存 | 等待，或后续用 `purge` 接口刷新 |
| Release 附件失败 > 2 GB | GitHub Release 单文件上限 2 GB | 脚本会自动 fallback 成直接 commit 到 data 分支；返回会带 `direct_commit_gh` 字段 |
