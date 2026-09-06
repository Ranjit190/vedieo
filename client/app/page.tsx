'use client';

import { SubmitEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Landing page: lets the user enter a group id, then navigates to that
 * group's room where the lobby collects their name and device choices.
 * @returns {JSX.Element} The join form.
 */
export default function Home() {
  const router = useRouter();
  const [groupId, setGroupId] = useState('');

  /**
   * Navigates to the room page for the entered group id.
   * @param {SubmitEvent<HTMLFormElement>} event - The form submit event.
   * @returns {void}
   */
  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmedGroupId = groupId.trim();
    if (!trimmedGroupId) {
      return;
    }
    router.push(`/room/${encodeURIComponent(trimmedGroupId)}`);
  }

  return (
    <main className="landing">
      <div className="landing-card">
        <h1>Group Video Call</h1>
        <p>Enter a group id to join everyone in that group.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Group id (e.g. team-standup)"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            required
          />
          <button type="submit">Continue</button>
        </form>
      </div>
    </main>
  );
}
