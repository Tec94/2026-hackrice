import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Chartroom — Learn to read a chart",
  description:
    "A training environment for practising chart reasoning on historical replays with a voice coach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ground">{children}</body>
    </html>
  );
}
