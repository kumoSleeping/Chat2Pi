# 私有云端部署

云端只部署一次；之后用 ChatGPT 的 `manage`、CLI 或 HTTPS 接口管理账号和设备，不再改 Cloudflare 配置。

## 首次部署

```sh
git clone https://github.com/kumoSleeping/Chat2Pi.git
cd Chat2Pi
npm ci
npm ci --prefix cloud
```

复制 `cloud/wrangler.example.jsonc` 为 `cloud/wrangler.local.jsonc`。进入 `cloud` 后运行 `npx wrangler login`、`npx wrangler kv namespace create OAUTH_KV`，把生成的 namespace ID 填入本地配置。Worker 名称和 `PUBLIC_URL` 也改成自己的值。

自定义域名需要在同一个 Cloudflare 账号中有有效的域名区域。配置示例：

```json
{
  "routes": [{ "pattern": "chat2pi.kumo.ltd", "custom_domain": true }],
  "vars": { "PUBLIC_URL": "https://chat2pi.kumo.ltd" }
}
```

这些字段合并到现有配置，保留 ROOM、DIRECTORY、OAuth KV 和两个 Durable Object migration。Cloudflare 管理域名的 DNS 与 HTTPS 证书；不要覆盖其他服务正在使用的记录。也可直接用自己的 workers.dev 地址。

在仓库根目录生成一次性初始化密钥和云端摘要文件（不覆盖已有文件）：

```sh
node --input-type=module -e 'import {randomBytes,createHash} from "node:crypto"; import {mkdirSync,writeFileSync} from "node:fs"; const dir=process.env.HOME||process.env.USERPROFILE; if(!dir)throw Error("User home missing"); const root=dir+"/.chat2pi/deployment"; mkdirSync(root,{recursive:true,mode:448}); const key=randomBytes(32).toString("hex"); writeFileSync(root+"/bootstrap-key",key,{mode:384,flag:"wx"}); writeFileSync(root+"/bootstrap-secrets.json",JSON.stringify({BOOTSTRAP_KEY_SHA256:createHash("sha256").update(key).digest("hex")}),{mode:384,flag:"wx"})'
```

进入 `cloud` 部署，然后回到根目录初始化管理员：

```sh
npx wrangler deploy --config wrangler.local.jsonc --secrets-file ~/.chat2pi/deployment/bootstrap-secrets.json
```

```sh
node build/cli.js bootstrap --url https://YOUR-SERVER --account owner --key-file ~/.chat2pi/deployment/bootstrap-key
```

第一个账号自动为管理员。初始化入口之后不可重复调用。保管好账号登录文件；丢失最后一位管理员凭证时需部署者通过数据库维护恢复，不开放无认证的重置入口。

## ChatGPT 连接

MCP URL：`https://YOUR-SERVER/mcp`。身份验证选择 OAuth，客户端设置选动态注册 DCR，不手填 Client ID / Client Secret；作用域 `pi:tools`。授权页填写服务账号及其登录密钥。

服务不是 OpenAI 身份提供方，不能根据用户传入的 ChatGPT 账号名证明身份。各 ChatGPT 账号通过 OAuth 连接服务账号；使用同一服务账号登录的连接共享该服务账号权限。

## 添加电脑

在聊天中请求绑定电脑，或：

```sh
node build/cli.js manage --account owner --action bind_device --id my-windows --name Windows
```

默认云端开放四个只读工具。要开放其他工具，可通过 `manage` 工具或 HTTPS API 的 `tools` 参数指定。领取链接五分钟有效，页面点击后下载 JSON。复制下载文件到目标电脑，安装客户端：

```sh
npm install -g github:kumoSleeping/Chat2Pi
chat2pi device-import --bundle ./chat2pi-credentials.json --workspace ./PiWorkspace
chat2pi start
```

先创建工作目录。需要 Bash / 写入时，云端要允许对应工具，本地导入时也需显式选择 `--unrestricted`。Windows Bash 需要 Git for Windows，并在本地凭证配置中设置 `local.shell_path`。代理可用顶层 `proxy_url`，例如 `http://127.0.0.1:7890`。

新增账号、设备、管理员角色都通过接口写数据库，无需重新部署。不同账号绑定同一台电脑，分别导入独立配置，运行 `chat2pi restart` 同时启动所有绑定。执行身份在云端与本地双重检查；同一系统用户下的任意命令执行不是强账号沙箱。

## 管理接口与智能体

详见 [远程管理 API](MANAGEMENT-API.md)。智能体可读取本地私密账号文件并直接请求服务，无需浏览器、ChatGPT cookie 或 Cloudflare 管理令牌。

## 从 0.4 迁移本机目录

先停止旧的 `agent-start --config` 进程。用 `login-import` 导入账号登录文件；把现有绑定 JSON 及同名 `.credentials.json` 一起移动到 `~/.chat2pi/bindings/`（绑定文件以 `.binding.json` 结尾），然后 `chat2pi start`。保留原本地权限、工作目录和代理设置，无需重发凭证。

## 从 0.3 迁移

0.4 不再读取 `OWNER_KEY_HASH` / `DEVICE_CONFIG`。保留原文件备份；设置初始化摘要后部署，创建首个管理员，重新生成每台电脑绑定并启动新版客户端。旧 OAuth 令牌缺少账号身份，会被拒绝，需在 ChatGPT 重新授权。不要删除已有 ROOM migration 或 OAuth KV namespace。

改变服务域名时同步更新 PUBLIC_URL、域名路由和连接地址，重新授权 OAuth。已有绑定文件的 server_url 不会自行迁移，需导出或更新两端配置后重启客户端。

## 验证

`npm test` 验证 Node 本地执行器；`npm run test:cloud` 用本地 workerd 测试完整 OAuth、管理员与设备隔离，不触及线上数据库。后台 agent 不包含开机自启；Windows 仍需真实电脑验收。

本项目面向私有小规模部署；账号目录的总配置和临时授权数据限制为 100 KB，超过时拒绝新增，已有数据保留。
