# 网络路线与 Windows 使用

## 先区分两种角色

- **网关**：向 ChatGPT 提供唯一的 MCP 地址，保存个人 OAuth 授权和设备登记。当前版本运行在一台常在线的 Mac/Linux/Windows 电脑，通过 Cloudflare Tunnel 对外提供服务。
- **设备客户端**：执行本机 Pi 工具，主动连接网关的 `wss://域名/agent`。默认 HTTPS/WSS 使用 443，不需要 cloudflared、OpenAI 隧道或单独的 ChatGPT 插件。

你的第二台电脑是设备客户端。其他独立用户则应部署自己的网关、使用自己的域名与凭证，并在自己的 ChatGPT 账号连接一次。当前项目是单所有者设计，**不能把同一网关直接当成多个陌生用户共享的服务**。复制安装包不会复制账号绑定，也不会自动登记新电脑。

## CF Tunnel 与 TUN 可以共存，但需要可用的出口

Cloudflare Tunnel 的出口是 TCP/UDP 7844：HTTP/2 使用 TCP，QUIC 使用 UDP。浏览网页使用的 HTTPS 443 正常，不代表隧道出口也正常。`protocol: http2` 只能避开 UDP 问题，无法解决 TCP 7844 也不通的问题。

排查顺序：

1. `chat2pi status --config /path/gateway.json` 区分本地服务和公网入口。
2. 在 cloudflared 配置中临时指定 `protocol: http2`，重启后观察是否注册成功。保留配置备份；这不是所有网络都适用的默认值。
3. 在代理软件的连接记录里确认 `cloudflared` 的实际出口，而不是仅凭分组名称猜测。按进程分流时 macOS/Linux 通常为 `cloudflared`，Windows 为 `cloudflared.exe`。规则放在会先匹配它的通用规则之前。
4. 对比直连和明确选定的代理节点。切换全局代理并不是必要条件。
5. 若 TLS 握手 EOF，检查代理链路是否根据 SNI 改写目标地址。隧道实际连接 `region1.v2.argotunnel.com` / `region2.v2.argotunnel.com` 的边缘 IP，而 TLS 服务名是 `h2.cftunnel.com` / `quic.cftunnel.com`。不能把服务名直接当成新的目标地址。
6. Mihomo 的嗅探支持 `skip-domain` 或禁止 `override-destination`；只对相关隧道流量调整。若是远端代理服务在改写，本机设置不能修复远端行为，需要提供方处理或更换路线。
7. 始终保留 TLS 验证。不要通过关闭证书检查或让公网 MCP 免认证来“修复”网络问题。

