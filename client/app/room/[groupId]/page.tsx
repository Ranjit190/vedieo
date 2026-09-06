'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Controls from '@/components/Controls';
import Lobby from '@/components/Lobby';
import VideoGrid from '@/components/VideoGrid';
import { JoinOptions, useMediasoup } from '@/hooks/useMediasoup';

/**
 * The call screen for one group: shows the lobby (name + device choices)
 * first, then the video grid with controls and an invite-link button.
 * @returns {JSX.Element} The room content.
 */
function RoomContent() {
  const params = useParams<{ groupId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const groupId = decodeURIComponent(params.groupId);
  const initialName = searchParams.get('name') || '';
  const [displayName, setDisplayName] = useState('');
  const [copied, setCopied] = useState(false);
  const { localStream, remoteTiles, peerStates, joined, joining, error, micOn, camOn, screenSharing, localScreenStream, join, leave, toggleMic, toggleCam, toggleScreenShare } = useMediasoup();

  /**
   * Joins the call with the lobby's choices.
   * @param {JoinOptions} options - Name, device ids and initial mic/cam state.
   * @returns {void}
   */
  function handleJoin(options: JoinOptions): void {
    setDisplayName(options.name);
    join(groupId, options);
  }

  /**
   * Copies the room's invite link so others can join with just their name.
   * @returns {void}
   */
  function copyInvite(): void {
    const inviteUrl = `${window.location.origin}/room/${encodeURIComponent(groupId)}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

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
        {joined && (
          <button type="button" className="invite-btn" onClick={copyInvite}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        )}
      </header>
      {error && <div className="banner error">{error}</div>}
      {!joined ? (
        <Lobby groupId={groupId} initialName={initialName} joining={joining} onJoin={handleJoin} />
      ) : (
        <>
          <VideoGrid
            localStream={localStream}
            localName={displayName}
            micOn={micOn}
            camOn={camOn}
            tiles={Array.from(remoteTiles.values())}
            peerStates={peerStates}
            screenSharing={screenSharing}
            localScreenStream={localScreenStream}
          />
          <Controls
            micOn={micOn}
            camOn={camOn}
            screenSharing={screenSharing}
            onToggleMic={toggleMic}
            onToggleCam={toggleCam}
            onToggleScreenShare={toggleScreenShare}
            onLeave={handleLeave}
          />
        </>
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
