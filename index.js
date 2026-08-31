import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { APK } from "apk-info-parser";
import axios from "axios";
import sharp from "sharp";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// ========== 常量配置 ==========
const OWNER = "znm2500";
const OWNER_GT = "znm1145";
const CONFIG_PATH = "config.json";
const BRANCH = "data";
const REPOS = {
  desktop: "AU-Launcher-Repo",
  mobile: "AUL-Mobile-Repo",
};
const GH_API = "https://api.github.com/repos";
const GC_API = "https://api.gitcode.com/api/v5/repos";

const GAME_CONFIG_FIELDS = [
  "name",
  "author",
  "engine",
  "version",
  "id",
  "publish_time",
  "hot_score",
];

// ========== 通用工具函数 ==========
function b64Encode(buf) {
  return buf.toString("base64");
}

function b64Decode(str) {
  return Buffer.from(str.replace(/\n/g, ""), "base64");
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": "AUL-MCP-Server",
    Accept: "application/vnd.github+json",
  };
}

function gcParams(token, extra = {}) {
  return { access_token: token, ...extra };
}

function repoAssetExt(repo) {
  return repo === REPOS.mobile ? "apk" : "7z";
}

function sanitizeConfig(config) {
  if (!config?.games || !Array.isArray(config.games)) return config;
  return {
    ...config,
    games: config.games.map((g) => {
      const out = {};
      for (const k of GAME_CONFIG_FIELDS) if (k in g) out[k] = g[k];
      return out;
    }),
  };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ========== 1. Token 验证 ==========
async function checkTokens(tokenGh, tokenGt) {
  const gh = axios.get(`${GH_API}/${OWNER}/${REPOS.desktop}`, {
    headers: ghHeaders(tokenGh),
  });
  const gt = axios.get(`${GC_API}/${OWNER_GT}/${REPOS.desktop}`, {
    headers: { "User-Agent": "AUL-MCP-Server" },
    params: gcParams(tokenGt),
  });
  const [r1, r2] = await Promise.all([gh, gt]);
  return r1.status === 200 && r2.status === 200;
}

// ========== 2. 获取配置 ==========
async function getRepoConfig(tokenGh, tokenGt, repo) {
  const ghUrl = `${GH_API}/${OWNER}/${repo}/contents/${CONFIG_PATH}`;
  const gcUrl = `${GC_API}/${OWNER_GT}/${repo}/contents/${CONFIG_PATH}`;

  const [ghResp, gcResp] = await Promise.all([
    axios.get(ghUrl, {
      headers: ghHeaders(tokenGh),
      params: { ref: BRANCH },
    }),
    axios.get(gcUrl, {
      headers: { "User-Agent": "AUL-MCP-Server" },
      params: gcParams(tokenGt, { ref: BRANCH }),
    }),
  ]);

  if (ghResp.status !== 200 || gcResp.status !== 200) {
    throw new Error(
      `获取配置失败: GitHub=${ghResp.status}, GitCode=${gcResp.status}`
    );
  }

  const shaGh = ghResp.data.sha;
  const shaGt = gcResp.data.sha;
  const config = JSON.parse(b64Decode(gcResp.data.content).toString("utf8"));
  return { sha_gh: shaGh, sha_gt: shaGt, config };
}

// ========== 3. 更新配置 ==========
async function updateRepoConfig(
  tokenGh,
  tokenGt,
  repo,
  configObj,
  shaGh,
  shaGt
) {
  const clean = sanitizeConfig(configObj);
  const encoded = b64Encode(
    Buffer.from(JSON.stringify(clean, null, 2), "utf8")
  );
  const ghUrl = `${GH_API}/${OWNER}/${repo}/contents/${CONFIG_PATH}`;
  const gcUrl = `${GC_API}/${OWNER_GT}/${repo}/contents/${CONFIG_PATH}`;

  const putPayload = (sha) => ({
    message: "update config via AUL-MCP",
    content: encoded,
    sha,
    branch: BRANCH,
  });

  const postPayload = {
    message: "update config via AUL-MCP",
    content: encoded,
    branch: BRANCH,
  };

  // GitHub
  let ghOk = false;
  try {
    const r = await axios.put(ghUrl, putPayload(shaGh), {
      headers: ghHeaders(tokenGh),
    });
    ghOk = r.status === 200 || r.status === 201;
  } catch (e) {
    // 409 重试
    if (e?.response?.status === 409) {
      const fresh = await axios.get(ghUrl, {
        headers: ghHeaders(tokenGh),
        params: { ref: BRANCH },
      });
      const r2 = await axios.put(ghUrl, putPayload(fresh.data.sha), {
        headers: ghHeaders(tokenGh),
      });
      ghOk = r2.status === 200 || r2.status === 201;
    } else throw e;
  }

  // GitCode
  let gtOk = false;
  try {
    const r = await axios.put(
      gcUrl,
      putPayload(shaGt),
      {
        headers: { "User-Agent": "AUL-MCP-Server" },
        params: gcParams(tokenGt),
      }
    );
    gtOk = r.status === 200 || r.status === 201;
  } catch (e) {
    const code = e?.response?.status;
    if ([400, 409, 422].includes(code)) {
      const fresh = await axios.get(gcUrl, {
        headers: { "User-Agent": "AUL-MCP-Server" },
        params: gcParams(tokenGt, { ref: BRANCH }),
      });
      const r2 = await axios.put(
        gcUrl,
        putPayload(fresh.data.sha),
        {
          headers: { "User-Agent": "AUL-MCP-Server" },
          params: gcParams(tokenGt),
        }
      );
      gtOk = r2.status === 200 || r2.status === 201;
    } else throw e;
  }

  if (!ghOk || !gtOk) {
    throw new Error(`配置更新失败: GitHub=${ghOk}, GitCode=${gtOk}`);
  }

  // 清除 jsdelivr 缓存
  try {
    await axios.get(
      `https://purge.jsdelivr.net/gh/${OWNER}/${repo}@${BRANCH}/${CONFIG_PATH}`
    );
  } catch {}
}

// ========== 4. 获取仓库中的文件（用于判断图片是否已存在）==========
async function ghGetFile(client, tokenGh, repo, fileName) {
  try {
    const r = await client.get(`${GH_API}/${OWNER}/${repo}/contents/${fileName}`, {
      headers: ghHeaders(tokenGh),
      params: { ref: BRANCH },
    });
    return { sha: r.data.sha, content: r.data.content };
  } catch (e) {
    if (e?.response?.status === 404) return null;
    throw e;
  }
}

async function gcGetFile(client, tokenGt, repo, fileName) {
  const url = `${GC_API}/${OWNER_GT}/${repo}/contents/${fileName}`;
  for (const q of [gcParams(tokenGt, { ref: BRANCH }), gcParams(tokenGt)]) {
    try {
      const r = await client.get(url, {
        headers: { "User-Agent": "AUL-MCP-Server" },
        params: q,
      });
      return { sha: r.data.sha, content: r.data.content };
    } catch (e) {
      if (e?.response?.status === 404) continue;
      throw e;
    }
  }
  return null;
}

// ========== 5. 上传/更新封面图片 ==========
async function uploadCoverImage(
  tokenGh,
  tokenGt,
  repo,
  imagePath,
  gameId
) {
  // 读取并处理图片：缩放 + WebP 编码
  const raw = await fs.readFile(imagePath);
  const img = sharp(raw);
  const meta = await img.metadata();
  const mw = 640, mh = 480;
  const rw = mw / meta.width, rh = mh / meta.height;
  const ratio = Math.min(rw, rh, 1);
  const nw = Math.round(meta.width * ratio);
  const nh = Math.round(meta.height * ratio);

  const webpData = await img
    .resize(nw, nh, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 80 })
    .toBuffer();

  const b64 = b64Encode(webpData);
  const fileName = `${gameId}.webp`;
  const client = axios.create();

  // --- GitHub ---
  const ghUrl = `${GH_API}/${OWNER}/${repo}/contents/${fileName}`;
  let ghOk = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const existing = await ghGetFile(client, tokenGh, repo, fileName);
      const payload = existing
        ? {
            message: "update image via AUL-MCP",
            content: b64,
            sha: existing.sha,
            branch: BRANCH,
          }
        : {
            message: "upload image via AUL-MCP",
            content: b64,
            branch: BRANCH,
          };
      const r = existing
        ? await client.put(ghUrl, payload, { headers: ghHeaders(tokenGh) })
        : await client.put(ghUrl, payload, { headers: ghHeaders(tokenGh) });
      ghOk = r.status === 200 || r.status === 201;
      break;
    } catch (e) {
      if (attempt === 3) throw new Error(`GitHub 图片上传失败: ${e.message}`);
      await delay(300 * attempt);
    }
  }

  await delay(200);

  // --- GitCode ---
  const gcUrl = `${GC_API}/${OWNER_GT}/${repo}/contents/${fileName}`;
  let gtOk = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const existing = await gcGetFile(client, tokenGt, repo, fileName);
      if (existing) {
        const payload = {
          message: "update image via AUL-MCP",
          content: b64,
          sha: existing.sha,
          branch: BRANCH,
        };
        const r = await client.put(gcUrl, payload, {
          headers: { "User-Agent": "AUL-MCP-Server" },
          params: gcParams(tokenGt),
        });
        gtOk = r.status === 200 || r.status === 201;
      } else {
        const payload = {
          message: "upload image via AUL-MCP",
          content: b64,
          branch: BRANCH,
        };
        let r = await client.post(gcUrl, payload, {
          headers: { "User-Agent": "AUL-MCP-Server" },
          params: gcParams(tokenGt),
        });
        if ([400, 409, 422].includes(r.status)) {
          // 回退为 update
          const existing2 = await gcGetFile(client, tokenGt, repo, fileName);
          if (existing2) {
            const payload2 = {
              message: "update image via AUL-MCP",
              content: b64,
              sha: existing2.sha,
              branch: BRANCH,
            };
            r = await client.put(gcUrl, payload2, {
              headers: { "User-Agent": "AUL-MCP-Server" },
              params: gcParams(tokenGt),
            });
          }
        }
        gtOk = r.status === 200 || r.status === 201;
      }
      break;
    } catch (e) {
      if (attempt === 3) throw new Error(`GitCode 图片上传失败: ${e.message}`);
      await delay(300 * attempt);
    }
  }

  if (!ghOk || !gtOk) {
    throw new Error(`图片上传失败: GitHub=${ghOk}, GitCode=${gtOk}`);
  }

  try {
    await axios.get(
      `https://purge.jsdelivr.net/gh/${OWNER}/${repo}@${BRANCH}/${fileName}`
    );
  } catch {}
  return true;
}

