import "./globals.css";

export const metadata = {
  title: "News Pulse",
  description: "News topic-clustering timeline",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
