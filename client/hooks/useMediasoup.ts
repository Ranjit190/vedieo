'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import RoomClient, { PeerAVState, RemoteTile } from '@/lib/RoomClient';
import { getSocket } from '@/lib/socket';

export type { PeerAVState, RemoteTile } from '@/lib/RoomClient';

/**
 * Options chosen in the lobby before joining a call.
 */
export interface JoinOptions {
  name: string;
  micOn: boolean;
  camOn: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}

/**
 * Builds getUserMedia audio constraints for an optional preferred device.
 * @param {string | undefined} deviceId - The preferred microphone device id.
 * @returns {MediaTrackConstraints | boolean} Constraints for getUserMedia.
 */
function audioConstraints(deviceId: string | undefined): MediaTrackConstraints | boolean {
  return deviceId ? { deviceId: { ideal: deviceId } } : true;
}

/**
 * Builds getUserMedia video constraints for an optional preferred device.
 * @param {string | undefined} deviceId - The preferred camera device id.
 * @returns {MediaTrackConstraints} Constraints for getUserMedia.
 */
function videoConstraints(deviceId: string | undefined): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) {
    constraints.deviceId = { ideal: deviceId };
  }
  return constraints;
}

/**
 * React hook that manages the full lifecycle of a group call: joining via
 * RoomClient with the lobby's device choices, producing mic/webcam/screen
 * tracks, tracking remote tiles, recovering the microphone when the audio
 * device changes (e.g. earphones plugged in) and exposing call controls.
 * @returns {object} Call state and control functions for the room UI.
 */
