# AUL Uploader — MCP Server

`server_name`: **`aul_uploader`**

基于 Model Context Protocol 的 MCP 服务器，用于向 AUL 远程游戏库上传游戏、管理配置与封面。双仓库同步：GitHub 为主，GitCode 为镜像。

| library   | 仓库                                                                     | 分支     | 资源扩展名  |
| --------- | ---------------------------------------------------------------------- | ------ | ------ |
| `desktop` | GitHub `znm2500/AU-Launcher-Repo` / GitCode `znm1145/AU-Launcher-Repo` | `data` | `.7z`  |
| `mobile`  | GitHub `znm2500/AUL-Mobile-Repo` / GitCode `znm1145/AUL-Mobile-Repo`   | `data` | `.apk` |

封面命名：`{game_id}.webp`
安装包命名：`{game_id}.{ext}`（ext 由 library 决定）
配置文件：`config.json`（data 分支根目录）

***

## 1. 环境与安装

```bash
npm install
```

- Node.js >= 18

- 无 build 步骤，`node index.js` 直接启动

依赖：

| 包                           | 用途                                  |
| --------------------------- | ----------------------------------- |
| `@modelcontextprotocol/sdk` | MCP stdio / SSE 服务端 SDK             |
| `apk-info-parser`           | 本地解析 APK 清单（包名 / 版本）                |
| `axios`                     | HTTP 请求 GitHub / GitCode / jsDelivr |
| `sharp`                     | 封面缩放并转 WebP                         |

***

## 2. 接入方式

### 2.1 本地（Stdio）

```json
{
  "mcpServers": {
    "aul_uploader": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\index.js"]
    }
  }
}
```

`args[0]` 建议写绝对路径，避免工作目录不一致导致找不到文件。

### 2.2 远程（HTTP / SSE）

```bash
# 监听所有网卡
node index.js --serve 3001

# 绑定指定 IP
node index.js --serve 3001 --host 192.168.1.20
```

启动后输出：

```
=== AUL Uploader MCP Server (SSE / HTTP) running ===
  Health check : http://0.0.0.0:3001/health
  SSE endpoint : http://0.0.0.0:3001/sse
  Message POST : http://0.0.0.0:3001/message
```

| 路径         | 方法   | 作用               |
| ---------- | ---- | ---------------- |
| `/health`  | GET  | 健康检查，返回工具数与活跃会话数 |
| `/sse`     | GET  | SSE 下行通道         |
| `/message` | POST | 客户端上行 JSON-RPC   |

客户端配置：

```json
{
  "mcpServers": {
    "aul_uploader_remote": {
      "transport": "sse",
      "url": "http://<host>:3001/sse"
    }
  }
}
```

> 安全提醒：SSE 本身无鉴权，跨公网部署时请在前面套 HTTPS 反代并加鉴权（Basic Auth / Bearer Token / IP 白名单三选一）。

### 2.3 启动方式总览

```bash
# 默认：Stdio 子进程
node index.js

# HTTP/SSE 服务端
node index.js --serve 3001 [--host <ip>]

# 单次 CLI 调试
node index.js --cli <tool> '<json_args>'
node index.js --cli <tool> @args.json
```

优先级：`--cli` > `--serve` > 默认 Stdio。

***

## 3. 工具总览

|  # | 工具                     | 说明                                     | 需要 Token              |
| -: | ---------------------- | -------------------------------------- | --------------------- |
|  1 | `check_tokens`         | 验证 GitHub / GitCode Token 是否有效         | token\_gh + token\_gt |
|  2 | `get_config`           | 读取远程 config.json，返回 games 列表与双仓库 sha   | token\_gh + token\_gt |
|  3 | `upload_cover_image`   | 上传/更新封面（自动缩放转 WebP，双仓库同步）              | token\_gh + token\_gt |
|  4 | `release_game_asset`   | 发布安装包到 Release（v{version} 需预先存在）       | token\_gh + token\_gt |
|  5 | `add_game_entry`       | 向 config.json 添加游戏条目并推送双仓库             | token\_gh + token\_gt |
|  6 | `full_upload_game`     | 一键完整上传：验证 -> 配置 -> 条目 -> 封面 -> Release | token\_gh + token\_gt |
|  7 | `get_apk_id`           | 解析 APK 包名生成 game\_id                   | 否（纯本地）                |
|  8 | `get_cover_image`      | 下载远程封面（CDN 优先，失败回退 GitHub API）         | 否（通常）                 |
|  9 | `delete_repo_file`     | 删除 data 分支中的文件（双仓库同步）                  | token\_gh + token\_gt |
| 10 | `delete_release_asset` | 删除 Release 中的资源文件                      | token\_gh + token\_gt |

