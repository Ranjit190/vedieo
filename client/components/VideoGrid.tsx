'use client';

import PeerVideo from '@/components/PeerVideo';
import { RemotePeer } from '@/hooks/useMediasoup';

interface VideoGridProps {
  localStream: MediaStream | null;
  localName: string;
  remotePeers: RemotePeer[];
}

/**
 * Lays out the local preview and all remote participants in a responsive
 * grid.
 * @param {VideoGridProps} props - Local stream/name and remote peer list.
 * @returns {JSX.Element} The video grid.
 */
export default function VideoGrid(props: VideoGridProps) {
  const { localStream, localName, remotePeers } = props;
  return (
    <div className="video-grid">
      <PeerVideo stream={localStream} name={`${localName} (you)`} muted mirrored />
      {remotePeers.map((peer) => (
        <PeerVideo key={peer.peerId} stream={peer.stream} name={peer.name} />
      ))}
    </div>
  );
}
