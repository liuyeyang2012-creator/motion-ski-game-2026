"use client";

import { useEffect, useRef } from "react";
import { AppController } from "../../src/app/app-controller";
import "../../src/style.css";

export function GameClient() {
  const screenRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (screenRef.current) new AppController({ root: screenRef.current, storage: localStorage }).start();
  }, []);

  return (
    <main className="app-shell">
      <video id="camera-preview" muted playsInline aria-label="摄像头取景" />
      <canvas id="game-canvas" width="720" height="1280" aria-label="滑雪游戏画面" />
      <section id="screen-layer" ref={screenRef} />
      <p className="sr-only" role="status" aria-live="polite">准备开始</p>
    </main>
  );
}