***

## 4. 工具详解

### 4.1 `check_tokens`

验证两个平台的 Token 对仓库的访问权限。

**参数**

| 字段         | 类型     | 必填 |
| ---------- | ------ | -- |
| `token_gh` | string | 是  |
| `token_gt` | string | 是  |

**返回**

```json
{ "ok": true, "message": "Token 验证通过" }
```

***

### 4.2 `get_config`

读取远程 `config.json`，返回 games 列表摘要以及双仓库的 blob sha（供 `add_game_entry` 使用）。

**参数**

| 字段         | 类型                       | 必填 | 默认          |
| ---------- | ------------------------ | -- | ----------- |
| `token_gh` | string                   | 是  | —           |
| `token_gt` | string                   | 是  | —           |
| `library`  | `"desktop"` / `"mobile"` | 是  | `"desktop"` |

**返回**

```json
{
  "sha_gh": "abc123...",
  "sha_gt": "def456...",
  "game_count": 42,
  "games": [
    {
      "id": "game_id",
      "name_zh": "游戏名",
      "name_en": "Game Name",
      "engine": "Unity",
      "version": "0.0.1",
      "hot_score": 100
    }
  ],
  "raw_config": { "...": "完整的 config 对象" }
}
```

> `raw_config` 就是完整的 config 对象，`add_game_entry` 需要把它原样传回去。

***

### 4.3 `upload_cover_image`

上传或更新封面图片到 data 分支。自动缩放（最大 640x480，保持比例，不放大）并转为 WebP（质量 80）。双仓库同步，完成后清除 jsDelivr 缓存。

**参数**

| 字段           | 类型     | 必填 | 说明                       |
| ------------ | ------ | -- | ------------------------ |
| `token_gh`   | string | 是  | GitHub Token             |
| `token_gt`   | string | 是  | GitCode Token            |
| `library`    | enum   | 是  | `desktop` / `mobile`     |
| `image_path` | string | 是  | 本地图片绝对路径（webp/png/jpg 等） |
| `game_id`    | string | 是  | 游戏 ID，只允许字母数字下划线         |

**返回**

```json
{
  "ok": true,
  "file": "game_id.webp",
  "library": "desktop"
}
```

***

### 4.4 `release_game_asset`

发布安装包到 GitHub / GitCode Release。对应 tag `v{version}` 必须预先存在。上传前会删除同名旧资产。

**参数**

| 字段              | 类型     | 必填 | 默认          | 说明                                  |
| --------------- | ------ | -- | ----------- | ----------------------------------- |
| `token_gh`      | string | 是  | —           | GitHub Token                        |
| `token_gt`      | string | 是  | —           | GitCode Token                       |
| `library`       | enum   | 是  | `"desktop"` | 决定扩展名 desktop=.7z, mobile=.apk      |
| `version`       | enum   | 是  | —           | `"0.0.1"` / `"0.0.2"`               |
| `game_id`       | string | 是  | —           | 文件命名为 `{game_id}.{ext}`             |
| `file_path`     | string | 是  | —           | 本地安装包绝对路径                           |
| `upload_target` | enum   | 否  | `"both"`    | `"github"` / `"gitcode"` / `"both"` |

**返回**

```json
{
  "ok": true,
  "version": "0.0.1",
  "target": "both",
  "file": "game_id.7z"
}
```

***

### 4.5 `add_game_entry`

向 config.json 的 games 数组中追加一个条目并推送回双仓库。自动写入 `publish_time`（如未提供）。

**参数**

| 字段         | 类型     | 必填 | 说明                                           |
| ---------- | ------ | -- | -------------------------------------------- |
| `token_gh` | string | 是  | GitHub Token                                 |
| `token_gt` | string | 是  | GitCode Token                                |
| `library`  | enum   | 是  | `desktop` / `mobile`                         |
| `sha_gh`   | string | 是  | config 在 GitHub 的 sha（来自 `get_config`）       |
| `sha_gt`   | string | 是  | config 在 GitCode 的 sha（来自 `get_config`）      |
| `config`   | object | 是  | 完整 config 对象（来自 `get_config` 的 `raw_config`） |
| `game`     | object | 是  | 游戏数据，结构见下                                    |

`game` 对象：

