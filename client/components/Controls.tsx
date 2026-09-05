'use client';

interface ControlsProps {
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeave: () => void;
}

/**
 * Renders the call control bar: microphone toggle, camera toggle and leave
 * button.
 * @param {ControlsProps} props - Current toggle states and click handlers.
 * @returns {JSX.Element} The control bar.
 */
export default function Controls(props: ControlsProps) {
  const { micOn, camOn, onToggleMic, onToggleCam, onLeave } = props;
  return (
    <div className="controls">
      <button type="button" className={micOn ? 'control-btn' : 'control-btn off'} onClick={onToggleMic}>
        {micOn ? 'Mute' : 'Unmute'}
      </button>
      <button type="button" className={camOn ? 'control-btn' : 'control-btn off'} onClick={onToggleCam}>
        {camOn ? 'Camera off' : 'Camera on'}
      </button>
      <button type="button" className="control-btn leave" onClick={onLeave}>
        Leave
      </button>
    </div>
  );
}
