import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "体感滑雪", description: "面向久坐办公人群的手机体感滑雪小游戏" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