| 字段             | 类型      | 必填 | 说明                    |
| -------------- | ------- | -- | --------------------- |
| `id`           | string  | 是  | 唯一 ID，只允许字母数字下划线      |
| `name`         | object  | 是  | `{ zh, en }`          |
| `author`       | object  | 是  | `{ zh, en }`          |
| `engine`       | string  | 是  | 引擎名，如 Unity / GMS2    |
| `version`      | enum    | 是  | `"0.0.1"` / `"0.0.2"` |
| `hot_score`    | integer | 否  | >=0，默认 0              |
| `publish_time` | string  | 否  | ISO 时间，默认当前时间         |

**返回**

```json
{
  "ok": true,
  "added_entry": {
    "id": "game_id",
    "name": { "zh": "...", "en": "..." },
    "author": { "zh": "...", "en": "..." },
    "engine": "Unity",
    "version": "0.0.1",
    "hot_score": 0,
    "publish_time": "2026-09-04T00:00:00.000Z"
  }
}
```

**校验规则**：

- `id` 只能包含字母、数字、下划线

- `name.zh` 和 `name.en` 必填

- `author.zh` 和 `author.en` 必填

- `version` 只能是 `0.0.1` 或 `0.0.2`

- `hot_score` 必须是 >=0 的整数

- `id` 不能与已有条目重复

***

### 4.6 `full_upload_game`

一键完整上传，按顺序执行：验证 Token -> 获取配置 -> 添加游戏条目 -> 上传封面 -> 发布 Release。

**参数**

| 字段              | 类型     | 必填 | 默认          | 说明                           |
| --------------- | ------ | -- | ----------- | ---------------------------- |
| `token_gh`      | string | 是  | —           | GitHub Token                 |
| `token_gt`      | string | 是  | —           | GitCode Token                |
| `library`       | enum   | 是  | `"desktop"` | `desktop` / `mobile`         |
| `image_path`    | string | 是  | —           | 本地封面图片绝对路径                   |
| `file_path`     | string | 是  | —           | 本地安装包绝对路径                    |
| `game`          | object | 是  | —           | 同 `add_game_entry` 的 game 结构 |
| `upload_target` | enum   | 否  | `"both"`    | Release 上传目标                 |

**返回**

```json
{
  "ok": true,
  "steps": [
    "1. Token 验证通过",
    "2. 获取配置成功 (当前游戏 N 个)",
    "3. 添加游戏条目成功: game_id",
    "4. 封面上传成功: game_id.webp",
    "5. Release 发布成功: game_id.7z @ v0.0.1"
  ],
  "game_id": "game_id"
}
```

***

### 4.7 `get_apk_id`

纯本地解析 APK，提取包名并将 `.` 替换为 `_`，生成符合 AUL 规则的 game\_id。

**参数**

| 字段         | 类型     | 必填 | 说明          |
| ---------- | ------ | -- | ----------- |
| `apk_path` | string | 是  | 本地 APK 绝对路径 |

**返回**

```json
{
  "ok": true,
  "package_name": "com.example.mygame",
  "game_id": "com_example_mygame",
  "version_name": "1.0.0",
  "version_code": 100
}
```

***

### 4.8 `get_cover_image`

从远程下载封面 `{game_id}.webp`。优先走 jsDelivr CDN（无需 Token，速度快），失败时回退到 GitHub Contents API。

**参数**

| 字段            | 类型      | 必填 | 默认          | 说明                        |
| ------------- | ------- | -- | ----------- | ------------------------- |
| `library`     | enum    | 是  | `"desktop"` | `desktop` / `mobile`      |
| `game_id`     | string  | 是  | —           | 游戏 ID                     |
| `output_path` | string  | 否  | 系统临时目录      | 保存到本地的绝对路径                |
| `use_cdn`     | boolean | 否  | `true`      | 是否优先走 CDN                 |
| `token_gh`    | string  | 否  | —           | 仅 CDN 失败回退 GitHub API 时需要 |

**返回**

```json
{
  "ok": true,
  "game_id": "game_id",
  "library": "desktop",
  "source": "jsdelivr",
  "source_url": "https://cdn.jsdelivr.net/gh/znm2500/AU-Launcher-Repo@data/game_id.webp",
  "saved_path": "D:\\covers\\game_id.webp",
  "size_bytes": 87342
}
```

***

### 4.9 `delete_repo_file`

从 data 分支删除指定文件，双仓库同步。

**参数**

| 字段          | 类型     | 必填 | 说明                       |
| ----------- | ------ | -- | ------------------------ |
| `token_gh`  | string | 是  | GitHub Token             |
| `token_gt`  | string | 是  | GitCode Token            |
| `library`   | enum   | 是  | `desktop` / `mobile`     |
| `file_name` | string | 是  | 要删除的文件名，如 `game_id.webp` |

**返回**

