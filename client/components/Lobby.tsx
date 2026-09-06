'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { JoinOptions } from '@/hooks/useMediasoup';

interface LobbyProps {
  groupId: string;
  initialName: string;
  joining: boolean;
  onJoin: (options: JoinOptions) => void;
}

/**
 * Pre-join screen: camera preview, microphone/camera device pickers,
 * join-with-mic/camera toggles and the display name field.
 * @param {LobbyProps} props - Group id, name prefill, joining state and join handler.
 * @returns {JSX.Element} The lobby.
 */
export default function Lobby(props: LobbyProps) {
  const { groupId, initialName, joining, onJoin } = props;
  const [name, setName] = useState(initialName);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState('');
  const [videoDeviceId, setVideoDeviceId] = useState('');
  const [mediaError, setMediaError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  /**
   * Stops the current preview stream and releases the devices.
   * @returns {void}
   */
  const stopPreview = useCallback((): void => {
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
  }, []);

  /**
   * Starts the camera/microphone preview (honoring the selected camera) and
   * refreshes the device lists, whose labels need an active permission.
   * @returns {Promise<void>} Resolves when the preview runs or fails.
   */
  const startPreview = useCallback(async (): Promise<void> => {
    stopPreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true
      });
      previewStreamRef.current = stream;
      setMediaError(null);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMics(devices.filter((device) => device.kind === 'audioinput'));
      setCams(devices.filter((device) => device.kind === 'videoinput'));
    } catch {
      setMediaError('Camera/microphone unavailable or blocked — you can still join with them off.');
    }
  }, [videoDeviceId, stopPreview]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError('Camera/microphone needs a secure context (use localhost or HTTPS).');
      return;
    }
    startPreview();
    return () => stopPreview();
  }, [startPreview, stopPreview]);

  useEffect(() => {
    previewStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = camOn;
    });
  }, [camOn]);

  /**
   * Stops the preview and hands the chosen options to the join flow.
   * @returns {void}
   */
  function handleJoin(): void {
    const trimmedName = name.trim();
    if (!trimmedName || joining) {
      return;
    }
    stopPreview();
    onJoin({
      name: trimmedName,
      micOn: micOn && !mediaError,
      camOn: camOn && !mediaError,
      audioDeviceId: audioDeviceId || undefined,
      videoDeviceId: videoDeviceId || undefined
    });
  }

  return (
    <div className="lobby">
      <h1>Join group: {groupId}</h1>
      <div className="lobby-preview">
        <video ref={videoRef} autoPlay playsInline muted className="mirrored" />
        {!camOn && <div className="preview-off">Camera off</div>}
      </div>
      {mediaError && <div className="banner error">{mediaError}</div>}
      <div className="lobby-row">
        <button type="button" className={micOn ? 'control-btn' : 'control-btn off'} onClick={() => setMicOn(!micOn)}>
          Mic: {micOn ? 'on' : 'off'}
        </button>
        <button type="button" className={camOn ? 'control-btn' : 'control-btn off'} onClick={() => setCamOn(!camOn)}>
          Camera: {camOn ? 'on' : 'off'}
        </button>
      </div>
      <div className="lobby-row">
        <select value={audioDeviceId} onChange={(event) => setAudioDeviceId(event.target.value)}>
          <option value="">Default microphone</option>
          {mics.map((mic) => (
            <option key={mic.deviceId} value={mic.deviceId}>{mic.label || 'Microphone'}</option>
          ))}
        </select>
        <select value={videoDeviceId} onChange={(event) => setVideoDeviceId(event.target.value)}>
          <option value="">Default camera</option>
          {cams.map((cam) => (
            <option key={cam.deviceId} value={cam.deviceId}>{cam.label || 'Camera'}</option>
          ))}
        </select>
      </div>
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && handleJoin()}
      />
      <button type="button" className="join-btn" onClick={handleJoin} disabled={!name.trim() || joining}>
        {joining ? 'Joining…' : 'Enter the room'}
      </button>
    </div>
  );
}