参考：[Cloudflare 出口要求](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/)、[cloudflared 协议实现](https://github.com/cloudflare/cloudflared/blob/master/connection/protocol.go)、[Mihomo 规则优先级](https://wiki.metacubex.one/config/rules/)、[Mihomo 嗅探设置](https://wiki.metacubex.one/config/sniff/)。

### 2026-09-21 本机诊断记录

- 本地网关正常；公网入口 HTTP 530 / Cloudflare 1033，尚未完成 ChatGPT 接入。
- 当前 TUN 环境：QUIC 超时，HTTP/2 握手 EOF。
- 独立回环代理探针分别测试三个 SS 节点和两个 VMess 节点，隧道 SNI 均未成功握手；同时验证过测试代理能正常访问普通 HTTPS 网站。
- 同一地址/端口，使用 `region1.v2.argotunnel.com` 作为对照 SNI 可以到达 TLS 证书阶段；**这不是通过认证的隧道，也不是允许修改生产 SNI 的证据**。
- 绑定物理网卡的直连探针超时；单独 UDP 转发的 QUIC 测试也超时。
- 本机保存配置中的 sniffer 已关闭。上述差异提示检查上游的 SNI 处理或过滤，但无法仅凭客户端日志确定根因。不能断言是 FlClash、TUN 或某个代理节点单独造成的。
- 独立探针没有更改系统代理或 TUN 设置。测试用私密配置不进入安装包。

## Windows 作为第二台设备

1. 安装 Node.js 与 npm（遵循安装时 Pi 的实际 Node 版本要求），下载本项目 `.tgz` 包。
2. 在网关电脑登记设备，目录使用目标 Windows 电脑上的路径，例如：

   ```sh
   chat2pi add-device --config /path/gateway.json --id family-win --workspace 'C:/Users/Alice/Chat2PiWorkspace' --out /private/family-win.json
   chat2pi restart --config /path/gateway.json
   ```

   默认只读。需要全部七个工具时添加 `--unrestricted`。目标工作目录必须在 Windows 上实际创建。

3. 只传输安装包和 `family-win.json`，将配置保存在该 Windows 用户自己的目录。不要把网关所有者密钥或其他设备配置一起复制。
4. 在 PowerShell 中安装并启动：

   ```powershell
   npm.cmd install -g .\chat2pi-0.2.1.tgz
   chat2pi.cmd agent --config "$env:USERPROFILE\Chat2Pi\family-win.json"
   ```

   使用 `.cmd` 可避免 PowerShell 把 npm 的 `.ps1` 启动器当成受限脚本；不需要降低系统执行策略。

5. 显示 `Device online` 后，在原来的 ChatGPT 插件调用 `list_devices`，应看到 `family-win`。此项目不要求在第二台电脑登录 ChatGPT；授权依据是设备专属配置。

### 命令执行与 Windows 路径

当前统一工具清单包含 `bash`，不是原生 PowerShell 工具。要启用它，安装 [Git for Windows](https://git-scm.com/download/win)。本项目传递 Git Bash 查找所需的 Windows 环境变量，也支持在配置的 `device` 内显式填写：

```json
"shell_path": "C:/Program Files/Git/bin/bash.exe"
```

桥接器直接调用 Pi 工具工厂，不读取 Pi CLI 的 `settings.json`；自定义 shell 应写在桥接器配置中。文件工具可以使用 `C:/Users/Alice/...`；`bash` 内的路径与命令则遵循 Git Bash 语法。只开放文件工具时，不必为了本项目额外安装 Bash。

Windows 上目前只提供前台 `run` / `agent`，未实现本项目自己的后台管理或开机自启。确认前台运行后，可用 Windows 任务计划程序以当前用户启动同一条命令；不要无理由提升到管理员。电脑休眠时会离线，恢复后自动重连。Windows 进程树终止仍有限制，超时不能保证所有派生进程都结束，操作也不能自动重试。

配置文件包含设备密钥。Windows 使用用户目录的文件访问权限保护它；本项目目前不替 Windows 配置 ACL。如果家人共用同一个系统登录账号，文件夹配置不是强安全边界，应该使用独立系统用户或只读工具。

**验证范围**：已在 macOS 验证真实 Pi 工具和代理转发，尚未在真实 Windows 机器上完成验收。Windows 安装、路径、Git Bash、超时和休眠恢复需要在目标机器复测。

## 设备客户端的代理配置

TUN 模式下，客户端连接通常由系统路由接管。如果只启用了浏览器/系统 HTTP 代理，Node 的 WebSocket 不一定自动使用它；可在设备配置顶层添加：

```json
"proxy_url": "http://127.0.0.1:7890"
```

端口填本机代理软件的实际 HTTP/混合代理端口。支持 HTTP/HTTPS CONNECT 代理，TLS 校验保持开启；这个选项只代理设备的 WSS 连接，**不会让 cloudflared 自动通过 HTTP 代理**。代理配置属于每台设备，不应把你的 `127.0.0.1:7890` 硬编码成所有用户的默认值。没有代理时省略该字段。

## 如果 7844 路线始终不可用

| 方案 | 用户电脑的连接 | 优点 | 当前状态 |
|---|---|---|---|
| 本机网关 + CF Tunnel | 网关使用 7844，其他设备使用 WSS 443 | 复用现有实现 | 已实现，本机出口未通 |
| 常在线服务器上的网关 + HTTPS 反向代理 | 所有用户设备只用 WSS 443 | 可复用当前 Node 网关；本机休眠不影响其他电脑 | 需要服务器、TLS 反向代理与部署验证 |
| CF Worker + Durable Object 网关 | 所有用户设备只用 WSS 443 | 不依赖某台个人电脑，也不需要 cloudflared | 完整网关尚未实现；最小 443 连接测试已通过 |

若目标是便于其他个人用户自部署，优先评估最后一种：ChatGPT 的 MCP 请求到 Worker，Durable Object 维护设备连接与路由，各电脑主动连接它。Cloudflare 官方支持 Durable Object 管理 WebSocket，但仍需实现鉴权、OAuth、在线状态、请求关联、超时和断线恢复，并考虑平台额度、费用及日志数据。不保证任何地区的 443 一定直连可用，设备端显式代理仍有价值。

Cloudflare Worker 不能直接运行当前依赖本地进程和文件系统的 Node/Pi 网关；这是云端部分的适配工作，不是把现有程序原样上传。Pi 工具继续留在用户电脑执行。

参考：[Durable Object WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)。

## 后续实测更新

2026-09-21 已在保持 TUN 开启的环境完成普通 Worker 和 Durable Object 的 WSS 443 测试，系统路由与显式 HTTP 代理均通过消息往返、35 秒空闲和重连验证。见 [实测结果](WORKER-PROBE-RESULTS.md)。原 cloudflared 隧道仍未恢复，此结果验证的是替代路线。
