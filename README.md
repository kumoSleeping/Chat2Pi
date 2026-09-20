# Chat2Pi

**Chat with Pi Tools — 在 ChatGPT 中使用自己电脑上的 Pi 工具。**

个人自用的 TypeScript 工具桥。ChatGPT 只连接一个 MCP 插件，先查询在线电脑，再用 `device_id` 指定工具在哪台电脑执行。

```text
ChatGPT（一个插件、八个工具）
             │ HTTPS / Streamable HTTP + OAuth
       Cloudflare Tunnel（复用一条隧道）
             │
    Chat2Pi 网关（常在线电脑，127.0.0.1）
        ├── 本机 Pi 工具
        └── 加密 WebSocket ← 其他电脑的 Chat2Pi 客户端
```

当前实现的网关运行在你的电脑上，不是 Cloudflare Worker。网关电脑休眠或关机时，全部远程访问停止。其他电脑主动连接网关，不需要开放入站端口，也不需要安装 cloudflared 或 OpenAI tunnel-client。

## 运行要求

- Node.js 22 或更新版本，以及 npm；Pi 自身可能要求更新的 Node.js，请按安装提示处理。
- 网关电脑安装 cloudflared，有可用的 Cloudflare Tunnel 和域名。
- Pi SDK 作为 npm 依赖安装，不必单独安装 Pi CLI，不需要配置 LLM API key。
- **不限制 Pi 版本。** 依赖范围为 `*`，不比较版本号，不要求元数据快照版本匹配。启动时只检查需要的工具接口，调用时按实际 SDK schema 校验参数。未知未来版本不保证兼容，错误应按实际接口修复。
- `package-lock.json` 记录已验证的依赖集合，供复现；更新 Pi 用 `npm update @earendil-works/pi-coding-agent`，之后重新构建、测试和启动。

## 安装与首次配置

```sh
npm install
npm run build
node build/cli.js init \
  --url https://tools.example.com \
  --id my-mac \
  --workspace /absolute/path/to/workspace \
  --cloudflare /absolute/path/to/cloudflared.yml
```

默认开放 `read`、`ls`、`find`、`grep`，限制在工作目录内。本人使用、需要全部七个 Pi 工具时，添加 `--unrestricted`，表示允许以当前系统用户权限执行命令及访问文件。

初始化在 `.local/` 生成：

- `gateway.json`：网关及设备注册配置。
- `owner-key`：一次性连接授权时填写的个人密钥，保存在本机，不出现在工具结果中。
- `oauth-state.json`：授权成功后保存客户端和令牌状态；令牌以摘要保存。

这些文件不进入 Git 或 npm 安装包。不要公开上传 `.local/`。

将 Cloudflare Tunnel 的域名路由到 `http://127.0.0.1:8787`，参考 `examples/cloudflared.yml`。外部访问必须使用 HTTPS。

```sh
./service.sh start
./service.sh status
./service.sh restart
./service.sh stop
```

`status` 分别检查本地服务和公网入口。只有本地 reachable 不代表隧道已连接；公网返回 HTTP 530 / Cloudflare 1033 时，先检查 cloudflared 日志及本机代理是否允许 Cloudflare Tunnel 的连接。

脚本调用的是 TS 编译后的 Node.js 程序，不依赖 Python。网关一起管理 cloudflared 的启停。也可用 `node build/cli.js run --config /path/gateway.json` 前台运行。

`start/stop/status` 后台管理适用于 macOS/Linux；Windows 用前台 `run`/`agent` 或系统服务管理器。未配置开机自启。

## 在 ChatGPT 连接一次

1. 在有开发者模式权限的账号中新增自定义 MCP 插件/连接器。
2. 使用普通远程 URL 连接：`https://tools.example.com/mcp`，不是 OpenAI Tunnel。
3. 选择 OAuth 认证。服务提供发现元数据、动态客户端注册和 PKCE。
4. 在打开的 Chat2Pi 授权页面中核对客户端和返回地址，输入 `.local/owner-key` 文件中的个人密钥。
5. 保存后工具应为 `list_devices` 加七个 Pi 工具。首次测试：“列出在线电脑，不修改文件。”

这不是浏览器扩展，也没有多用户账号系统。所有授权的 ChatGPT 连接都属于同一位所有者，并能访问其配置的设备。没有公开提交插件商店。ChatGPT 的最终 UI、账号权限和连接验证仍以实际账号为准。

## 添加第二台电脑

在网关电脑注册一个独立代号，工作目录参数填写**目标电脑上的路径**：

```sh
node build/cli.js add-device \
  --id second-computer \
  --workspace /path/on/second/computer \
  --out .local/second-computer.json
./service.sh restart
```

这会生成独立的设备密钥，并登记允许的工具。默认只读。想开放全部工具可加 `--unrestricted`；也可以手动编辑两端的 `tools` 清单，网关与设备取权限交集。

创建便于传输的安装包：

```sh
npm pack
```

把生成的 `chat2pi-*.tgz` 和该设备专属的配置文件传到新电脑，**不要复制整个 `.local/`**。新电脑安装 Node.js 后：

```sh
npm install -g /path/to/chat2pi-0.2.0.tgz
chmod 600 /path/to/second-computer.json  # macOS/Linux
chat2pi agent --config /path/to/second-computer.json
```

安装 npm 包需要联网下载依赖。客户端启动后自动上线，断线自动重连，但不会重放工具调用。不需要在 ChatGPT 添加第二个插件，也不需要再创建隧道。

同一个 `device_id` 只能有一个在线连接，重复连接会被拒绝。移除设备：从网关配置的 `devices` 中删除它，然后重启网关。

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
- 默认不记录调用参数、文件内容或凭证。OAuth 状态保存在本地，重启后授权可继续使用。保留 `owner-key`，删除 OAuth 状态文件并重启可撤销全部现有授权。

## 开发验证

```sh
npm run build
npm test
```

测试覆盖真实 OAuth 授权与 PKCE、未授权拒绝、两个模拟设备的路由、设备离线、工具权限交集、路径越界、符号链接、实际 Pi 文件工具及命令超时恢复。测试使用临时工作目录，不操作用户项目文件。