// ========== 6. 发布游戏资源到 Releases ==========
async function releaseGameAsset(
  tokenGh,
  tokenGt,
  repo,
  version,
  gameId,
  filePath,
  uploadTarget = "both"
) {
  const ext = repoAssetExt(repo);
  const filename = `${gameId}.${ext}`;
  const data = await fs.readFile(filePath);
  const target = uploadTarget.toLowerCase();
  const doGh = target === "github" || target === "both";
  const doGt = target === "gitcode" || target === "both";
  if (!doGh && !doGt) throw new Error("upload_target 必须是 github/gitcode/both");

  const tasks = [];
  const client = axios.create();

  if (doGh) {
    tasks.push((async () => {
      const tag = `v${version}`;
      const infoUrl = `${GH_API}/${OWNER}/${repo}/releases/tags/${tag}`;
      const info = await client.get(infoUrl, { headers: ghHeaders(tokenGh) });
      if (info.status !== 200) throw new Error(`GitHub Release ${tag} 不存在`);
      const releaseId = info.data.id;

      // 删除已有同名资产
      for (const a of info.data.assets || []) {
        if (a.name === filename) {
          await client.delete(
            `${GH_API}/${OWNER}/${repo}/releases/assets/${a.id}`,
            { headers: ghHeaders(tokenGh) }
          );
        }
      }

      // 上传
      const up = await client.post(
        `https://uploads.github.com/repos/${OWNER}/${repo}/releases/${releaseId}/assets`,
        data,
        {
          headers: {
            ...ghHeaders(tokenGh),
            "Content-Type": "application/octet-stream",
          },
          params: { name: filename },
        }
      );
      if (up.status !== 201) throw new Error(`GitHub 上传返回 ${up.status}`);
    })());
  }

  if (doGt) {
    tasks.push((async () => {
      const tag = `v${version}`;
      const infoUrl = `${GC_API}/${OWNER_GT}/${repo}/releases/${tag}/upload_url`;
      const info = await client.get(infoUrl, {
        headers: { "User-Agent": "AUL-MCP-Server" },
        params: gcParams(tokenGt, { file_name: filename }),
      });
      if (info.status !== 200) throw new Error(`GitCode Release ${tag} 获取失败`);
      const { url, headers } = info.data;
      const h = {};
      for (const [k, v] of Object.entries(headers || {})) h[k] = v;
      const up = await client.put(url, data, { headers: h });
      if (up.status !== 200) throw new Error(`GitCode 上传返回 ${up.status}`);
    })());
  }

  const results = await Promise.allSettled(tasks);
  const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason);
  if (errors.length) {
    throw new Error(errors.map((e) => e.message || String(e)).join(" | "));
  }
  return true;
}

