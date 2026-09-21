# 远程管理 API / 智能体接入

所有管理入口共用服务端权限逻辑。Cloudflare 部署凭证不用于日常管理。

## 认证

`POST https://YOUR-SERVER/api/manage`

```http
Authorization: Bearer <账号的 login_key>
X-Account-Id: <服务 account_id>
Content-Type: application/json
```

凭证保存在私密 `*.login.json` 文件，字段为 `server_url`、`account_id`、`login_key`。智能体应从文件读取，避免在工具日志、命令参数、聊天记录中打印密钥。该凭证是服务自有的随机高熵登录密钥，不是 ChatGPT access token。

CLI 等价入口：

```sh
chat2pi manage --credentials /private/owner.login.json --action me
chat2pi manage --credentials /private/owner.login.json --action list_accounts
chat2pi manage --credentials /private/owner.login.json --action list_devices --target family
```

请求正文示例：

```json
{ "action": "create_account", "account_id": "family", "name": "Family" }
```

```json
{
  "action": "bind_device",
  "account_id": "family",
  "device_id": "family-windows",
  "name": "Windows",
  "tools": ["read", "ls", "find", "grep"]
}
```

目标 `account_id` 不填时为调用者。普通账号不能指定其他账号；管理员可以管理指定账号。身份必须同时匹配真实凭证，不能通过改请求头伪造。

## 操作

| action                           | 参数                                  | 权限                                       |
| -------------------------------- | ------------------------------------- | ------------------------------------------ |
| me                               | 无                                    | 当前账号                                   |
| list_accounts                    | 无                                    | 管理员                                     |
| create_account                   | account_id，name 可选                 | 管理员，新账号默认为 member                |
| list_devices                     | account_id 可选                       | 自己；管理员可指定他人，含注册总数、在线数 |
| bind_device                      | device_id，account_id/name/tools 可选 | 自己；管理员可指定他人                     |
| unbind_device                    | device_id，account_id 可选            | 自己；管理员可指定他人，需确认             |
| set_role                         | role=admin/member，account_id 可选    | 管理员，需确认                             |
| disable_account / enable_account | account_id                            | 管理员，需确认                             |
| rotate_login                     | account_id 可选                       | 自己；管理员可指定他人，需确认             |

## 确认流程

敏感操作第一次调用返回 `confirmation_required: true`、`confirmation_id`、操作目标和两分钟有效期。智能体必须先向用户确认，再把**原始参数**和 `confirmation_id` 一起提交。确认编号绑定调用者、目标、参数和凭证版本；修改参数、重用、过期或失去权限会被拒绝。服务端始终保护最后一位有效管理员。

这是协议上的两步确认，不能证明人类真的点击了同意；不要让智能体自动原样回传绕过用户确认。

## 领取凭证

创建账号、绑定电脑或轮换登录密钥只返回 `claim_url`，不把真实密钥直接放进工具结果。链接五分钟有效，一次领取后作废。GET 不消耗凭证；浏览器点击领取后发 POST 并下载文件。令牌放在 URL fragment 中，不发送给页面 GET 请求。

智能体也可以通过 `POST /claim`、正文 `{"code":"链接 fragment"}` 领取，并把 JSON 直接写入权限受限的本地文件；不得打印响应中的密钥。CLI 提供 `chat2pi claim --url <领取链接> --out /private/bundle.json`，调用时注意领取链接本身也是短期凭证。

领取文件会包含账号登录信息，或 `binding` 加 `device_key`。设备文件用 `device-import` 拆分成相同的绑定配置和仅本地的密钥配置。不能把账号登录密钥当设备凭证使用。

## 初始化与撤销

`POST /bootstrap` 仅部署初始化时使用，以 `Authorization: Bearer <初始化密钥>` 认证，正文 `{"account_id":"owner","name":"Owner"}`。只成功一次，返回首个管理员登录文件，由 CLI 直接私密落盘。

停用账号和轮换登录密钥会使旧 OAuth 会话失效。设备解绑后拒绝后续调用；已开始的操作不能保证回滚。管理员角色改变按数据库实时校验，不依赖旧令牌里的角色声明。

接口使用 HTTPS。含 Origin 的请求必须来自服务自身域名；未携带 Origin 的 CLI/智能体请求仍必须验证凭证。当前设有基础速率限制和账号/设备容量限制，适用于小规模私有部署，不面向匿名公众注册。
