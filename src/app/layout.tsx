import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "gatu.digital | Captação e agendamentos",
  description: "Editor de quiz e planejamento de agendamentos da gatu.digital.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