// ========== 7. 添加游戏条目到 config ==========
function addGameEntry(configObj, gameData) {
  if (!gameData.id) throw new Error("缺少游戏 id");
  if (!/^[A-Za-z0-9_]+$/.test(gameData.id))
    throw new Error("游戏 id 只能包含字母、数字、下划线");
  if (!gameData.name?.zh || !gameData.name?.en)
    throw new Error("缺少游戏中英文名称");
  if (!gameData.author?.zh || !gameData.author?.en)
    throw new Error("缺少作者中英文名称");
  if (!gameData.engine) throw new Error("缺少引擎信息");
  if (!["0.0.1", "0.0.2"].includes(gameData.version))
    throw new Error("version 只能是 0.0.1 或 0.0.2");
  const hs = Number(gameData.hot_score ?? 0);
  if (!Number.isInteger(hs) || hs < 0)
    throw new Error("hot_score 必须是 >=0 的整数");

  if (!Array.isArray(configObj.games)) configObj.games = [];
  if (configObj.games.some((g) => g.id === gameData.id)) {
    throw new Error(`id ${gameData.id} 已存在`);
  }
  const entry = {
    id: gameData.id,
    name: { zh: gameData.name.zh, en: gameData.name.en },
    author: { zh: gameData.author.zh, en: gameData.author.en },
    engine: gameData.engine,
    version: gameData.version,
    hot_score: hs,
    publish_time: gameData.publish_time || new Date().toISOString(),
  };
  configObj.games.push(entry);
  return entry;
}

