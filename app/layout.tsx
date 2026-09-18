import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from './providers';

export const metadata: Metadata = {
  title: 'Installer Work Management',
  description: 'Installer Work Management Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
