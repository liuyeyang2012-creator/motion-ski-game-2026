import type { Metadata } from "next";
import { GameClient } from "./game-client";

export const metadata: Metadata = { title: "体感滑雪", description: "手机体感滑雪小游戏" };

export default function Home() {
  return <GameClient />;
}
