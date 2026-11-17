import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'UpdatePilot · Software intelligence',
  description: 'A clear view of your Windows software. Review, approve, and verify every update.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
