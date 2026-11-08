import type {Metadata} from 'next';
import './globals.css';
export const metadata: Metadata = {
    title: 'Fieldnotes · Tabularis Neon Lab',
    description: 'A focused place for research, ideas, and everything worth keeping.',
};
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
