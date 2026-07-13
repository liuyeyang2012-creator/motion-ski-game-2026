# 体感滑雪

面向久坐办公人群的手机网页体感小游戏。摄像头画面只在浏览器本机用于姿态识别，不上传、不保存。

## 在线试玩

- GitHub Pages 备用地址：`https://liuyeyang2012-creator.github.io/motion-ski-game-2026/`
- 如果托管平台拦截当前网络，请优先尝试备用地址。

## 开发

```powershell
npm install
npm run dev
npm test -- --run
npm run typecheck
npm run build
```

开发环境可使用两条校准模拟入口：

- `?poseFixture=seated-soft-success`：模拟腿脚不入镜和短暂丢帧，并自动完成半身柔性校准。
- `?poseFixture=seated-stuck-action`：停在第一个动作并显示“使用推荐灵敏度”。

## 姿态模型

- 运行库：Google MediaPipe Tasks Vision，Apache-2.0 License。
- 模型：Pose Landmarker Lite float16。
- 官方来源：`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
- 模型与 WASM 文件随站点从同源路径加载；运行时不依赖第三方 CDN。

## 使用方式

1. 用手机竖屏打开网页并允许前置摄像头。
2. 选择坐姿或站立模式，再选择 30 秒、2 分钟或无限局。
3. 按轮廓提示进入画面并保持稳定，完成自动校准。
4. 左右侧身切换雪道，轻轻低头穿过旗门，双手抬起获得能量；站立模式还支持下蹲。

开始前请清理身边障碍物。游戏不需要跳跃、快速扭头、后仰或原地旋转；身体不适时请立即停止。

## 隐私与本地数据

- 摄像头视频帧、人体关键点和逐帧动作不会上传或持久化。
- 浏览器只保存最高分、最高连击、累计活动时间、上次模式选择，以及半身/全身各自的校准数值。
- 清除浏览器站点数据会同时清除这些本地记录。

## 验证

```powershell
npm test -- --run
npm run typecheck
npm run build
npm run test:e2e
```

真机验收至少覆盖一台低性能安卓手机、一台主流安卓手机和一台近期 iPhone，并分别检查正常/偏暗光线、坐姿/站立取景、切换后台、横竖屏和摄像头拒绝场景。
