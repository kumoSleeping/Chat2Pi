# 本机统一存储

默认根目录为 `~/.chat2pi`，Windows 为 `%USERPROFILE%\.chat2pi`。账号凭证存放在 `accounts/`，设备绑定和对应私密执行配置存放在 `bindings/`。文件名自动包含服务地址摘要、账号和设备，避免不同服务的同名账号相互覆盖。

`chat2pi start / stop / restart / status` 自动使用此目录；`restart` 重新加载全部绑定。可以通过 `--home PATH` 管理另一套完全独立的配置。

下面的 JSON 字段不变，导入时自动保存到正确的位置。Windows 目录权限继承当前用户个人目录的 ACL；不要把凭证目录放在共享目录。

# 配置字段样例

一份绑定文件对应一个账号和一台电脑，例如 `kumo--mac.binding.json`、`kumo--windows.binding.json`、`family--mac.binding.json`。以下摘要和密钥都是示意，不能直接用于连接。

## 云端和本地相同的绑定配置

```json
{
  "version": 1,
  "server_url": "https://chat2pi.kumo.ltd",
  "account_id": "kumo",
  "device_id": "kumo-macBook-m2",
  "device_name": "我的 MacBook",
  "device_key_sha256": "<该绑定设备密钥的 64 位十六进制 SHA-256 摘要>",
  "tools": ["read", "ls", "find", "grep"]
}
```

云端数据库存储同样的对象；导出时由服务生成，本地导入后字段保持一致。在线状态不写进配置，在查询时动态生成。`account_id` 是服务账号，不是 OpenAI 账号 ID。

## 仅保存在对应电脑的私密配置

默认文件名是在绑定路径后加 `.credentials.json`：

```json
{
  "device_key": "<仅此账号与电脑绑定可用的随机密钥>",
  "local": {
    "workspace": "C:/Users/kumo/Documents/PiWorkspace",
    "access": "workspace",
    "tools": ["read", "ls", "find", "grep"],
    "timeout_seconds": 60
  }
}
```

另一份绑定使用另一份凭证文件。可以按账号配置不同工作目录、工具权限。需要代理时加顶层 `proxy_url`；使用 Bash 时设置 `local.shell_path` 并显式选择 `access: unrestricted`。这个文件只在本地保存，不同步到云端。

## 账号登录文件

```json
{
  "server_url": "https://chat2pi.kumo.ltd",
  "account_id": "kumo",
  "login_key": "<账号登录密钥，与设备密钥不同>"
}
```

用于 OAuth 授权页和 CLI 管理接口。角色不是客户端可以声明的字段，由云端数据库决定。云端只存登录密钥摘要；角色改变会影响已有会话的下一次管理操作，密钥轮换或停用账号会撤销已有 OAuth 授权。

不要把私密文件提交 Git。绑定主文件也包含账号和设备信息，建议一起保存在本地私密目录。
