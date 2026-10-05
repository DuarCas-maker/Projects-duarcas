import type { Metadata } from "next";
import "./globals.css";
import "./project-os.css";

export const metadata: Metadata = {
  title: "Project OS · Centro de mando personal",
  description: "Estado, contexto, tiempo y siguiente acción para todos tus proyectos.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
