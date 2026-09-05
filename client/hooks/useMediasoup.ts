'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import RoomClient from '@/lib/RoomClient';
import { getSocket } from '@/lib/socket';

/**
 * A remote participant rendered in the video grid.
 */
export interface RemotePeer {
  peerId: string;
  name: string;
  stream: MediaStream;
}

/**
 * React hook that manages the full lifecycle of a group call: capturing
 * local media, joining via RoomClient, tracking remote peers and exposing
 * mute/camera/leave controls.
 * @returns {object} Call state and control functions for the room UI.
 */
export function useMediasoup() {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<Map<string, RemotePeer>>(new Map());
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const clientRef = useRef<RoomClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  /**
   * Joins a group call: captures camera/microphone, creates the RoomClient
   * and completes the mediasoup join flow.
   * @param {string} groupId - The group id to join.
   * @param {string} name - The user's display name.
   * @returns {Promise<void>} Resolves when joined or sets error state.
   */
  const join = useCallback(async (groupId: string, name: string): Promise<void> => {
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      const client = new RoomClient(getSocket(), {
        onRemoteStream: (peerId, peerName, peerStream) => {
          setRemotePeers((previous) => {
            const next = new Map(previous);
            next.set(peerId, { peerId, name: peerName, stream: peerStream });
            return next;
          });
        },
        onPeerLeft: (peerId) => {
          setRemotePeers((previous) => {
            const next = new Map(previous);
            next.delete(peerId);
            return next;
          });
        },
        onError: (message) => setError(message)
      });
      clientRef.current = client;
      await client.join(groupId, name, stream);
      setJoined(true);
    } catch (joinError) {
      const message = joinError instanceof Error ? joinError.message : 'Failed to join the call';
      setError(message);
      clientRef.current?.leave();
      clientRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    } finally {
      setJoining(false);
    }
  }, []);

  /**
   * Leaves the call and releases the camera and microphone.
   * @returns {void}
   */
  const leave = useCallback((): void => {
    clientRef.current?.leave();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemotePeers(new Map());
    setJoined(false);
  }, []);

  /**
   * Toggles the microphone on/off, pausing the audio producer.
   * @returns {Promise<void>} Resolves when the state is applied.
   */
  const toggleMic = useCallback(async (): Promise<void> => {
    const nextMicOn = !micOn;
    setMicOn(nextMicOn);
    await clientRef.current?.setProducerPaused('audio', !nextMicOn);
  }, [micOn]);

  /**
   * Toggles the camera on/off, pausing the video producer and disabling the
   * local track so the self-view goes dark too.
   * @returns {Promise<void>} Resolves when the state is applied.
   */
  const toggleCam = useCallback(async (): Promise<void> => {
    const nextCamOn = !camOn;
    setCamOn(nextCamOn);
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = nextCamOn;
    });
    await clientRef.current?.setProducerPaused('video', !nextCamOn);
  }, [camOn]);

  useEffect(() => {
    return () => {
      clientRef.current?.leave();
      clientRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    };
  }, []);

  return { localStream, remotePeers, joined, joining, error, micOn, camOn, join, leave, toggleMic, toggleCam };
}
