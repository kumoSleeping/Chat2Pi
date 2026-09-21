# 两类配置文件

设备电脑只需要设备 JSON，不需要账号文件。运行 `chat2pi folder` 打开配置文件夹，把下载的 `<设备名>.json` 拖进去，再运行 `chat2pi start`。首次启动自动补齐本机设置；不再提供 `device-import` 或 `login-import` 命令。

默认根目录为 `~/.chat2pi`，Windows 为 `%USERPROFILE%\.chat2pi`。账号和设备分开保存：

```text
.chat2pi/
  accounts/<服务标识>/link_chatgpt_plugin_oauth_<账号名>.json
  devices/<设备名>.json  # 直接拖入；已有子目录中的设备文件也会读取
  downloads/   领取的文件
  runtime/     服务状态和日志
```

服务标识和账号子目录用于避免不同服务、不同账号的同名设备相互覆盖。日常运行只需 `chat2pi start`；无需选择目录或账号。`--home PATH` 可使用另一套独立存储。

## 连接账号文件

创建账号时下载 `link_chatgpt_plugin_oauth_<账号名>.json`，仅包含：

```json
{
  "server_url": "https://chat2pi.kumo.ltd",
  "account_id": "kumo",
  "login_key": "<连接密钥>"
}
```

在 ChatGPT 添加插件时，将 `login_key` 填入授权页的 Connection key。日常启动设备无需这个文件；需要在命令行管理账号或创建设备时，将文件放在管理电脑的 `~/.chat2pi/accounts/`，或使用 `--credentials 文件`。账号角色由云端决定，客户端不能声明。密钥轮换或停用账号会撤销已有 OAuth 授权。

## 设备文件

创建设备时下载 `<设备名>.json`，不包含连接密钥。导入目标电脑后，同一个设备文件增加本机运行设置：

```json
{
  "binding": {
    "version": 1,
    "server_url": "https://chat2pi.kumo.ltd",
    "account_id": "kumo",
    "device_id": "windows",
    "device_name": "Windows",
    "device_key_sha256": "<设备密钥的 SHA-256 摘要>",
    "tools": ["read", "write", "edit", "ls", "find", "grep", "bash"]
  },
  "device_key": "<这台设备的密钥>",
  "local": {
    "workspace": "C:/Users/Alice/PiWorkspace",
    "access": "unrestricted",
    "tools": ["read", "write", "edit", "ls", "find", "grep", "bash"],
    "timeout_seconds": 300
  }
}
```

`account_id` 只记录设备归属，不是 OpenAI 账号，也不是连接密钥，不应手动修改。设备密钥只能用于对应绑定。本地工具权限与云端授权取交集；`workspace` 模式限制到工作目录且不允许 Bash。默认新设备启用全部七个工具，可在创建或导入时用 `--access read` 或 `--access workspace` 限制。

工具调用默认总超时为 **300 秒（5 分钟）**，`local.timeout_seconds` 可设为 1–300 秒；已有文件里的显式设置会保留。Bash 参数 `timeout` 可以提前结束命令，但不能延长设备上限。修改后需要重启客户端。

需要代理时在设备文件顶层添加 `proxy_url`。Windows 使用 Bash 工具时，可在 `local.shell_path` 设置 Git Bash 路径，例如 `C:/Program Files/Git/bin/bash.exe`。工作目录、代理和 shell 设置只留在本机，不上传云端。

## 更新时自动迁移和清理

升级后首次 `start` / `restart`，会自动迁移默认存储（或指定的 `--home`）：

- `accounts/*.login.json` 改为新的连接账号文件名。
- `bindings/*.binding.json` 与对应 `.credentials.json` 合并为一个设备文件。
- 旧绑定或密钥文件里混入的 `login_key` 移到独立账号文件，不留在设备文件中。

迁移保留原密钥、设备归属、工具权限、工作目录、代理和超时等设置，不重新绑定设备，也不扩大旧配置的权限。全部新文件写入并验证成功后，删除被替代的旧文件。中途退出可在下次启动继续清理；目标文件冲突或密钥不匹配时停止并保留原文件。

不会扫描或删除 Downloads、历史 archive、项目目录和任意 `--config` 路径。没有云端绑定信息的早期独立 agent / gateway 配置保持兼容，不猜测账号归属。旧的单配置启动和导入命令已移除。

Windows 文件权限继承当前系统用户目录的 ACL。配置包含密钥，不要提交 Git 或放到共享目录。
