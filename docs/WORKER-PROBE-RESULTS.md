# CF Worker / Durable Object 443 连通实测

日期：2026-09-21。当前 Mac 的 FlClash TUN 保持开启、规则模式；没有改动系统代理或 TUN 设置。

| 服务 | 路线 | 首次往返 | 空闲 35 秒后 | 重连后 | 结果 |
|---|---|---:|---:|---:|---|
| worker | system-routing-TUN | 51 ms | 61 ms | 61 ms | PASS |
| worker | explicit-http-proxy | 49 ms | 42 ms | 43 ms | PASS |
| durable-object | system-routing-TUN | 47 ms | 55 ms | 246 ms | PASS |
| durable-object | explicit-http-proxy | 48 ms | 46 ms | 43 ms | PASS |

两个路线并发测试；每条连接的随机标识均原样返回。显式代理为本机 HTTP CONNECT 代理；系统路由仍可能由 TUN 代理，不能称为不经过代理的直连。

第二阶段实际部署了 SQLite-backed Durable Object，并使用 WebSocket Hibernation API。未写入数据库，未接入本地文件或 Pi 工具。测试完毕部署禁用版本，临时公网入口返回 410。

结论：当前 Mac 网络环境具备通过 WSS 443 连接 Worker / Durable Object 的条件，可以继续开发云端设备路由。此结果不证明长期稳定，也不代表 Windows、OAuth、ChatGPT 插件或多设备工具执行链路已经验收。

可复现代码：[网络探针](../experiments/worker-probe/README.md)。
