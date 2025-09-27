import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "数字復唱ゲーム",
  description: "Reverse order memory typing game to train short-term memory"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-slate-950 text-slate-100">
        <div className="min-h-screen font-sans">{children}</div>
      </body>
    </html>
  );
}