export function useMediasoup() {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteTiles, setRemoteTiles] = useState<Map<string, RemoteTile>>(new Map());
  const [peerStates, setPeerStates] = useState<Map<string, PeerAVState>>(new Map());
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const clientRef = useRef<RoomClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const deviceIdsRef = useRef<{ audio?: string; video?: string }>({});
  const micOnRef = useRef(false);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Replaces the localStream state (and ref) with a stream containing the
   * given tracks, so tiles re-attach and render the change.
   * @param {MediaStreamTrack[]} tracks - Tracks for the new stream.
   * @returns {void}
   */
  const setLocalTracks = useCallback((tracks: MediaStreamTrack[]): void => {
    const stream = tracks.length > 0 ? new MediaStream(tracks) : null;
    localStreamRef.current = stream;
    setLocalStream(stream);
  }, []);

  /**
   * Re-acquires the microphone (preferring the chosen device) and swaps it
   * into the live audio producer. Called when the audio device set changes,
   * e.g. earphones plugged in mid-call, so the voice keeps broadcasting.
   * @returns {Promise<void>} Resolves when the microphone is recovered.
   */
  const recoverMic = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client || !client.hasProducer('mic')) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(deviceIdsRef.current.audio)
      });
      const newTrack = stream.getAudioTracks()[0];
      newTrack.enabled = micOnRef.current;
      newTrack.addEventListener('ended', () => scheduleMicRecovery());
      await client.replaceTrack('mic', newTrack);
      const otherTracks = (localStreamRef.current?.getTracks() ?? []).filter((track) => {
        if (track.kind !== 'audio') {
          return true;
        }
        track.stop();
        return false;
      });
      setLocalTracks([...otherTracks, newTrack]);
    } catch (recoverError) {
      const message = recoverError instanceof Error ? recoverError.message : 'unknown error';
      console.error(`Microphone recovery failed: ${message}`);
    }
  }, [setLocalTracks]);

  /**
   * Debounces microphone recovery — devicechange can fire several times for
   * one physical plug/unplug.
   * @returns {void}
   */
  function scheduleMicRecovery(): void {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
    }
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      void recoverMic();
    }, 500);
  }

  /**
   * Acquires local media per the lobby choices and produces the tracks.
   * @param {RoomClient} client - The joined room client.
   * @param {JoinOptions} options - The lobby choices.
   * @returns {Promise<void>} Resolves when enabled tracks are producing.
   */
  const produceInitialTracks = useCallback(async (client: RoomClient, options: JoinOptions): Promise<void> => {
    if (!options.micOn && !options.camOn) {
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: options.micOn ? audioConstraints(options.audioDeviceId) : false,
      video: options.camOn ? videoConstraints(options.videoDeviceId) : false
    });
    setLocalTracks(stream.getTracks());
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];
    if (audioTrack) {
      audioTrack.addEventListener('ended', () => scheduleMicRecovery());
      await client.produceTrack('mic', audioTrack);
      micOnRef.current = true;
      setMicOn(true);
    }
    if (videoTrack) {
      await client.produceTrack('webcam', videoTrack);
      setCamOn(true);
    }
  }, [setLocalTracks]);

  /**
   * Joins a group call with the lobby's choices.
   * @param {string} groupId - The group id to join.
   * @param {JoinOptions} options - Name, device ids and initial mic/cam state.
   * @returns {Promise<void>} Resolves when joined or sets error state.
   */
  const join = useCallback(async (groupId: string, options: JoinOptions): Promise<void> => {
    if (clientRef.current) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera/microphone is blocked because this page is not a secure context. Open the app via http://localhost:3000 on this machine, or serve it over HTTPS for other devices.');
      return;
    }
    setJoining(true);
    setError(null);
    try {
      deviceIdsRef.current = { audio: options.audioDeviceId, video: options.videoDeviceId };
      const client = new RoomClient(getSocket(), {
        onTileUpdated: (tile) => {
          setRemoteTiles((previous) => new Map(previous).set(tile.tileKey, tile));
        },
        onTileRemoved: (tileKey) => {
          setRemoteTiles((previous) => {
            const next = new Map(previous);
            next.delete(tileKey);
            return next;
          });
        },
        onPeerStateChanged: (peerId, state) => {
          setPeerStates((previous) => new Map(previous).set(peerId, state));
        },
        onError: (message) => setError(message)
      });
      clientRef.current = client;
      await client.join(groupId, options.name);
      await produceInitialTracks(client, options);
      setJoined(true);
    } catch (joinError) {
      const message = joinError instanceof Error ? joinError.message : 'Failed to join the call';
      setError(message);
      clientRef.current?.leave();
      clientRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      setLocalTracks([]);
    } finally {
      setJoining(false);
    }
  }, [produceInitialTracks, setLocalTracks]);

  /**
   * Leaves the call and releases the camera, microphone and screen capture.
   * @returns {void}
   */
  const leave = useCallback((): void => {
    clientRef.current?.leave();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setLocalTracks([]);
    setRemoteTiles(new Map());
    setPeerStates(new Map());
    setJoined(false);
    setScreenSharing(false);
    micOnRef.current = false;
    setMicOn(false);
    setCamOn(false);
  }, [setLocalTracks]);

  /**
   * Toggles the microphone: pauses/resumes the producer, or acquires and
   * produces the mic on first enable when the user joined muted.
   * @returns {Promise<void>} Resolves when the state is applied.
   */
  const toggleMic = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    if (!client.hasProducer('mic')) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(deviceIdsRef.current.audio)
      });
      const track = stream.getAudioTracks()[0];
      track.addEventListener('ended', () => scheduleMicRecovery());
      await client.produceTrack('mic', track);
      setLocalTracks([...(localStreamRef.current?.getTracks() ?? []), track]);
      micOnRef.current = true;
      setMicOn(true);
      return;
    }
    const nextMicOn = !micOn;
    micOnRef.current = nextMicOn;
    setMicOn(nextMicOn);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = nextMicOn;
    });
    await client.setProducerPaused('mic', !nextMicOn);
  }, [micOn, setLocalTracks]);

  /**
   * Toggles the camera: pauses/resumes the producer, or acquires and
   * produces the webcam on first enable when the user joined camera-off.
   * @returns {Promise<void>} Resolves when the state is applied.
   */
  const toggleCam = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    if (!client.hasProducer('webcam')) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(deviceIdsRef.current.video)
      });
      const track = stream.getVideoTracks()[0];
      await client.produceTrack('webcam', track);
      setLocalTracks([...(localStreamRef.current?.getTracks() ?? []), track]);
      setCamOn(true);
      return;
    }
    const nextCamOn = !camOn;
    setCamOn(nextCamOn);
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = nextCamOn;
    });
    await client.setProducerPaused('webcam', !nextCamOn);
  }, [camOn, setLocalTracks]);

  /**
   * Stops an active screen share and tells the server to close its producer.
   * @returns {Promise<void>} Resolves when the share is stopped.
   */
  const stopScreenShare = useCallback(async (): Promise<void> => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
    await clientRef.current?.closeProducer('screen');
  }, []);

  /**
   * Starts or stops sharing the screen. The share also stops automatically
   * when the user clicks the browser's own "Stop sharing" bar.
   * @returns {Promise<void>} Resolves when the state is applied.
   */
  const toggleScreenShare = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client) {
      return;
    }
    if (screenSharing) {
      await stopScreenShare();
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 } },
        audio: false
      });
      const track = displayStream.getVideoTracks()[0];
      track.contentHint = 'detail';
      track.addEventListener('ended', () => void stopScreenShare());
      screenStreamRef.current = displayStream;
      await client.produceTrack('screen', track);
      setScreenSharing(true);
    } catch (shareError) {
      if (shareError instanceof Error && shareError.name !== 'NotAllowedError') {
        setError(`Screen share failed: ${shareError.message}`);
      }
    }
  }, [screenSharing, stopScreenShare]);

  useEffect(() => {
    if (!joined) {
      return;
    }
    const handler = () => scheduleMicRecovery();
    navigator.mediaDevices?.addEventListener?.('devicechange', handler);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', handler);
    };
    // scheduleMicRecovery is stable across renders (uses refs only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);

  useEffect(() => {
    return () => {
      clientRef.current?.leave();
      clientRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    };
  }, []);

  return {
    localStream,
    remoteTiles,
    peerStates,
    joined,
    joining,
    error,
    micOn,
    camOn,
    screenSharing,
    join,
    leave,
    toggleMic,
    toggleCam,
    toggleScreenShare
  };
}
