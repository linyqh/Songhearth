<div align="center">

<img src="src-tauri/icons/icon.png" width="112" alt="Songhearth logo" />

# Songhearth

**本地运行的 AI 音乐生成桌面客户端**

在自己的 GPU 上离线运行开源音乐模型（Apple Silicon 的 Metal，或 Windows 上的 Vulkan），无需云端、无需订阅。<br/>
内置本地 HTTP API 与 Agent Skill，可被 Claude Code / Codex 等 Agent 直接调用。

![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)%20%7C%20Windows%20x64-black?logo=apple)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=black)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## 目录

- [特性](#特性)
- [快速开始](#快速开始)
- [支持的模型](#支持的模型)
- [HTTP API 与 Agent Skill](#http-api-与-agent-skill)
- [架构](#架构)
- [多语言（i18n）](#多语言i18n)
- [开发](#开发)
- [致谢](#致谢)

## 特性

- 🎼 **开始创作**：风格描述 + 歌词编辑（段落标记一键插入）、人声 / 纯音乐切换、模型选择（质量、速度、许可一目了然）、时长、种子锁定，以及高级选项（YuE2 乐谱规划、采样步数、反向提示词）。`⌘↩`（Windows 为 `Ctrl+↵`）生成，草稿自动保存。
- ⏳ **任务队列**：按提交顺序依次执行，实时显示阶段、进度与剩余时间，可随时取消；后台完成时发送系统通知。
- 🎧 **我的作品**：波形试听、点击波形跳转、收藏、重命名、搜索、复用参数、换种子再来一版、导出、在 Finder / 资源管理器中显示；失败任务显示 audio.cpp 的错误并可一键重试。
- 📦 **模型管理**：8 路并行分段下载、断点续传、暂停 / 继续、镜像源（hf-mirror）、删除；根据本机内存提示是否吃紧。
- 🤖 **接口与 Skill**：REST API 与发现文件自动生成；一键把 Skill 安装到 Claude Code / Codex / 任意目录。
- 🌍 **多语言**：English / 简体中文，新增语言无需改代码。
- 🎨 **原生观感**：macOS 液态玻璃风格，跟随系统强调色与深浅色；Windows 使用原生标题栏，同样跟随深浅色。

## 快速开始

> 支持 **macOS（Apple Silicon）** 与 **Windows 10/11（x64）**。Windows 使用 audio.cpp 的 Vulkan 构建，NVIDIA、AMD、Intel 显卡均可（需较新的显卡驱动）。

1. 安装并打开应用。首次启动若未找到 audio.cpp 引擎，会引导下载（约 35–85 MB）。
2. 在「模型」页下载一个模型（`yue2-3b` 仅 2.9 GB，适合上手）。
3. 在「开始创作」输入风格描述和歌词，按 `⌘↩`（Windows 为 `Ctrl+↵`）生成。

模型默认存放在应用数据目录（macOS：`~/Library/Application Support/com.songhearth.app/models`，Windows：`%LOCALAPPDATA%\com.songhearth.app\models`；可在设置中改为已有的 audio.cpp `models` 目录），作品默认保存到用户目录下的 `Music/Songhearth`。

从源码构建见 [开发](#开发)。

## 支持的模型

模型文件来自 Hugging Face 上 audio.cpp 官方 GGUF 包。**使用前请确认各模型许可是否满足你的用途。**

| id | 模型 | 人声 | 许可 | 体积 |
|---|---|---|---|---|
| `yue2-3b` | YuE2 3B（Q4） | ✓（歌词可空 → 纯音乐） | CC BY-NC 4.0，仅非商用 | 2.9 GB |
| `ace-step-1.5-turbo` | ACE-Step 1.5 Turbo（BF16） | ✓ | MIT，可商用 | 10.1 GB |
| `minimax-music-3` | MiniMax Music 3（Q4/Q8 组合） | ✓（必须有歌词） | 社区许可，有条件商用 | 8.5 GB |
| `stable-audio-3-medium` | Stable Audio 3 Medium（Q8） | ✗ 纯音乐 | Stability 社区许可 | 3.6 GB |
| `stable-audio-3-small` | Stable Audio 3 Small Music（Q8） | ✗ 纯音乐 | Stability 社区许可 | 1.7 GB |

## HTTP API 与 Agent Skill

API 默认监听 `0.0.0.0:17865`：本机用 `http://127.0.0.1:17865`，局域网设备用本机 IP（界面「接口与 Skill」页会显示）。

> ⚠️ 默认**对局域网开放且不要求 Token**。在不受信任的网络中，请在界面里关闭局域网访问或开启 Bearer Token。

地址与 Token 写入应用数据目录下的 `api.json`（macOS：`~/Library/Application Support/com.songhearth.app/`，Windows：`%LOCALAPPDATA%\com.songhearth.app\`）。完整接口见 [skills/songhearth/reference/api.md](skills/songhearth/reference/api.md)。

```bash
python3 skills/songhearth/scripts/songhearth.py status
python3 skills/songhearth/scripts/songhearth.py generate \
  --prompt "Mandarin, indie pop, warm acoustic guitar, female vocal" \
  --lyrics-file lyrics.txt --title "夏夜" --out ./xiaye.wav
```

客户端零依赖，自动读取发现文件；应用未运行时会尝试启动它（macOS 用 `open -b com.songhearth.app`，Windows 用 `%LOCALAPPDATA%\Songhearth` 下的当前用户安装）。

## 架构

```
src/                      React + TypeScript 界面
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

每个任务启动一次 `audiocpp_cli`（macOS 用 `--backend metal`，Windows 用 `vulkan`），因此取消即终止进程、崩溃不会影响应用；代价是每次约 5–10 秒的模型加载。ETA 先按内置经验值估算，每完成一首后按实测速度自动校准。

引擎查找顺序：设置中的自定义路径 → 应用内置（`resources/engine`）→ 应用自动下载（`<应用数据目录>/engine/current`）→ `/opt/homebrew/bin`、`/usr/local/bin`（仅 macOS）。

## 多语言（i18n）

界面使用 [i18next](https://www.i18next.com) + react-i18next，目前支持 English（`en`，源语言）和简体中文（`zh-CN`）。设置 → 语言可选「跟随系统」或指定语言。

<details>
<summary><b>新增一种语言（例如日语 <code>ja</code>）</b></summary>

```
src/i18n/
  index.ts              初始化、语言发现、系统语言匹配
  translate.ts          translateError / translateStage（后端消息翻译）
  catalog.ts            模型文案翻译（按模型 id）
  resources.d.ts        翻译键的类型声明（以 en 为准，写错键会在 tsc 报错）
  locales/<语言代码>/   common · shell · create · library · models · catalog · api · settings · errors · stages
```

1. 复制 `src/i18n/locales/en` 为 `src/i18n/locales/ja`，逐个翻译 JSON 值（保留 `{{变量}}`，`_one/_other` 复数后缀按该语言的复数规则调整）。
2. 在 `ja/common.json` 里把 `meta.name` 改成该语言自己的名字（如「日本語」）——它会自动出现在设置的语言列表里。
3. 运行 `npm run i18n:check`：校验各语言文件齐全、键一致、占位符一致。`npm run build` 会先执行该检查。

无需改任何代码：语言通过 `import.meta.glob` 自动发现。后端不产出界面文案，只返回稳定的错误码 + 参数（`errors:<code>`）和阶段码（`stages:<code>`）；HTTP 接口里的 `message` 保持英文，方便 Agent 读取。

</details>

## 开发

需要 Node 20+、Rust（stable）；macOS 需 Xcode 命令行工具，Windows 需 Visual Studio Build Tools（C++ 桌面开发工作负载）。

```bash
npm install
npm run fetch-engine        # 下载当前系统对应的 audio.cpp 预编译包（macOS Metal / Windows Vulkan portable）到 src-tauri/resources/engine（打包进应用）
npx tauri dev               # 开发
npx tauri build             # macOS：.app / .dmg · Windows：NSIS 安装包（.exe）
```

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run i18n:check` | 校验翻译文件 |
| `cd src-tauri && cargo test --lib` | Rust 单元测试 |

## 发版

- **Windows**：发布（非草稿、非预发布的）GitHub Release 会触发 [`.github/workflows/release-windows.yml`](.github/workflows/release-windows.yml)，在 `windows-latest` 上构建 NSIS 安装包，并把 `*-setup.exe` 附加到该 Release。也可在 *Actions → Release (Windows) → Run workflow* 对已有 tag 手动触发。安装包未签名，首次运行会出现 SmartScreen 提示。
- **macOS**：CI 不构建（macOS runner 费用高）。在本地打 `.dmg` 并上传到同一个 Release：

```bash
npm run fetch-engine
npm run tauri build -- --bundles dmg
gh release upload <tag> src-tauri/target/release/bundle/dmg/*.dmg
```

## 致谢

- [audio.cpp](https://github.com/0xShug0/audio.cpp) —— 推理引擎
- [Tauri](https://tauri.app) —— 桌面应用框架
- YuE、ACE-Step、MiniMax Music、Stable Audio 等开源模型的作者与社区
