'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface PeerVideoProps {
  stream: MediaStream | null;
  name: string;
  muted?: boolean;
  mirrored?: boolean;
  micMuted?: boolean;
  camOff?: boolean;
  isScreen?: boolean;
}

/**
 * Renders a muted-microphone icon shown next to a participant's name.
 * @returns {JSX.Element} The icon.
 */
function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-label="muted">
      <path d="M19 11a7 7 0 0 1-.9 3.4l-1.5-1.5A5 5 0 0 0 17 11h2zM12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v1.2l5.9 5.9c-.8.56-1.8.9-2.9.9zM3.3 2.3 21.7 20.7l-1.4 1.4-4.5-4.5A7 7 0 0 1 13 18v3h-2v-3a7 7 0 0 1-6-7h2a5 5 0 0 0 6.8 4.7l-1.6-1.6A3 3 0 0 1 9 11v-.8L1.9 3.7l1.4-1.4z" />
    </svg>
  );
}

/**
 * Renders one participant tile: attaches the MediaStream to a video element,
 * starts playback explicitly and overlays the participant's name. When the
 * camera is off (or the peer has no video at all) an avatar with the
 * participant's initial is shown instead of a black rectangle, and a
 * muted-mic badge appears next to the name while their microphone is muted.
 * @param {PeerVideoProps} props - Stream, display name and tile state.
 * @returns {JSX.Element} The participant tile.
 */
export default function PeerVideo(props: PeerVideoProps) {
  const { stream, name, muted = false, mirrored = false, micMuted = false, camOff = false, isScreen = false } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  const hasVideo = Boolean(stream && stream.getVideoTracks().length > 0);
  const showAvatar = !isScreen && (camOff || !hasVideo);
  const initial = (name.trim().charAt(0) || '?').toUpperCase();

  /**
   * Attempts to start playback, tracking whether the browser blocked it.
   * @returns {void}
   */
  const play = useCallback((): void => {
    videoRef.current
      ?.play()
      .then(() => setBlocked(false))
      .catch((error: Error) => {
        console.warn(`Playback blocked for "${name}": ${error.message}`);
        setBlocked(true);
      });
  }, [name]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      play();
    }
  }, [stream, play]);

  return (
    <div className={isScreen ? 'peer-tile screen-tile' : 'peer-tile'}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={mirrored ? 'mirrored' : ''}
      />
      {showAvatar && (
        <div className="avatar-overlay">
          <div className="avatar-circle">{initial}</div>
          <span className="avatar-hint">Camera off</span>
        </div>
      )}
      <span className="peer-name">
        {micMuted && <MicOffIcon />}
        {name}
      </span>
      {blocked && (
        <button type="button" className="play-overlay" onClick={play}>
          ▶ Tap to play
        </button>
      )}
    </div>
  );
}
