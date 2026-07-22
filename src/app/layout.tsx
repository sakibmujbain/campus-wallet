import type { Metadata, Viewport } from "next";
import { RegisterSW } from "./register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus Wallet",
  description: "A student fintech platform on PostgreSQL — DBMS course project.",
  manifest: "/manifest.webmanifest",
  applicationName: "Campus Wallet",
  appleWebApp: { capable: true, title: "Campus Wallet", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1317" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
