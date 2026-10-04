import type { Metadata } from 'next';
import { ExtensionConnect } from '@/components/extension-connect';

export const metadata: Metadata = { title: 'Connect the extension' };

export default function ExtensionConnectPage() {
  return <ExtensionConnect />;
}