```json
{
  "ok": true,
  "deleted_file": "game_id.webp",
  "library": "desktop"
}
```

***

### 4.10 `delete_release_asset`

从指定 Release（tag 为 `v{version}`）中删除资源文件。

**参数**

| 字段              | 类型     | 必填 | 默认          | 说明                                  |
| --------------- | ------ | -- | ----------- | ----------------------------------- |
| `token_gh`      | string | 是  | —           | GitHub Token                        |
| `token_gt`      | string | 是  | —           | GitCode Token                       |
| `library`       | enum   | 是  | `"desktop"` | `desktop` / `mobile`                |
| `version`       | enum   | 是  | —           | `"0.0.1"` / `"0.0.2"`               |
| `file_name`     | string | 是  | —           | 资源文件名，如 `game_id.7z`                |
| `upload_target` | enum   | 否  | `"both"`    | `"github"` / `"gitcode"` / `"both"` |

**返回**

```json
{
  "ok": true,
  "version": "0.0.1",
  "file": "game_id.7z",
  "target": "both"
}
```

***

## 5. 常见工作流

### 5.1 桌面端上传新游戏

```
full_upload_game(
  library = "desktop",
  game = { id, name:{zh,en}, author:{zh,en}, engine, version },
  image_path = "D:/pics/cover.png",
  file_path = "D:/games/game.7z",
  token_gh = ...,
  token_gt = ...
)
```

### 5.2 移动端上传新 APK

```
1. get_apk_id(apk_path = "D:/apk/app.apk")
   -> 拿到 { game_id, version_name }

2. full_upload_game(
     library = "mobile",
     game = { id: game_id, name:{...}, author:{...}, engine, version },
     file_path = apk_path,
     image_path = ...
   )
```

### 5.3 复用远程已有封面

```
1. get_cover_image(library, game_id, output_path = "D:/temp/cover.webp")
   -> { saved_path }

2. full_upload_game(image_path = saved_path, ...)
```

### 5.4 分步上传（需要中间结果时）

```
1. check_tokens
2. get_config -> 拿到 { sha_gh, sha_gt, raw_config }
3. add_game_entry(config = raw_config, sha_gh, sha_gt, game = ...)
4. upload_cover_image(image_path, game_id)
5. release_game_asset(version, game_id, file_path)
```

### 5.5 只读操作（免 Token）

| 操作          | 工具                           |
| ----------- | ---------------------------- |
| 查游戏列表       | `get_config`（需 token）        |
| 下载封面        | `get_cover_image`（通常免 token） |
| 生成 game\_id | `get_apk_id`（纯本地）            |

***

## 6. 同步工具描述到 TRAE

`tools/*.json` 与 `SERVER_METADATA.json` 需拷贝到 TRAE solo agent lite 目录，TRAE 才能在 UI 侧展示工具：

```
源：
  SERVER_METADATA.json
  tools/*.json

目标：
  %USERPROFILE%\.trae-cn\mcps\s_AUL-Repo-Manager-<hash>\solo_agent_lite\aul_uploader\
    ├─ SERVER_METADATA.json
    └─ tools\*.json
```

PowerShell 一键同步：

```powershell
$src = "c:\Users\Weaver\Documents\GitHub\aul-uploader-mcp"
$dst = "$env:USERPROFILE\.trae-cn\mcps\s_AUL-Repo-Manager-<hash>\solo_agent_lite\aul_uploader"
New-Item -ItemType Directory -Force -Path (Join-Path $dst "tools") | Out-Null
Copy-Item -Force (Join-Path $src "SERVER_METADATA.json") $dst
Get-ChildItem (Join-Path $src "tools") -Filter *.json | ForEach-Object {
  Copy-Item -Force $_.FullName (Join-Path $dst "tools")
}
```

***

## 7. 错误排查

| 症状                   | 常见原因                       | 解决                               |
| -------------------- | -------------------------- | -------------------------------- |
| `node.exe not found` | 配置里写死了错误的 node 路径          | 改成 `"command": "node"` 让 PATH 解析 |
| Token 验证失败           | Token 过期或无仓库权限             | 重新生成 Token，确保有 repo 读写权限         |
| config 更新 409        | sha 过期，仓库有新提交              | 重新调用 `get_config` 获取最新 sha       |
| 封面上传后 CDN 不刷新        | jsDelivr 有缓存               | 等待，代码已自动调用 purge 接口              |
| Release 上传失败         | tag `v{version}` 不存在       | 先在仓库创建对应 Release                 |
| GitCode 上传失败         | GitCode API 限流或 token 权限不足 | 检查 token 权限，稍后重试                 |

