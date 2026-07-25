import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, Space_Mono } from "next/font/google";
import { RegisterSW } from "./register-sw";
import { AppBar } from "@/components/app-bar";
import { MarginDoodles } from "@/components/margin-doodles";
import "./globals.css";

// Editorial display (headings + the balance), clean body workhorse, on-brand mono.
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-display", display: "swap" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });
const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Campus Wallet",
  description: "A student fintech platform on PostgreSQL — DBMS course project.",
  manifest: "/manifest.webmanifest",
  applicationName: "Campus Wallet",
  appleWebApp: { capable: true, title: "Campus Wallet", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f2" },
    { media: "(prefers-color-scheme: dark)", color: "#16150f" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before paint so there's no light→dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}` }} />
      </head>
      <body>
        <MarginDoodles />
        <AppBar />
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
