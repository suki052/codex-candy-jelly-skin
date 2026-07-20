# Codex Candy Jelly Skin

一个面向 Windows Codex 桌面应用的非官方糖果果冻主题。它保留原应用的任务、项目、聊天和设置交互，只在运行时添加可回滚的界面样式。

## 特点

- 糖果果冻风左右侧栏、任务便签、好友卡片与聊天气泡
- 原创通用小鸡、芽芽助手和虚构好友头像
- 普通启动与关闭 GPU 加速的兼容启动方式
- 不修改 WindowsApps 或 app.asar；可随时恢复官方外观
- 不包含私人姓名、私人头像、本机路径、日志、历史备份或快捷方式

## 安装

1. 保存未发送的内容，并关闭所有 Codex 窗口。
2. 双击 **Install Codex Candy Jelly.cmd**。
3. 安装完成后，使用桌面上的启动快捷方式。若电脑掉帧，可用 **Start Codex Candy Jelly Compatible.cmd**。
4. 想恢复原版时，运行 **Restore Official Codex.cmd**。

安装器只连接本机回环地址上的调试端口，并把运行文件放在本机用户目录中。它不会改写官方应用文件。Codex 更新后可能需要重新安装主题。

## 开发与测试

Windows 10/11 和 Microsoft Store 版 Codex 是主要测试环境。回归测试：

```powershell
cd windows
.\tests\run-tests.ps1
```

## 开源与署名

代码基于 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的 Windows 运行机制整理，遵循 MIT License。字体许可证和素材说明见 [ASSET_LICENSES.md](ASSET_LICENSES.md) 与 [NOTICE.md](NOTICE.md)。

这是社区制作的非官方项目，与 OpenAI 没有隶属或背书关系。Codex 和 OpenAI 名称及商标归各自权利人所有。
