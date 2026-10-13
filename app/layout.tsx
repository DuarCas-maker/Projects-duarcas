import type { Metadata } from "next";
import "./globals.css";
import "./project-os.css";
import "./notebook.css";

export const metadata: Metadata = {
  title: "Project OS · Centro de mando personal",
  description: "Estado, contexto, tiempo y siguiente acción para todos tus proyectos.",
  applicationName: "Project OS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Project OS",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
