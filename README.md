# dsh-approval-toast

DeepSeek Harness（DSH）的 Windows 桌面通知插件：审批请求可以直接在通知上点「允许一次 / 拒绝」，不用切回 DSH。

A Windows toast plugin for DeepSeek Harness: approve or reject a pending tool approval straight from the notification.

Windows only · DSH 0.2.1+ · 零依赖

## 功能

- **通知上审批**：DSH 不在前台时弹 Windows 通知，通知上直接点「允许一次 / 拒绝」，点完立即生效
- **前台不打扰**：当前对话就在前台时不弹通知，改用应用内审批框
- **多对话**：其他没打开的对话需要授权时照常通知
- **完成 / 出错通知**：任务完成或出错时弹通知
- **子代理静默**：子代理 / 子会话的授权、完成、错误都不弹桌面通知（授权只走应用内）
- **60 秒回落**：通知长时间无人处理会自动撤回，回落到应用内审批框

## 通知长什么样

顶部是应用名 `DeepSeek Harness`，正文是「会话 / 工具 / 内容」，底部是「允许一次 / 拒绝」两个按钮。

长内容会按标点截断（会话 60 字、工具 40 字、内容 160 字），完整内容在应用内审批框里。

## 安装

在 DSH 的插件管理器（设置 → 插件）里搜索 `dsh-approval-toast` 安装；或者命令行：

```bash
dsh plugin --profile <profile> add dsh-approval-toast
```

安装后**完全退出 DSH 再打开**。

## 要求

- Windows 10 / Windows 11
- DeepSeek Harness 0.2.1 及以上
- 不需要管理员权限，只写当前用户注册表

## 安全说明

- 零依赖、无安装脚本、无网络请求、无遥测
- 只在当前用户下注册 `dshnotify://` 协议和通知身份（HKCU），可用 `uninstall.ps1` 清理
- 本机 HTTP 接口只监听 `127.0.0.1` 的随机端口；token 一次性，校验端口 / rid / token / 决策词后才接受
- 通知按钮通过 `dshnotify://` 调起 `decision.ps1`，参数严格校验，非法输入直接退出、不发起请求

详见 [SECURITY.md](SECURITY.md)。

## 卸载

在插件管理器里卸载后，运行包内 `uninstall.ps1` 清理协议与通知身份。

## 已知限制

- 仅 Windows；其他系统不会弹通知，审批会自动回落应用内
- 通知横幅能显示几行由 Windows 决定；专注助手 / 免打扰可能拦截通知
- 点击通知按钮会拉起一次 PowerShell，约 0.5~1 秒延迟

## License

MIT
