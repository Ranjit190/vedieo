import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Group Video Call",
  description: "Group video calling with mediasoup",
};

/**
 * Root layout wrapping every page of the app.
 * @param {LayoutProps<"/">} props - The layout props containing children.
 * @returns {JSX.Element} The HTML document shell.
 */
export default function RootLayout(props: LayoutProps<"/">) {
  const { children } = props;
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
