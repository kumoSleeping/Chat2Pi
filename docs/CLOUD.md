# Cloudflare 云端网关

当前推荐路径：ChatGPT → Worker（OAuth / MCP）→ Durable Object → WSS 443 → 目标电脑的 Pi 工具。

每个所有者部署自己的一套 Worker、Durable Object 和 OAuth KV。其他使用者不应共用你的个人授权密钥。电脑只安装 Node.js 和 Chat2Pi，主动连接云端，不需要公网 IP、OpenAI Tunnel 或 cloudflared。自定义域名可选，workers.dev 地址可以直接使用。

## 首次部署自己的服务

在仓库根目录执行 `npm install`、`npm run build`。随后在 `cloud` 目录执行 `npm install`、`npx wrangler login` 和 `npx wrangler kv namespace create OAUTH_KV`。在 `cloud/wrangler.jsonc` 中替换 Worker 名称、KV namespace ID 和 PUBLIC_URL 为自己的值。不要复用仓库里个人部署的 KV ID。

回到仓库根目录，生成自己的私密配置：

```sh
node build/cli.js cloud-init --config .local/cloud-secrets.json --url https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --id my-mac --workspace /absolute/workspace --out .local/my-mac.json
```

默认只有工作目录内的四个只读工具。需要全部工具时添加 `--unrestricted`，这会允许当前系统用户权限的文件操作和命令执行；也可在生成后分别配置允许的工具。

进入 `cloud` 目录部署：

```sh
npx wrangler deploy --secrets-file ../.local/cloud-secrets.json
```

回到根目录启动电脑连接：

```sh
node build/cli.js agent --config .local/my-mac.json
```

在 ChatGPT 开发者模式新增一次 MCP 插件，URL 填 `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/mcp`，选择 OAuth。授权页面输入 `.local/owner-key` 里的现有个人密钥。插件有 `list_devices` 和七个 Pi 工具；执行工具必须给出 `device_id`。

## 增加另一台电脑（包括 Windows）

在管理部署的电脑上生成新设备配置。工作目录填写目标电脑的路径：

```sh
node build/cli.js cloud-add-device --config .local/cloud-secrets.json --url https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --id family-windows --workspace 'C:\Users\name\Documents\PiWorkspace' --out .local/family-windows.json
```

再次在 `cloud` 目录运行 `npx wrangler deploy --secrets-file ../.local/cloud-secrets.json`，把设备登记到云端。每台设备有独立凭证；云端保存设备凭证的摘要。

将 `npm pack` 产生的安装包和**仅该设备的 JSON 配置**传到目标电脑，安装 Node.js 22 或以上版本（若 Pi 自身要求更高 Node.js，以安装提示为准）：

```sh
npm install -g ./chat2pi-0.3.0.tgz
chat2pi agent --config ./family-windows.json
```

Windows 若要使用 `bash`，还需要 Git for Windows 等提供的 Bash，并在设备配置 `device.shell_path` 指定其路径，例如 `C:/Program Files/Git/bin/bash.exe`；默认只读模式不需要 Bash。Windows 尚未做真实机器验证。

ChatGPT 不需要再添加插件。调用 `list_devices` 即可发现新上线的电脑。

## 运行管理

macOS / Linux 支持 `agent-start`、`agent-stop`、`agent-restart`、`agent-status`，均需 `--config /绝对路径/设备.json`。后台启动不等于开机自启，电脑重启后需要重新启动。Windows 使用前台 `agent`，或自行配置系统服务管理器。

代理环境可以在设备 JSON 的顶层增加 `"proxy_url": "http://127.0.0.1:7890"`。优先测试默认网络；WSS 443 已在本机 TUN 模式下跑通，但不能保证其他网络都放行。

退出或休眠只影响该电脑，不影响其他电脑。断线自动重连，工具执行不会自动重放；写入或命令调用中途断线时，应先检查执行结果再决定是否重试。

撤销设备：从私密配置 `DEVICE_CONFIG` JSON 字符串中移除对应条目，重新部署 secrets。已有连接在下次检查时也会失效。撤销 ChatGPT 的访问：在 ChatGPT 断开该插件；若需主动使全部云端授权失效，应在管理端撤销 OAuth KV grants，而不是只更换 owner-key（更换登录密钥不撤销旧令牌）。

## 更新与验证

Pi 依赖为 `*`，没有版本门槛。`npm update @earendil-works/pi-coding-agent` 后重新构建和测试。工具接口有变化时，更新云端工具目录再部署：

```sh
node --input-type=module -e 'import {catalog} from "./build/pi.js"; import {writeFileSync} from "node:fs"; writeFileSync("cloud/catalog.json", JSON.stringify(catalog(process.cwd()), null, 2)+"\n")'
```

本地回归：`npm test`。云端类型检查：`npx tsc -p cloud/tsconfig.json`。`node cloud/smoke.mjs https://你的地址` 会用本地 `.local/owner-key` 创建测试 OAuth 客户端并进行真实调用；当前脚本的测试设备名是 `kumo-macBook-m2`，在其他部署中应调整。

Durable Object 维护在线连接及进行中的调用，OAuth KV 保存客户端和授权信息。工具参数和结果经过 Cloudflare 转发，不写入应用存储；当前关闭 Worker observability。工具结果使用 MCP 标准 content 字段，模型收到真实 Pi 输出，不附加转发层日志。
