'use client';

import PeerVideo from '@/components/PeerVideo';
import { PeerAVState, RemoteTile } from '@/hooks/useMediasoup';

interface VideoGridProps {
  localStream: MediaStream | null;
  localName: string;
  micOn: boolean;
  camOn: boolean;
  tiles: RemoteTile[];
  peerStates: Map<string, PeerAVState>;
}

/**
 * Lays out the local preview and every remote tile (peer cameras and screen
 * shares) in a responsive grid. Muted peers show an avatar and a muted-mic
 * badge instead of a black rectangle; screen shares span the full row.
 * @param {VideoGridProps} props - Local state and remote tiles with per-peer mute states.
 * @returns {JSX.Element} The video grid.
 */
export default function VideoGrid(props: VideoGridProps) {
  const { localStream, localName, micOn, camOn, tiles, peerStates } = props;
  return (
    <div className="video-grid">
      <PeerVideo
        stream={localStream}
        name={`${localName} (you)`}
        muted
        mirrored
        micMuted={!micOn}
        camOff={!camOn}
      />
      {tiles.map((tile) => {
        const state = peerStates.get(tile.peerId);
        return (
          <PeerVideo
            key={tile.tileKey}
            stream={tile.stream}
            name={tile.isScreen ? `${tile.name} (screen)` : tile.name}
            isScreen={tile.isScreen}
            micMuted={!tile.isScreen && Boolean(state?.micMuted)}
            camOff={!tile.isScreen && Boolean(state?.camOff)}
          />
        );
      })}
    </div>
  );
}
