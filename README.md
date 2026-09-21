# Chat2Pi

**Chat with Pi Tools** — 面向私有部署的 TypeScript 小工具，让 ChatGPT 使用自己多台电脑上的 Pi 工具。

一个云端入口、一份工具清单；账号身份由 OAuth 确定，每份绑定配置只对应 **一个账号 + 一台电脑**。同一台电脑可以绑定多个账号，各用独立凭证。账号和设备记录保存在 Durable Object 数据库中，日常增删无需重新部署 Cloudflare。

```text
ChatGPT ── OAuth / MCP ── Cloudflare Worker
                              ├── 账号、管理员与绑定数据库
                              ├── 账号 A 的连接 ── WSS 443 ── Mac / Windows
                              └── 账号 B 的连接 ── WSS 443 ── Mac / Windows
```

智能体也可以从私密凭证文件直接调用 HTTPS 管理接口和电脑工具，无需经过 ChatGPT；详见 [智能体接入](docs/MANAGEMENT-API.md)。

## 安装客户端

安装 Node.js 22.19 或更新版本，以及 Git，然后：

```sh
npm install -g github:kumoSleeping/Chat2Pi
```

GitHub 安装会构建 TypeScript。Pi SDK 随依赖安装，不需单独安装 Pi CLI、Python、cloudflared 或 OpenAI Tunnel。Pi 依赖为 `*`，没有人为版本限制；未来接口变动按实际问题修复。

在管理工具中绑定电脑，领取凭证下载文件后，在**目标电脑**上执行：

```sh
chat2pi device-import --bundle ./chat2pi-credentials.json --workspace ./PiWorkspace
chat2pi start
chat2pi status
```

先创建工作目录。默认本地只启用工作目录内的只读工具。即使云端允许更多工具，本地仍取权限交集；需要全部已授权工具时，导入时显式加 `--unrestricted`。

所有默认文件集中在用户目录的 `~/.chat2pi`（Windows 为 `%USERPROFILE%\.chat2pi`）：

```text
.chat2pi/
  accounts/   账号登录凭证
  bindings/   每个账号 + 电脑的绑定及私密 .credentials.json
  downloads/  领取的凭证包
  runtime/    后台服务状态、控制凭证和日志
```

```sh
chat2pi start    # 自动启动 bindings 中所有设备连接
chat2pi stop
chat2pi restart --all  # 重新读取所有账号的配置
chat2pi status   # 查看本地进程和已加载绑定
chat2pi manage --action me
```

启停和状态命令默认处理全部已导入绑定，支持显式 `--all`，例如 `chat2pi start --all`、`chat2pi stop --all` 和 `chat2pi status --all`。`--all` 不用于管理权限或执行电脑工具；这些操作仍然选择唯一账号。

`start` 重复运行不会重复启动。新增或修改绑定后运行 `restart`；不自动监视文件变化。`status` 的运行状态不等于云端在线状态，在线设备用 `manage --action list_devices` 查询。后台管理使用经过认证的本机控制接口，适用于 macOS / Linux / Windows，不包含开机自启。

通过 `login-import --bundle login.json` 导入账号凭证；只有一个账号时管理命令自动选择，多个账号用 `--account` 指定，同名账号分属不同服务时再加 `--url`。可用 `--home` 指定独立的配置目录。设备私密文件保留本地权限限制，实际权限仍取云端与本地交集。

Windows 文件工具可以直接运行。使用 Bash 工具需额外安装 Git for Windows，并在私密配置的 `local.shell_path` 指定 Bash 路径。Windows 尚未实机验证。

## 云端与首次管理员

按 [部署说明](docs/CLOUD.md) 部署 Worker、两个 Durable Object 类和 OAuth KV。可使用自己的域名（例如 `chat2pi.kumo.ltd`）或 workers.dev 域名。

部署时设置一次性初始化密钥的摘要。持有密钥才能创建第一个账号，该账号自动成为管理员；初始化完成后入口永久关闭，不因重启或修改密钥重新开放。

```sh
chat2pi bootstrap --url https://YOUR-SERVER --account owner --key-file ~/.chat2pi/deployment/bootstrap-key
```

管理员可以创建账号、授予或撤销管理员权限、停用账号和管理设备。系统不允许停用或降级最后一位有效管理员。

在 ChatGPT 中新增自定义 MCP 插件：URL 为 `https://YOUR-SERVER/mcp`，认证选择 OAuth，客户端注册选择 DCR；授权页填写**服务账号 ID 和该账号登录密钥**。这不是 ChatGPT 账号密码，服务不会取得 OpenAI 的用户身份。

## 工具

| 工具                                                  | 描述                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| `list_devices`                                        | 查询当前账号的设备与在线状态               |
| `read`、`write`、`edit`、`ls`、`find`、`grep`、`bash` | 目标电脑上的 Pi 工具，必须指定 `device_id` |
| `manage`                                              | 管理账号和设备。                           |

`manage` 的动作：`me`、`list_accounts`、`create_account`、`set_role`、`disable_account`、`enable_account`、`list_devices`、`bind_device`、`unbind_device`、`rotate_login`。

普通账号只管理自己的绑定；管理其他账号和账号角色需要管理员权限。身份从已验证的 OAuth 凭证取得，不采用模型传入的账号身份。管理员能管理其他账号的绑定，普通执行工具仍只操作当前登录账号的电脑。

敏感操作先返回两分钟有效的确认编号，向用户确认后原样提交操作和 `confirmation_id`。服务端绑定调用者、目标和参数并重新校验权限；确认编号本身不能证明用户真的口头确认，客户端仍需遵守确认流程。

创建账号或设备绑定返回五分钟有效、仅能领取一次的链接。GET 打开页面不会消耗凭证，需点击领取。真实密钥不进入工具返回值；领取链接本身具有领取权限，不应公开转发。

CLI 也可管理，例如：

```sh
chat2pi manage --account owner --action create_account --target family --name Family
chat2pi manage --account owner --action bind_device --target family --id family-windows
chat2pi manage --account owner --action set_role --target family --role admin
```

## 配置与安全边界

[字段样例](docs/CONFIGURATION.md) 展示绑定配置、仅本地的凭证配置和账号登录文件。云端保存同样的绑定字段，本地从领取文件导入；不是自动双向同步文件系统。更改授权应通过接口完成，不是手改本地 JSON 就获得权限。

HTTPS/WSS 提供传输加密，Cloudflare 仍能处理调用内容，**不是对 Cloudflare 隐藏内容的端到端加密**。工作目录限制是基本防误操作措施，不是对抗恶意本地程序的强沙箱；不信任的账号应使用独立系统用户或容器，尤其不能开放任意 Bash。Windows 超时的进程树清理有限。

断线自动重连，但操作不自动重放。撤销绑定或停用账号会拒绝后续访问；已经开始执行的操作不能保证回滚。轮换账号登录密钥会立即使旧 OAuth 授权失效。默认不记录工具参数或文件内容，关闭 Worker observability。

## 开发验证

```sh
npm ci
npm test
npm ci --prefix cloud
npm run test:cloud
```

Node 测试覆盖实际 Pi、权限和本地账号校验。Cloudflare 测试在本地 workerd 中运行真实 OAuth、数据库和 WebSocket 路由，覆盖账号隔离、管理员保护、确认绑定、凭证单次领取和撤销，不访问线上账号。

旧本机网关的兼容代码仍保留；新部署请使用上述数据库版本。
