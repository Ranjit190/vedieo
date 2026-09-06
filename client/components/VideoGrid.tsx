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
  screenSharing: boolean;
  localScreenStream: MediaStream | null;
}

interface StageProps {
  localStream: MediaStream | null;
  localName: string;
  micOn: boolean;
  camOn: boolean;
  screenTile: RemoteTile | null;
  camTiles: RemoteTile[];
  peerStates: Map<string, PeerAVState>;
}

/**
 * Renders one remote tile with its owner's mute state applied.
 * @param {RemoteTile} tile - The remote tile.
 * @param {Map<string, PeerAVState>} peerStates - Per-peer mute states.
 * @returns {JSX.Element} The tile element.
 */
function renderRemoteTile(tile: RemoteTile, peerStates: Map<string, PeerAVState>) {
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
}

/**
 * The main stage: a shared screen when one is active, otherwise the remote
 * cameras, otherwise the user's own camera with a waiting hint.
 * @param {StageProps} props - Stage content and mute states.
 * @returns {JSX.Element} The stage element.
 */
function Stage(props: StageProps) {
  const { localStream, localName, micOn, camOn, screenTile, camTiles, peerStates } = props;
  if (screenTile) {
    return <div className="stage stage-screen">{renderRemoteTile(screenTile, peerStates)}</div>;
  }
  if (camTiles.length > 0) {
    return (
      <div className={camTiles.length === 1 ? 'stage stage-grid single' : 'stage stage-grid'}>
        {camTiles.map((tile) => renderRemoteTile(tile, peerStates))}
      </div>
    );
  }
  return (
    <div className="stage stage-self">
      <PeerVideo
        stream={localStream}
        name={`${localName} (you)`}
        muted
        mirrored
        micMuted={!micOn}
        camOff={!camOn}
      />
      <span className="waiting-hint">Waiting for others to join…</span>
    </div>
  );
}

/**
 * The call layout: a full-size stage behind, a thumbnail strip when a screen
 * share holds the stage, and floating bottom-right tiles — your own camera
 * (picture-in-picture) and, while presenting, a square live preview of the
 * shared screen.
 * @param {VideoGridProps} props - Local state, remote tiles and mute states.
 * @returns {JSX.Element} The call layout.
 */
export default function VideoGrid(props: VideoGridProps) {
  const { localStream, localName, micOn, camOn, tiles, peerStates, screenSharing, localScreenStream } = props;
  const screenTiles = tiles.filter((tile) => tile.isScreen);
  const camTiles = tiles.filter((tile) => !tile.isScreen);
  const screenTile = screenTiles[0] ?? null;
  const stripTiles = screenTile ? [...screenTiles.slice(1), ...camTiles] : [];
  const alone = tiles.length === 0;
  return (
    <div className="stage-wrap">
      {stripTiles.length > 0 && (
        <div className="thumb-strip">
          {stripTiles.map((tile) => renderRemoteTile(tile, peerStates))}
        </div>
      )}
      <Stage
        localStream={localStream}
        localName={localName}
        micOn={micOn}
        camOn={camOn}
        screenTile={screenTile}
        camTiles={camTiles}
        peerStates={peerStates}
      />
      <div className="float-tiles">
        {screenSharing && localScreenStream && (
          <div className="screen-preview">
            <PeerVideo stream={localScreenStream} name="Your screen" muted isScreen />
            <span className="presenting-badge">You are presenting</span>
          </div>
        )}
        {!alone && (
          <div className="self-view">
            <PeerVideo
              stream={localStream}
              name={`${localName} (you)`}
              muted
              mirrored
              micMuted={!micOn}
              camOff={!camOn}
            />
          </div>
        )}
      </div>
    </div>
  );
}
