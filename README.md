# ymail

## 概览

这是一个 pnpm workspace 仓库，当前只包含一个 Webmail 应用，路径为 `mail-server/apps/webmail`。应用基于 Next.js 15、React 19，作为 Stalwart JMAP 服务前面的 Webmail 界面使用。

本仓库不包含管理员控制台，也不负责 Stalwart 服务本体部署。

## 主要功能

- 邮箱登录与会话管理
- 收件箱、文件夹、线程阅读
- 搜索、基础邮件操作、撰写与回复
- 基于 JMAP 的服务端代理访问
- Playwright 测试模式下的测试会话入口

## 仓库结构

```text
.
├─ package.json                     # workspace 根脚本
├─ pnpm-workspace.yaml             # workspace 定义
├─ playwright.config.ts            # E2E 配置
└─ mail-server/
   └─ apps/
      └─ webmail/                  # 实际 Webmail 应用
         ├─ app/                   # Next.js App Router
         ├─ components/            # UI 组件
         ├─ lib/                   # 认证、JMAP、状态逻辑
         ├─ public/                # 静态资源
         ├─ test/                  # Vitest 单元测试
         └─ tests/e2e/             # Playwright 端到端测试
```

## 环境变量

运行时至少要保证 Webmail 能访问到 Stalwart 服务。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `WEBMAIL_STALWART_BASE_URL` | Webmail 访问的 Stalwart 基地址 | `http://127.0.0.1:8080` |
| `STALWART_BASE_URL` | 兼容回退变量，未设置上项时使用 | 无 |
| `NODE_ENV` | 生产环境下会让认证 Cookie 使用 `secure` | 依运行方式而定 |
| `PLAYWRIGHT_TEST` | 仅测试模式使用，开启测试专用会话与 JMAP mock | 无 |

建议至少在部署环境中设置：

```bash
WEBMAIL_STALWART_BASE_URL=http://127.0.0.1:8080
NODE_ENV=production
```

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

## 本地开发

### 根工作区常用命令

以下命令都在仓库根目录 `D:\21` 执行：

```bash
pnpm test
pnpm build
pnpm exec playwright test
```

- `pnpm test`，运行根级 Vitest 测试
- `pnpm build`，执行 workspace 中 `webmail` 应用构建
- `pnpm exec playwright test`，运行端到端测试

### 应用开发命令

Webmail 包自身提供 `dev`、`build`、`start`、`lint` 脚本。建议仍从仓库根目录通过 filter 调用：

```bash
pnpm --filter webmail dev
pnpm --filter webmail build
pnpm --filter webmail start
pnpm --filter webmail lint
```

本地开发前请先确认 `WEBMAIL_STALWART_BASE_URL` 指向可访问的 Stalwart 实例，否则登录和真实 JMAP 数据请求无法工作。

## 生产构建与启动

推荐流程如下，均在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter webmail start
```

说明：

- `pnpm build` 负责生产构建
- `pnpm --filter webmail start` 启动 Webmail
- 这个 workspace 下更适合从根目录调用 `pnpm --filter webmail ...`，不要把部署说明写成依赖直接进入 `apps/webmail` 后再启动

## 反向代理与域名说明

- 对外只需要暴露 Webmail 的 Next.js 服务
- 上游 Stalwart 服务必须能被 Webmail 进程访问，通常通过内网地址或同机地址配置到 `WEBMAIL_STALWART_BASE_URL`
- 若使用域名，反向代理把 Web 请求转发到 Webmail 进程即可
- 管理后台不在本仓库内，如果需要管理域名或管理入口，需要单独部署 Stalwart 自带或其他独立管理端

## 测试

在仓库根目录执行：

```bash
pnpm test
pnpm exec playwright test
```

其中：

- `pnpm test` 覆盖单元与组件测试
- `pnpm exec playwright test` 会按 `playwright.config.ts` 启动测试服务器，并注入 `PLAYWRIGHT_TEST=1`

## 注意事项

- 运行时依赖可访问的 Stalwart 上游服务，没有这个依赖，Webmail 不能完成真实登录与 JMAP 通信
- `/api/test/session` 仅在 `PLAYWRIGHT_TEST=1` 时可用，用于 Playwright 测试，生产环境不应暴露为业务登录入口
- 本仓库是 Webmail-only，不包含 admin console
- 认证 Cookie 名称为 `webmail_session`，生产环境下会启用 `secure` Cookie
