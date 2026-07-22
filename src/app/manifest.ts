import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Campus Wallet",
    short_name: "Wallet",
    description: "A student fintech platform on PostgreSQL.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c1317",
    theme_color: "#0c8577",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