// ========== MCP 工具列表描述 ==========
const TOOLS = [
  {
    name: "check_tokens",
    description:
      "验证 GitHub 和 GitCode 的访问 Token 是否有效。这是所有上传操作的前置检查。",
    inputSchema: {
      type: "object",
      properties: {
        token_gh: {
          type: "string",
          description: "GitHub Personal Access Token",
        },
        token_gt: {
          type: "string",
          description: "GitCode Access Token",
        },
      },
      required: ["token_gh", "token_gt"],
    },
  },
  {
    name: "get_config",
    description:
      "获取指定游戏库（桌面/移动）的配置文件 config.json，返回 games 列表以及配置 sha。",
    inputSchema: {
      type: "object",
      properties: {
        token_gh: { type: "string", description: "GitHub Token" },
        token_gt: { type: "string", description: "GitCode Token" },
        library: {
          type: "string",
          enum: ["desktop", "mobile"],
          description: "目标游戏库：desktop=电脑端(.7z)，mobile=手机端(.apk)",
          default: "desktop",
        },
      },
      required: ["token_gh", "token_gt", "library"],
    },
  },
  {
    name: "upload_cover_image",
    description:
      "上传或更新游戏封面图片到 data 分支。自动缩放（最大 640x480）并转换为 WebP 格式。图片在两个仓库同步。",
    inputSchema: {
      type: "object",
      properties: {
        token_gh: { type: "string", description: "GitHub Token" },
        token_gt: { type: "string", description: "GitCode Token" },
        library: {
          type: "string",
          enum: ["desktop", "mobile"],
          description: "目标游戏库",
          default: "desktop",
        },
        image_path: {
          type: "string",
          description: "本地图片文件的绝对路径（支持 webp/png/jpg 等格式）",
        },
        game_id: {
          type: "string",
          description: "游戏唯一 ID（只允许字母数字下划线）",
        },
      },
      required: ["token_gh", "token_gt", "library", "image_path", "game_id"],
    },
  },
  {
    name: "release_game_asset",
    description:
      "发布游戏安装包到 GitHub/GitCode Release。需要对应的 Release tag（v{version}）预先存在。",
    inputSchema: {
      type: "object",
      properties: {
        token_gh: { type: "string", description: "GitHub Token" },
        token_gt: { type: "string", description: "GitCode Token" },
        library: {
          type: "string",
          enum: ["desktop", "mobile"],
          description: "目标游戏库（决定文件扩展名 .7z/.apk）",
          default: "desktop",
        },
        version: {
          type: "string",
          enum: ["0.0.1", "0.0.2"],
          description: "游戏版本号，将使用 Release tag v{version}",
        },
        game_id: {
          type: "string",
          description: "游戏 ID，资源文件命名为 {game_id}.{ext}",
        },
        file_path: {
          type: "string",
          description: "本地安装包的绝对路径（.7z 或 .apk）",
        },
        upload_target: {
          type: "string",
          enum: ["github", "gitcode", "both"],
          description: "上传目标平台",
          default: "both",
        },
      },
      required: [
        "token_gh",
        "token_gt",
        "library",
        "version",
        "game_id",
        "file_path",
      ],
    },
  },
  {
    name: "add_game_entry",
    description:
      "向 config.json 中添加一个游戏条目并推送回双仓库。会自动写入 publish_time。",
    inputSchema: {
      type: "object",
      properties: {
        token_gh: { type: "string", description: "GitHub Token" },
        token_gt: { type: "string", description: "GitCode Token" },
        library: {
          type: "string",
          enum: ["desktop", "mobile"],
          description: "目标游戏库",
          default: "desktop",
        },
        sha_gh: {
          type: "string",
          description: "当前 config 在 GitHub 的 sha（通过 get_config 获取）",
        },
        sha_gt: {
          type: "string",
          description: "当前 config 在 GitCode 的 sha（通过 get_config 获取）",
        },
        config: {
          type: "object",
          description: "当前完整的 config 对象（通过 get_config 获取）",
        },
        game: {
          type: "object",
          description: "游戏数据",
          properties: {
            id: { type: "string", description: "游戏唯一 ID" },
            name: {
              type: "object",
              properties: {
                zh: { type: "string" },
                en: { type: "string" },
              },
              required: ["zh", "en"],
            },
            author: {
              type: "object",
              properties: {
                zh: { type: "string" },
                en: { type: "string" },
              },
              required: ["zh", "en"],
            },
            engine: { type: "string", description: "游戏引擎，如 Unity/GMS2" },
            version: {
              type: "string",
              enum: ["0.0.1", "0.0.2"],
            },
            hot_score: {
              type: "integer",
              minimum: 0,
              description: "热度分数，>=0 整数",
              default: 0,
            },
            publish_time: {
              type: "string",
              description: "发布时间 ISO 字符串，可选，默认当前时间",
            },
          },
          required: ["id", "name", "author", "engine", "version"],
        },
      },
      required: [
        "token_gh",
        "token_gt",
        "library",
        "sha_gh",
        "sha_gt",
        "config",
        "game",
      ],
    },
  },
  {
    name: "full_upload_game",
    description:
      "一键完整上传游戏：1)验证Token 2)获取配置 3)添加游戏条目 4)上传封面 5)发布Release。最常用的完整流程。",
    inputSchema: {
      type: "object",
      properties: {
        token_gh: { type: "string", description: "GitHub Token" },
        token_gt: { type: "string", description: "GitCode Token" },
        library: {
          type: "string",
          enum: ["desktop", "mobile"],
          description: "目标游戏库",
          default: "desktop",
        },
        image_path: {
          type: "string",
          description: "本地封面图片绝对路径",
        },
        file_path: {
          type: "string",
          description: "本地游戏安装包绝对路径（.7z/.apk）",
        },
        game: {
          type: "object",
          description: "游戏元数据",
          properties: {
            id: { type: "string", description: "唯一 ID" },
            name: {
              type: "object",
              properties: { zh: { type: "string" }, en: { type: "string" } },
              required: ["zh", "en"],
            },
            author: {
              type: "object",
              properties: { zh: { type: "string" }, en: { type: "string" } },
              required: ["zh", "en"],
            },
            engine: { type: "string" },
            version: { type: "string", enum: ["0.0.1", "0.0.2"] },
            hot_score: { type: "integer", minimum: 0, default: 0 },
          },
          required: ["id", "name", "author", "engine", "version"],
        },
        upload_target: {
          type: "string",
          enum: ["github", "gitcode", "both"],
          default: "both",
        },
      },
      required: [
        "token_gh",
        "token_gt",
        "library",
        "image_path",
        "file_path",
        "game",
      ],
    },
  },
  {
    name: "get_apk_id",
    description:
      "解析 APK 文件的包名（package name），并将包名中的点号 '.' 替换为下划线 '_'，生成符合 AUL 规则的游戏 ID。用于移动端（library=mobile）游戏上传前的 ID 自动生成。",
    inputSchema: {
      type: "object",
      properties: {
        apk_path: {
          type: "string",
          description: "本地 APK 文件的绝对路径",
        },
      },
      required: ["apk_path"],
    },
  },
  {
    name: "get_cover_image",
    description:
      "从远程游戏库下载指定游戏的封面图片（{game_id}.webp）。优先走 jsDelivr CDN，失败时回退到 GitHub Contents API。写入本地文件后返回路径与大小。",
    inputSchema: {
      type: "object",
      properties: {
        library: {
          type: "string",
          enum: ["desktop", "mobile"],
          description: "目标游戏库",
          default: "desktop",
        },
        game_id: {
          type: "string",
          description: "游戏 ID（与封面文件名 {game_id}.webp 对应）",
        },
        output_path: {
          type: "string",
          description: "可选，保存到的本地绝对路径。未提供时写入系统临时目录并返回路径。",
        },
        use_cdn: {
          type: "boolean",
          description: "是否优先使用 jsDelivr CDN 下载（更快，无需 Token）",
          default: true,
        },
        token_gh: {
          type: "string",
          description: "GitHub Token，仅在 CDN 失败回退到 GitHub API 时才需要；一般可留空。",
        },
      },
      required: ["library", "game_id"],
    },
  },
];

