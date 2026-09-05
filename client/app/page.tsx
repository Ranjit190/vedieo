'use client';

import { SubmitEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Landing page: lets the user enter a group id and display name, then
 * navigates to the call room for that group.
 * @returns {JSX.Element} The join form.
 */
export default function Home() {
  const router = useRouter();
  const [groupId, setGroupId] = useState('');
  const [name, setName] = useState('');

  /**
   * Navigates to the room page with the entered group id and name.
   * @param {SubmitEvent<HTMLFormElement>} event - The form submit event.
   * @returns {void}
   */
  function handleSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmedGroupId = groupId.trim();
    const trimmedName = name.trim();
    if (!trimmedGroupId || !trimmedName) {
      return;
    }
    router.push(`/room/${encodeURIComponent(trimmedGroupId)}?name=${encodeURIComponent(trimmedName)}`);
  }

  return (
    <main className="landing">
      <div className="landing-card">
        <h1>Group Video Call</h1>
        <p>Enter a group id to join everyone in that group.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <input
            type="text"
            placeholder="Group id (e.g. team-standup)"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            required
          />
          <button type="submit">Join group</button>
        </form>
      </div>
    </main>
  );
}
