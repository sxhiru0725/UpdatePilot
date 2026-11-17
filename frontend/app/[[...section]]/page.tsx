import { Workspace } from '@/components/workspace';
import { notFound } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const parts = section ?? [];
  const pages = ['applications', 'updates', 'security', 'history', 'settings'];
  if (
    parts.length &&
    (!pages.includes(parts[0]) ||
      parts.length > 2 ||
      (parts.length === 2 &&
        (parts[0] !== 'applications' ||
          !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(parts[1]))))
  )
    notFound();
  return <Workspace section={section ?? []} />;
}
