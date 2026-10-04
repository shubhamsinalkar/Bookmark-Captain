import Link from 'next/link';
import { BrandMark } from '@/components/ui/brand';
import { buttonSecondary, hint } from '@/components/ui/styles';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <BrandMark className="mb-2 h-8 w-auto" />
      <h1 className="text-2xl font-bold tracking-tight font-stretch-112%">Page not found</h1>
      <p className={hint}>This address doesn&apos;t match any page.</p>
      <Link href="/inbox" className={`${buttonSecondary} mt-3`}>
        Go to your inbox
      </Link>
    </main>
  );
}
