import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import Link from "next/link";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Stock Vergelijker - Picqer vs Exact Online",
  description: "Voorraadvergelijking tussen Picqer en Exact Online",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-[family-name:var(--font-geist-sans)] antialiased`}
      >
        <div className="min-h-screen bg-background">
          <nav className="border-b bg-white">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="flex h-14 items-center justify-between">
                <div className="flex items-center gap-8">
                  <Link href="/" className="text-lg font-semibold">
                    Stock Vergelijker
                  </Link>
                  <div className="flex gap-4">
                    <Link
                      href="/"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Dashboard
                    </Link>
                    <Link
                      href="/mapping"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Mappings
                    </Link>
                    <Link
                      href="/instellingen"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Instellingen
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </nav>
          <main className="mx-auto px-4 sm:px-6 lg:px-8 py-8 max-w-[calc(100vw-2rem)]">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
