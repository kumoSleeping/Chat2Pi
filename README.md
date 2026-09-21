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

安装 Node.js 22.19 或更新版本，然后：

```sh
npm install -g https://github.com/kumoSleeping/Chat2Pi/archive/refs/heads/main.tar.gz
```

GitHub 仓库附带已编译客户端，使用源码归档安装可避开部分 npm 版本的全局 Git 依赖安装问题，不需要 Git 或本机 TypeScript 编译环境。Pi SDK 随依赖安装，不需单独安装 Pi CLI、Python、cloudflared 或 OpenAI Tunnel。Pi 依赖为 `*`，没有人为版本限制；未来接口变动按实际问题修复。

## 两种文件，分别下载

| 创建什么 | 下载文件 | 在哪里使用 |
| --- | --- | --- |
| 连接账号 | `link_chatgpt_plugin_oauth_<账号名>.json`，包含连接密钥 `login_key`，没有设备密钥 | 在 ChatGPT 添加插件时，将连接密钥填到授权页；仅管理电脑需要保存该文件 |
| 设备 | `<设备名>.json`，包含该设备的绑定和 `device_key`，没有连接密钥 | 只传到目标电脑，用 `chat2pi folder` 打开文件夹并拖入，再运行 `chat2pi start` |

创建账号不会同时创建设备，创建设备不会同时下载账号凭证。设备文件中的 `account_id` 仅记录归属，不是账号密钥，也不能代替 ChatGPT 授权。旧文件名仍可导入。

## 添加自己的另一台电脑

在已经保存账号登录凭证的电脑上，一条命令创建并导出设备文件（无需新建账号）：

```sh
chat2pi device-create WindowsSov8
```

默认保存为 `~/Downloads/WindowsSov8.json`，也可用 `--out` 指定文件位置。将文件传到 Windows 后：

```powershell
chat2pi.cmd folder
```

把下载的 `WindowsSov8.json` 拖进打开的文件夹，然后运行：

```powershell
chat2pi.cmd start
```

Mac 上同样使用 `chat2pi folder` 打开 Finder。设备电脑只需要设备文件，不需要账号凭证，也不需要导入命令。首次启动自动补齐本机设置并创建 `~/PiWorkspace`，文件留在你放入的位置。日常只需 `chat2pi start`：启动所有已导入绑定，每 200 毫秒轮询展示新增日志，Ctrl+C 停止本次服务并断开设备。启动时展示工具加载进度；出现 `Device online` 才表示云端连接成功。

默认创建和导入完整七个工具（`full`，整机访问）。创建设备时可用 `--access read` 选择只读，或 `--access workspace` 限制为工作目录内读写、不含 Bash。文件中已有的权限限制会保留，启动不会扩大已有绑定的权限。实际启用的工具会在导入后打印，始终受云端授权上限约束。

创建流程先保存私密文件，再向服务注册摘要；注册失败时保留文件，修复网络后重跑**同一条命令**即可，不会换密钥。不要删除该文件或更换输出位置来重试。重复导入相同配置也可继续启动。已有同名但不同凭证的设备不会被覆盖。

网页版管理工具返回领取链接时，请自己打开下载，助手不要代领再转成聊天附件。网页支持在当前页面再次下载，设备文件以设备名命名。若领取后丢失文件，可用 `reissue_device` 撤销旧设备凭证并重新签发，无需删除设备；此操作需要确认，旧文件和旧连接的权限会失效。

所有默认文件集中在用户目录的 `~/.chat2pi`（Windows 为 `%USERPROFILE%\.chat2pi`）：

```text
.chat2pi/
  accounts/   仅管理电脑保存账号凭证；设备电脑不需要
  devices/    把下载的设备 JSON 拖到这里即可
  downloads/  领取的凭证包
  runtime/    后台服务状态、控制凭证和日志
```

```sh
chat2pi start    # 前台启动所有设备连接，显示日志；Ctrl+C 停止
chat2pi start --background  # 可选：常驻后台
chat2pi stop
chat2pi restart --background  # 后台重新加载全部配置
chat2pi status   # 查看本地进程和已加载绑定
chat2pi manage --action me
```

启停和状态命令默认处理全部已导入绑定，无需额外参数。管理权限或执行电脑工具时仍会选择唯一账号。

前台 `start` 发现已有服务时会提示先 `stop`，不会接管或停止别的会话；后台启动重复运行不会重复启动。前台新增或修改绑定后 Ctrl+C 再 `start`，后台模式使用 `restart --background`；不自动监视文件变化。`status` 的运行状态不等于云端在线状态，在线设备用 `manage --action list_devices` 查询。`restart` 默认也会前台显示日志。后台管理使用经过认证的本机控制接口，适用于 macOS / Linux / Windows，不包含开机自启。

