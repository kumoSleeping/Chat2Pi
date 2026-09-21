# Cloudflare 443 WebSocket 网络探针

用于验证当前 TUN 环境是否能够连接 Cloudflare Worker / Durable Object。不连接 Pi，不执行命令，不读取本地文件；发送的内容只有随机测试标识。

- `worker-echo.ts`：第一阶段普通 Worker 原始回声实现。
- `src.ts`：第二阶段 SQLite-backed Durable Object，使用 WebSocket Hibernation API，同一个对象同时接受两个测试连接。
- `probe.mjs`：分别用系统路由（测试时 TUN 开启）和显式 HTTP 代理进行消息往返，空闲 35 秒后再次往返，主动断开并创建新连接后再测。
- 每个连接最多 100 条、每条最多 1024 字符；结果不写入 Durable Object 数据库。
- `PROBE_ENABLED` 默认 false。测试结束部署禁用版本，公网返回 410，避免保留无需认证的测试回声服务。

在仓库根目录安装依赖，然后：

```sh
cd experiments/worker-probe
npm ci
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write
npx wrangler deploy --var PROBE_ENABLED:true
cd ../..
node experiments/worker-probe/probe.mjs https://你的测试域名.workers.dev .local/probe-results.json
```

`probe.mjs` 的显式代理地址目前为本机 `http://127.0.0.1:7890`，复测时按本机配置修改。系统路由测试不等于绕过代理直连：启用 TUN 时，它仍可能被 TUN 代理。

完成后关闭回声入口：

```sh
cd experiments/worker-probe
npx wrangler deploy
```

这是短时连通测试，不能证明长时间稳定、真实 Windows 环境、OAuth 或 ChatGPT 工具链已经可用。使用休眠 API 也不代表本次测试已经观测并证明实例实际进入休眠。
