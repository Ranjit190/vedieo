'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Controls from '@/components/Controls';
import VideoGrid from '@/components/VideoGrid';
import { useMediasoup } from '@/hooks/useMediasoup';

/**
 * The call screen for one group: joins the group on mount, renders the
 * video grid of all participants and the control bar.
 * @returns {JSX.Element} The room content.
 */
function RoomContent() {
  const params = useParams<{ groupId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const groupId = decodeURIComponent(params.groupId);
  const name = searchParams.get('name') || '';
  const joinAttempted = useRef(false);
  const { localStream, remotePeers, joined, joining, error, micOn, camOn, join, leave, toggleMic, toggleCam } = useMediasoup();

  useEffect(() => {
    if (!name) {
      router.replace('/');
      return;
    }
    if (!joinAttempted.current) {
      joinAttempted.current = true;
      join(groupId, name);
    }
  }, [groupId, name, join, router]);

  /**
   * Leaves the call and returns to the landing page.
   * @returns {void}
   */
  function handleLeave(): void {
    leave();
    router.push('/');
  }

  return (
    <main className="room">
      <header className="room-header">
        <h2>Group: {groupId}</h2>
        <span>{remotePeers.size + (joined ? 1 : 0)} participant(s)</span>
      </header>
      {error && <div className="banner error">{error}</div>}
      {joining && <div className="banner">Joining the call…</div>}
      <VideoGrid
        localStream={localStream}
        localName={name}
        remotePeers={Array.from(remotePeers.values())}
      />
      {joined && (
        <Controls
          micOn={micOn}
          camOn={camOn}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
          onLeave={handleLeave}
        />
      )}
    </main>
  );
}

/**
 * Room page wrapper providing the Suspense boundary required by
 * useSearchParams during prerendering.
 * @returns {JSX.Element} The room page.
 */
export default function RoomPage() {
  return (
    <Suspense fallback={<div className="banner">Loading…</div>}>
      <RoomContent />
    </Suspense>
  );
}
