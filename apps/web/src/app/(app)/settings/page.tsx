import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConnectedDevices } from '@/components/settings/connected-devices';
import { PlatformConnections } from '@/components/settings/platform-connections';
import { PlatformLogo } from '@/components/ui/platform-logo';
import { buttonSecondary, hint, pageTitle, panel } from '@/components/ui/styles';
import { ThemePicker } from '@/components/ui/theme-picker';

export const metadata: Metadata = { title: 'Settings' };

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="grid scroll-mt-24 gap-x-12 gap-y-4 border-t border-rule py-9 lg:grid-cols-[16rem_minmax(0,1fr)]"
    >
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className={`${hint} max-w-sm`}>{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="max-w-5xl">
      <header className="pb-8">
        <h1 className={pageTitle}>Settings</h1>
        <p className={`${hint} mt-1`}>
          Choose where your saves come from and which devices can add them.
        </p>
      </header>

      <Section
        id="platforms"
        title="Platforms"
        description="Bring in the posts you save on other sites. New saves keep arriving on their own."
      >
        <PlatformConnections />
      </Section>

      <Section
        title="Chrome extension"
        description="Keeps your browser bookmarks in sync, and reads your saved lists on other sites."
      >
        <div className={`${panel} flex flex-wrap items-center gap-4 p-5`}>
          <PlatformLogo platform="browser" size={44} />
          <div className="min-w-[12rem] flex-1">
            <p className="font-semibold">Bookmark Captain for Chrome</p>
            <p className={`${hint} mt-0.5 max-w-prose`}>
              Imports your browser bookmarks, then follows every bookmark you add, edit or remove.
            </p>
          </div>
          <Link href="/extension/connect" className={buttonSecondary}>
            Connect the extension
          </Link>
        </div>
      </Section>

      <Section
        title="Connected devices"
        description="Extensions and apps that can add to your bookmarks. Disconnect any you don’t recognise."
      >
        <ConnectedDevices />
      </Section>

      <Section
        id="appearance"
        title="Appearance"
        description="Light, dark, or match your device. Remembered in this browser."
      >
        <ThemePicker />
      </Section>
    </div>
  );
}
