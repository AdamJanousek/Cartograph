import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { themeScript } from "@/components/theme-script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cartograph",
  description: "A dependency map of a TypeScript or JavaScript repository.",
};

// Clerk's components read the app's own tokens, so sign-in, the org switcher and
// the user menu follow the theme control along with everything else.
const clerkAppearance = {
  variables: {
    colorPrimary: "var(--accent)",
    colorPrimaryForeground: "var(--accent-text)",
    colorBackground: "var(--surface)",
    colorForeground: "var(--text)",
    colorMutedForeground: "var(--text-muted)",
    colorNeutral: "var(--text)",
    colorBorder: "var(--border)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--text)",
    fontFamily: "var(--font-geist-sans)",
    fontSize: "13px",
    borderRadius: "4px",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The head script sets data-theme before React hydrates.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">
        <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>
      </body>
    </html>
  );
}