// ========== 工具实现路由 ==========
async function handleCall(name, args) {
  switch (name) {
    case "check_tokens": {
      const ok = await checkTokens(args.token_gh, args.token_gt);
      return { ok, message: ok ? "Token 验证通过" : "Token 验证失败" };
    }
    case "get_config": {
      const repo = REPOS[args.library] || REPOS.desktop;
      const { sha_gh, sha_gt, config } = await getRepoConfig(
        args.token_gh,
        args.token_gt,
        repo
      );
      return {
        sha_gh,
        sha_gt,
        game_count: config.games?.length ?? 0,
        games: (config.games || []).map((g) => ({
          id: g.id,
          name_zh: g.name?.zh,
          name_en: g.name?.en,
          engine: g.engine,
          version: g.version,
          hot_score: g.hot_score,
        })),
        raw_config: config,
      };
    }
    case "upload_cover_image": {
      const repo = REPOS[args.library] || REPOS.desktop;
      await uploadCoverImage(
        args.token_gh,
        args.token_gt,
        repo,
        args.image_path,
        args.game_id
      );
      return { ok: true, file: `${args.game_id}.webp`, library: args.library };
    }
    case "release_game_asset": {
      const repo = REPOS[args.library] || REPOS.desktop;
      await releaseGameAsset(
        args.token_gh,
        args.token_gt,
        repo,
        args.version,
        args.game_id,
        args.file_path,
        args.upload_target || "both"
      );
      return {
        ok: true,
        version: args.version,
        target: args.upload_target || "both",
        file: `${args.game_id}.${repoAssetExt(repo)}`,
      };
    }
    case "add_game_entry": {
      const repo = REPOS[args.library] || REPOS.desktop;
      const newConfig = JSON.parse(JSON.stringify(args.config)); // 深拷贝
      const entry = addGameEntry(newConfig, args.game);
      await updateRepoConfig(
        args.token_gh,
        args.token_gt,
        repo,
        newConfig,
        args.sha_gh,
        args.sha_gt
      );
      return { ok: true, added_entry: entry };
    }
    case "full_upload_game": {
      const repo = REPOS[args.library] || REPOS.desktop;
      const steps = [];
      // 1
      const tok = await checkTokens(args.token_gh, args.token_gt);
      if (!tok) throw new Error("Token 验证失败");
      steps.push("1. Token 验证通过");

      // 2
      const { sha_gh, sha_gt, config } = await getRepoConfig(
        args.token_gh,
        args.token_gt,
        repo
      );
      steps.push(`2. 获取配置成功 (当前游戏 ${config.games?.length ?? 0} 个)`);

      // 3
      const newConfig = JSON.parse(JSON.stringify(config));
      const entry = addGameEntry(newConfig, args.game);
      await updateRepoConfig(
        args.token_gh,
        args.token_gt,
        repo,
        newConfig,
        sha_gh,
        sha_gt
      );
      steps.push(`3. 添加游戏条目成功: ${entry.id}`);

      // 4
      await uploadCoverImage(
        args.token_gh,
        args.token_gt,
        repo,
        args.image_path,
        args.game.id
      );
      steps.push(`4. 封面上传成功: ${args.game.id}.webp`);

      // 5
      await releaseGameAsset(
        args.token_gh,
        args.token_gt,
        repo,
        args.game.version,
        args.game.id,
        args.file_path,
        args.upload_target || "both"
      );
      steps.push(
        `5. Release 发布成功: ${args.game.id}.${repoAssetExt(repo)} @ v${args.game.version}`
      );

      return { ok: true, steps, game_id: args.game.id };
    }
    case "get_apk_id": {
      if (!args.apk_path) throw new Error("缺少 apk_path 参数");
      const ext = path.extname(args.apk_path).toLowerCase();
      if (ext !== ".apk") throw new Error("文件不是 .apk 格式");
      const apk = new APK(args.apk_path);
      const manifest = apk.getManifestInfo();
      if (!manifest?.package) throw new Error("APK 中未找到包名");
      const packageName = manifest.package;
      const id = packageName.replace(/\./g, "_");
      return {
        ok: true,
        package_name: packageName,
        game_id: id,
        version_name: manifest.versionName || null,
        version_code: manifest.versionCode || null,
      };
    }
    case "get_cover_image": {
      const repo = REPOS[args.library] || REPOS.desktop;
      const fileName = `${args.game_id}.webp`;
      let savedPath = args.output_path;
      if (!savedPath) {
        savedPath = path.join(
          os.tmpdir(),
          `aul_cover_${args.game_id}_${Date.now()}.webp`
        );
      }

      const cdnUrl = `https://cdn.jsdelivr.net/gh/${OWNER}/${repo}@${BRANCH}/${fileName}`;
      const ghUrl = `${GH_API}/${OWNER}/${repo}/contents/${fileName}`;
      const errors = [];
      let source = "";
      let dataBuf = null;
      let finalUrl = "";

      // 1. jsDelivr CDN
      if (args.use_cdn !== false) {
        try {
          const r = await axios.get(cdnUrl, {
            responseType: "arraybuffer",
            timeout: 15000,
            validateStatus: (s) => s === 200,
          });
          dataBuf = Buffer.from(r.data);
          source = "jsdelivr";
          finalUrl = cdnUrl;
        } catch (e) {
          errors.push(`jsDelivr: ${e.message || String(e)}`);
        }
      }

      // 2. fallback: GitHub Contents API
      if (!dataBuf) {
        try {
          const headers = { "User-Agent": "AUL-MCP-Server" };
          if (args.token_gh) headers.Authorization = `Bearer ${args.token_gh}`;
          const r = await axios.get(ghUrl, {
            headers,
            params: { ref: BRANCH },
            timeout: 15000,
            validateStatus: (s) => s === 200,
          });
          const rawContent = (r.data?.content || "").replace(/\n/g, "");
          if (!rawContent) throw new Error("响应中无 content 字段");
          dataBuf = Buffer.from(rawContent, "base64");
          source = "github";
          finalUrl = ghUrl;
        } catch (e) {
          errors.push(`GitHub: ${e.message || String(e)}`);
        }
      }

      if (!dataBuf) {
        throw new Error(
          `封面下载失败 (${errors.join(" | ") || "未知原因"})`
        );
      }

      const dir = path.dirname(savedPath);
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(savedPath, dataBuf);

      return {
        ok: true,
        game_id: args.game_id,
        library: args.library,
        source,
        source_url: finalUrl,
        saved_path: savedPath,
        size_bytes: dataBuf.length,
      };
    }
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

// ========== MCP 服务器启动 ==========
const server = new Server(
  {
    name: "aul-repo-manager-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await handleCall(name, args || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `错误: ${err.message || String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

// ========== CLI 模式支持（--cli <tool> <json>） ==========
async function cliMain() {
  const args = process.argv.slice(2);
  if (args[0] !== "--cli") return false;
  const tool = args[1];
  if (!tool) {
    console.error("Usage: node index.js --cli <toolName> <jsonArgs>");
    console.error("Available tools:");
    for (const t of TOOLS) console.error("  - " + t.name);
    process.exit(1);
  }
  let inputArgs = {};
  if (args[2]) {
    try {
      let raw = args[2];
      if (raw.startsWith("@")) {
        const filePath = raw.slice(1);
        raw = (await fs.readFile(filePath)).toString("utf8");
      }
      inputArgs = JSON.parse(raw);
    } catch (e) {
      process.stdout.write(JSON.stringify({ error: "JSON 参数解析失败: " + e.message }, null, 2));
      process.stdout.write("\n");
      process.exit(1);
    }
  }
  try {
    const r = await handleCall(tool, inputArgs);
    process.stdout.write(JSON.stringify(r, null, 2));
    process.stdout.write("\n");
    process.exit(0);
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message || String(e) }, null, 2));
    process.stdout.write("\n");
    process.exit(2);
  }
}

async function main() {
  const ran = await cliMain();
  if (ran === false) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((err) => {
  console.error("MCP 服务器启动失败:", err);
  process.exit(1);
});
