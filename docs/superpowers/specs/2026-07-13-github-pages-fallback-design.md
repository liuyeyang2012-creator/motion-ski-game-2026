# GitHub Pages 备用发布设计

## 目标

为体感滑雪游戏提供一个不经过 `chatgpt.site` 的公开 HTTPS 备用地址，解决部分手机网络被 Cloudflare 拦截的问题。

初始地址：

`https://liuyeyang2012-creator.github.io/motion-ski-game-2026/`

## 仓库与公开范围

- 在 GitHub 账号 `liuyeyang2012-creator` 下创建公开仓库 `motion-ski-game-2026`。
- 上传游戏源代码、测试、公开模型文件和构建配置。
- 不上传 `.env`、访问令牌、账号凭据、聊天记录、图片聊天附件、`node_modules`、测试报告或本地临时文件。
- 摄像头画面和姿态关键点仍只在玩家设备本地处理，不上传或保存。

## 发布架构

- 使用 GitHub Actions 在每次推送到默认分支后自动构建。
- 使用 Vite 的 GitHub Pages 子路径 `/motion-ski-game-2026/` 生成静态产物。
- 将页面、JavaScript、CSS、MediaPipe 姿态模型和 WASM 文件作为同源静态资源发布。
- 通过 GitHub 官方 Pages 部署流程发布，不依赖额外服务器、数据库或密钥。

## 兼容性要求

- 网站必须使用 HTTPS，手机浏览器才能请求摄像头权限。
- 所有资源路径必须适配仓库子路径，不能写死到域名根目录。
- 页面刷新和直接进入首页均可正常加载。
- 现有半身、全身、校准、游戏与本机隐私行为保持不变。

## 验证

发布前验证：

- 单元测试和类型检查通过。
- 使用 Pages 子路径完成生产构建。
- 构建产物包含首页、游戏脚本、CSS、`pose_landmarker.task` 和 MediaPipe WASM 文件。

发布后验证：

- 备用首页返回成功并显示“开始滑雪”。
- 模型、WASM、JavaScript 和 CSS 均可从备用域名加载。
- 手机能够进入页面并触发摄像头权限请求。

## 后续更换地址

- 仓库可以重命名，但 GitHub Pages 路径会随之改变，旧链接可能失效。
- 以后可以迁移到账号根地址 `https://liuyeyang2012-creator.github.io/`。
- 以后可以绑定独立域名，使网址与仓库名或托管平台解耦。

## 失败处理

- 如果 GitHub 账号尚未在浏览器登录，暂停创建仓库并请用户登录，不尝试读取或代填密码。
- 如果 Pages 构建失败，先检查 Actions 日志并修复构建或资源路径，不回退游戏功能。
- 如果 GitHub Pages 在某个手机网络也被拦截，保留当前部署，并评估独立域名或另一家 HTTPS 托管平台。
