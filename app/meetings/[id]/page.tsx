import { notFound } from 'next/navigation';

import { readMeetingDetail } from '@/lib/server/store';
import type { MeetingDetail } from '@/lib/types';

import { MeetingView } from './meeting-view';

export const dynamic = 'force-dynamic';

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: MeetingDetail;
  try {
    detail = await readMeetingDetail(id);
  } catch {
    notFound();
  }

  return <MeetingView initial={detail} />;
}
