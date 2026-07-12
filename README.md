# 体感滑雪

面向久坐办公人群的手机网页体感小游戏。摄像头画面只在浏览器本机用于姿态识别，不上传、不保存。

## 开发

```powershell
npm install
npm run dev
npm test -- --run
npm run typecheck
npm run build
```

## 姿态模型

- 运行库：Google MediaPipe Tasks Vision，Apache-2.0 License。
- 模型：Pose Landmarker Lite float16。
- 官方来源：`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
- 模型与 WASM 文件随站点从同源路径加载；运行时不依赖第三方 CDN。

产品目前处于第一版开发阶段，完整控制和真机测试说明将在端到端验收任务中补充。
