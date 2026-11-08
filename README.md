# Songhearth

本地 AI 音乐生成桌面客户端（macOS）。基于 [Tauri 2](https://tauri.app) + [audio.cpp](https://github.com/0xShug0/audio.cpp)，在 Apple Silicon 的 Metal GPU 上离线运行开源音乐模型，并提供本地 HTTP API 与 Agent Skill，方便其他 Agent 调用。

## 功能

- **开始创作**：风格描述 + 歌词编辑（段落标记一键插入）、人声 / 纯音乐切换、模型选择（质量、速度、许可一目了然）、时长、种子锁定、高级选项（YuE2 乐谱规划、采样步数、反向提示词）。`⌘↩` 生成，草稿自动保存。
- **队列**：任务按提交顺序依次执行，实时显示阶段、进度与剩余时间，可随时取消；后台完成时发送系统通知。
- **我的作品**：波形试听、点击波形跳转、收藏、重命名、搜索、复用参数、换种子再来一版、导出、在 Finder 中显示；失败任务显示 audio.cpp 的错误并可一键重试。
- **模型管理**：并行分段下载、断点续传、暂停/继续、镜像源（hf-mirror）、删除；根据本机内存提示是否吃紧。
- **接口与 Skill**：REST API 默认对局域网开放、无需 Token（可在界面里关闭局域网访问或开启 Token），发现文件自动写入；一键把 Skill 安装到 Claude Code / Codex / 任意目录。

## 支持的模型

| id | 模型 | 人声 | 许可 | 体积 |
|---|---|---|---|---|
| `yue2-3b` | YuE2 3B（Q4） | ✓（歌词可空 → 纯音乐） | CC BY-NC 4.0，仅非商用 | 2.9 GB |
| `ace-step-1.5-turbo` | ACE-Step 1.5 Turbo（BF16） | ✓ | MIT，可商用 | 10.1 GB |
| `minimax-music-3` | MiniMax Music 3（Q4/Q8 组合） | ✓（必须有歌词） | 社区许可，有条件商用 | 8.5 GB |
| `stable-audio-3-medium` | Stable Audio 3 Medium（Q8） | ✗ 纯音乐 | Stability 社区许可 | 3.6 GB |
| `stable-audio-3-small` | Stable Audio 3 Small Music（Q8） | ✗ 纯音乐 | Stability 社区许可 | 1.7 GB |

模型文件来自 Hugging Face 上 audio.cpp 官方 GGUF 包，默认存放在 `~/Library/Application Support/com.songhearth.app/models`（可在设置中改为已有的 audio.cpp `models` 目录）。作品默认保存到 `~/Music/Songhearth`。

## 开发

需要 Node 20+、Rust（stable）、Xcode 命令行工具。

```bash
npm install
npm run fetch-engine        # 下载 audio.cpp v0.9.4 macOS 预编译包到 src-tauri/resources/engine（打包进 .app）
npx tauri dev               # 开发
npx tauri build             # 产出 .app / .dmg
```

引擎查找顺序：设置中的自定义路径 → 应用内置（`resources/engine`）→ 应用自动下载（`~/Library/Application Support/com.songhearth.app/engine/current`）→ `/opt/homebrew/bin`、`/usr/local/bin`。未找到时，首次启动会引导下载（约 35 MB）。

Rust 单元测试：`cd src-tauri && cargo test --lib`。

## 多语言（i18n）

界面使用 [i18next](https://www.i18next.com) + react-i18next，目前支持 English（`en`，源语言）和简体中文（`zh-CN`）。设置 → 语言可选“跟随系统”或指定语言，首次启动按系统语言匹配。

```
src/i18n/
  index.ts              初始化、语言发现、系统语言匹配
  translate.ts          translateError / translateStage（后端消息翻译）
  catalog.ts            模型文案翻译（按模型 id）
  resources.d.ts        翻译键的类型声明（以 en 为准，写错键会在 tsc 报错）
  locales/<语言代码>/   common · shell · create · library · models · catalog · api · settings · errors · stages
```

**新增一种语言**（例如日语 `ja`）：

1. 复制 `src/i18n/locales/en` 为 `src/i18n/locales/ja`，逐个翻译 JSON 值（保留 `{{变量}}` 与 `_one/_other` 复数后缀按该语言的复数规则调整）。
2. 在 `ja/common.json` 里把 `meta.name` 改成该语言自己的名字（如“日本語”）——它会自动出现在设置的语言列表里。
3. 运行 `npm run i18n:check`：校验各语言文件齐全、键一致、占位符一致。`npm run build` 会先执行该检查。

无需改任何代码：语言通过 `import.meta.glob` 自动发现。后端不产出界面文案，只返回稳定的错误码 + 参数（`errors:<code>`）和阶段码（`stages:<code>`）；HTTP 接口里的 `message` 保持英文，方便 Agent 读取。

## 架构

```
src/                      React + TypeScript 界面（macOS 液态玻璃风格，跟随系统强调色与深浅色）
src-tauri/src/
  core.rs                 共享状态、持久化（settings/jobs/perf.json）、事件推送
  catalog.rs              模型目录（文件、参数范围、许可、推荐用途）
  engine.rs               audio.cpp 定位 / 下载安装
  models.rs               模型下载：8 路分段并行、.part + 状态文件断点续传
  jobs.rs                 任务校验、自动选模型、队列操作
  runner.rs               逐个执行 audiocpp_cli，解析日志得到阶段/进度/ETA，可取消
  api.rs                  axum HTTP API + api.json 发现文件
  commands.rs             Tauri 命令（UI 调用）
skills/songhearth/        Agent Skill：SKILL.md、零依赖 Python 客户端、API 文档
```

每个任务启动一次 `audiocpp_cli`（`--backend metal`），因此取消即终止进程、崩溃不会影响应用；代价是每次约 5–10 秒的模型加载。ETA 先按内置经验值估算，每完成一首后按实测速度自动校准。

## HTTP API 与 Skill

API 默认监听 `0.0.0.0:17865`：本机用 `http://127.0.0.1:17865`，局域网内其他设备用本机 IP（界面“接口与 Skill”页会显示）。默认不要求 Token；开启后需带 Bearer Token。地址与 Token 写入 `~/Library/Application Support/com.songhearth.app/api.json`（权限 0600）。完整接口见 [skills/songhearth/reference/api.md](skills/songhearth/reference/api.md)。

```bash
python3 skills/songhearth/scripts/songhearth.py status
python3 skills/songhearth/scripts/songhearth.py generate \
  --prompt "Mandarin, indie pop, warm acoustic guitar, female vocal" \
  --lyrics-file lyrics.txt --title "夏夜" --out ./xiaye.wav
```

客户端会自动读取发现文件；应用未运行时会尝试用 `open -b com.songhearth.app` 启动它。
