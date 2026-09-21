# Chat2Pi

**Chat with Pi Tools — 一个 ChatGPT 插件，访问自己的多台电脑。**

TypeScript 实现，使用 Cloudflare Worker + Durable Object 作为云端入口。每台电脑主动建立 WSS 443 连接；ChatGPT 先调用 list_devices，再用 device_id 指定执行电脑。Pi 在目标电脑本地运行。

```text
ChatGPT（OAuth / MCP，一份工具清单）
             │ HTTPS
       Cloudflare Worker
             │
       Durable Object
        ├── WSS 443 ← Mac → 本地 Pi 工具
        └── WSS 443 ← Windows / Linux → 本地 Pi 工具
```

不需要常在线的主电脑，也不需要给每台电脑部署隧道或重复添加插件。某台电脑关机只影响它自己。自定义域名可选。

## 安装和部署

完整步骤见 [云端部署与多电脑指南](docs/CLOUD.md)，包含首次部署、ChatGPT 授权、Windows 配置和新增设备。Node.js 需要 22 或以上版本；若 Pi 自身要求更高版本，以安装提示为准。

**Pi 版本不做限制**，依赖范围为 `*`；升级后按实际接口修复。工具依赖会随 npm 包安装，不必单独部署 Pi CLI，也不需要 LLM API key。

本地开发：

```sh
npm install
npm run build
npm test
```

设备连接（JSON 中包含专属凭证、目标电脑代号和工具权限）：

```sh
node build/cli.js agent --config /path/to/device.json
```

macOS / Linux 后台运行使用 `agent-start` / `agent-stop` / `agent-restart` / `agent-status`，指定同一配置文件。Windows 使用前台 agent 或系统服务管理器。后台启动尚不包含开机自启。

这是个人所有者的工具服务，不是多人共享账号系统。每位其他用户应部署自己的云端入口。家人共用电脑时可以采用默认的工作目录只读权限；开启 unrestricted 后相当于允许当前系统用户执行命令，不能把目录设置当作强沙箱。

旧的本机网关 + Cloudflare Tunnel 路径保留作备选，文档见 [旧隧道部署](docs/LEGACY-TUNNEL.md)。本机当前网络下旧隧道连接失败，新的 WSS 443 路径已实际验证。

## 工具

| 工具 | 参数要点 | 作用 |
|---|---|---|
| `list_devices` | 无 | 返回在线数量、设备 ID、状态、可用工具和远端 Pi 版本 |
| `read` | `device_id`, `path` | 读取文件 |
| `write` | `device_id`, `path`, `content` | 写入文件 |
| `edit` | `device_id` 及当前 Pi 编辑参数 | 精确编辑 |
| `ls` | `device_id`, 可选 `path` | 列出目录 |
| `find` | `device_id`, `pattern` | 查找文件 |
| `grep` | `device_id`, `pattern` | 搜索内容 |
| `bash` | `device_id`, `command` | 执行命令 |

其余参数直接使用已安装 Pi SDK 的实际 schema。所有设备共用一份工具清单；网关和各设备应使用兼容的 Pi 工具参数，新版参数不兼容时会报错，不做静默转换。

在线列表在查询时生成，不把设备 ID 写成工具 schema 枚举。增加设备后不用刷新工具定义。`device_id` 缺失、目标离线、工具不被允许时直接拒绝，不自动改用另一台电脑。

## 边界与可靠性

- `/mcp` 必须持有效 OAuth access token；个人授权密钥不直接作为 MCP bearer token 使用。
- 设备连接密钥只允许连接已绑定的设备 ID，不能当作 ChatGPT 的访问令牌。
- 每台电脑同一时刻执行一个调用；繁忙时返回错误。超时、断线可能发生在操作已生效之后，所以不自动重试。
- 本地操作由独立 Node 子进程执行。macOS/Linux 超时会终止进程组；Windows 的进程树清理能力有限，不应把它视为强沙箱。
- `workspace` 模式检查文件路径和已有符号链接，并禁止 `bash`。这是基本防误操作措施，不是对抗恶意本地程序的文件系统沙箱；需要强隔离时用独立系统用户或容器。
- `unrestricted` 模式可执行任意已授权命令、访问当前系统用户可访问的路径。配置工作目录不是隔离限制。
- 直接使用 Pi 的内置工具工厂，不加载 Pi 的扩展、提示词或模型会话；本项目不替 ChatGPT 进行第二次模型推理。
- 默认不记录调用参数、文件内容或凭证。云端 OAuth 状态保存在 Cloudflare KV，电脑重启不影响云端授权；授权撤销和设备管理见云端指南。

## 开发验证

```sh
npm run build
npm test
```

测试覆盖真实 OAuth 授权与 PKCE、未授权拒绝、两个模拟设备的路由、设备离线、工具权限交集、路径越界、符号链接、实际 Pi 文件工具及命令超时恢复。测试使用临时工作目录，不操作用户项目文件。
