'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface PeerVideoProps {
  stream: MediaStream | null;
  name: string;
  muted?: boolean;
  mirrored?: boolean;
}

/**
 * Renders one participant tile: attaches the MediaStream to a video element,
 * starts playback explicitly and overlays the participant's name. When the
 * browser blocks unmuted autoplay, a tap-to-play overlay is shown instead of
 * failing silently.
 * @param {PeerVideoProps} props - Stream, display name and video options.
 * @returns {JSX.Element} The participant tile.
 */
export default function PeerVideo(props: PeerVideoProps) {
  const { stream, name, muted = false, mirrored = false } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

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
    <div className="peer-tile">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={mirrored ? 'mirrored' : ''}
      />
      <span className="peer-name">{name}</span>
      {blocked && (
        <button type="button" className="play-overlay" onClick={play}>
          ▶ Tap to play
        </button>
      )}
    </div>
  );
}
