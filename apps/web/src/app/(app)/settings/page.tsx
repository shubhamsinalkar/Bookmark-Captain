import type { Metadata } from 'next';
import Link from 'next/link';
import { ConnectedDevices } from '@/components/settings/connected-devices';
import { PlatformConnections } from '@/components/settings/platform-connections';
import { buttonSecondary, hint } from '@/components/ui/styles';

export const metadata: Metadata = { title: 'Settings' };

const section = 'grid gap-x-10 gap-y-4 border-t border-rule py-8 sm:grid-cols-[13rem_1fr]';

export default function SettingsPage() {
  return (
    <div>
      <h1 className="pb-8 text-2xl font-bold tracking-tight font-stretch-112%">Settings</h1>

      <section id="platforms" className={section}>
        <div className="space-y-1">
          <h2 className="font-semibold">Platforms</h2>
          <p className={hint}>
            Bring in posts you save on other sites. New saves keep arriving on their own.
          </p>
        </div>
        <PlatformConnections />
      </section>

      <section className={section}>
        <div className="space-y-1">
          <h2 className="font-semibold">Chrome extension</h2>
          <p className={hint}>Sync your browser bookmarks automatically.</p>
        </div>
        <div className="space-y-4">
          <p className="max-w-prose text-sm leading-relaxed">
            The extension imports your browser bookmarks and keeps them in sync as you add, edit or
            remove them.
          </p>
          <Link href="/extension/connect" className={buttonSecondary}>
            Connect the extension
          </Link>
        </div>
      </section>

      <section className={section}>
        <div className="space-y-1">
          <h2 className="font-semibold">Connected devices</h2>
          <p className={hint}>
            Extensions and apps that can add to your bookmarks. Disconnect any you don&apos;t
            recognise.
          </p>
        </div>
        <ConnectedDevices />
      </section>
    </div>
  );
}