账号凭证只在管理电脑保存到 `~/.chat2pi/accounts/`，或用 `--credentials 文件` 指定；只有一个账号时管理命令自动选择，多个账号用 `--account` 指定，同名账号分属不同服务时再加 `--url`。可用 `--home` 指定独立的配置目录。设备私密文件保留本地权限限制，实际权限仍取云端与本地交集。

Windows 文件工具可以直接运行。使用 Bash 工具需额外安装 Git for Windows，并在私密配置的 `local.shell_path` 指定 Bash 路径。Windows、macOS 已覆盖自动测试；Windows 实际控制台 Ctrl+C 仍需现场验收。

日常命令只有 `folder`、`start`、`stop`、`restart`、`status`。测试版已移除 `device-import`、`login-import`、单配置 `agent` / `gateway-*` 等旧命令；统一使用设备文件夹。管理电脑额外保留 `device-create`、`manage` 和首次部署用的 `bootstrap`。

## 更新

先在前台按 Ctrl+C，或运行 `chat2pi stop` 停止旧后台服务。然后更新并启动：

macOS：

```sh
npm install -g https://github.com/kumoSleeping/Chat2Pi/archive/refs/heads/main.tar.gz
chat2pi start
```

Windows PowerShell：

```powershell
npm.cmd install -g https://github.com/kumoSleeping/Chat2Pi/archive/refs/heads/main.tar.gz
chat2pi.cmd start
```

首次启动自动把旧账号文件改名，并把设备绑定和设备密钥文件合并成独立设备文件；全部写入并验证后，删除对应旧文件。原工作目录、权限、代理和密钥保留。不会清理下载文件、历史归档或任意项目配置。遇到冲突会停止并保留原文件，详见 [迁移规则](docs/CONFIGURATION.md)。安装本身不改配置，迁移发生在启动或重启时。

客户端更新不会更新云端网页；自部署者需要另行部署新版 `cloud/`，才能使用新的下载文件名和仅输入连接密钥的授权页。

## 云端与首次管理员

按 [部署说明](docs/CLOUD.md) 部署 Worker、两个 Durable Object 类和 OAuth KV。可使用自己的域名（例如 `chat2pi.kumo.ltd`）或 workers.dev 域名。

部署时设置一次性初始化密钥的摘要。持有密钥才能创建第一个账号，该账号自动成为管理员；初始化完成后入口永久关闭，不因重启或修改密钥重新开放。

```sh
chat2pi bootstrap --url https://YOUR-SERVER --account owner --key-file ~/.chat2pi/deployment/bootstrap-key
```

管理员可以创建账号、授予或撤销管理员权限、停用账号和管理设备。系统不允许停用或降级最后一位有效管理员。

在 ChatGPT 中新增自定义 MCP 插件：URL 为 `https://YOUR-SERVER/mcp`，认证选择 OAuth，客户端注册选择 DCR；授权页只填写**连接密钥**（兼容已有凭证文件中的 `login_key`），不再填写账号。一个连接可访问自己的多台设备，每台设备有独立设备密钥，可单独撤销。内部 `account_id` 保留为设备分组和权限隔离标识，不是 OpenAI 账号，也不是设备 ID；不需要手动修改。服务不会取得 OpenAI 的用户身份。

## 工具

| 工具                                                  | 描述                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| `list_devices`                                        | 查询当前账号的设备与在线状态               |
| `read`、`write`、`edit`、`ls`、`find`、`grep`、`bash` | 目标电脑上的 Pi 工具，必须指定 `device_id` |
| `manage`                                              | 管理账号和设备。                           |

`manage` 的动作：`me`、`list_accounts`、`create_account`、`set_role`、`disable_account`、`enable_account`、`list_devices`、`bind_device`、`unbind_device`、`reissue_device`、`rotate_login`。

普通账号只管理自己的绑定；管理其他账号和账号角色需要管理员权限。身份从已验证的 OAuth 凭证取得，不采用模型传入的账号身份。管理员能管理其他账号的绑定，普通执行工具仍只操作当前登录账号的电脑。

敏感操作先返回两分钟有效的确认编号，用户已明确授权同一对象和操作时无需再要求固定口令；否则先询问确认。原样提交操作和 `confirmation_id`。服务端绑定调用者、目标和参数并重新校验权限；确认编号本身不能证明用户真的口头确认，客户端仍需遵守确认流程。

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

## 更新这一版

先部署新版云端，再更新需要使用新命令的 Mac / Windows 客户端。旧设备配置仍兼容，无需重建账号或设备。网页版 ChatGPT 的 Chat2Pi 应用详情页执行刷新，载入新的工具参数和操作说明；保持原 MCP 地址与 OAuth 账号。仅刷新网页不会部署服务端代码。
