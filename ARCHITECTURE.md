# Architecture — State and Persistence

Atlas keeps state in three places, and which one a given piece of data lands in is a deliberate decision rather than an accident of whatever was easiest to reach for. The guiding question is always the same: if the user closes this and comes back on a different device tomorrow, should this still be here?

## The three layers

| Layer | Lives in | Survives navigation | Survives device switch | Example |
|---|---|---|---|---|
| Durable user data | Supabase (Postgres) | Yes | Yes | Height, age, body weight, gym logs, food entries, journal |
| Conversation state | Device `localStorage` | Yes | No | Mentor chat thread, health coach replies, orb assistant popups |
| Day-scoped cache | Supabase, keyed by date | Yes | Yes, same calendar day only | The daily briefing |

## Why conversation state stays on the device

An in-progress chat is working memory, not a record. If you ask the mentor something, tap over to the Gym tab to check a number, and come back, losing the thread would be infuriating, so it persists locally and the conversation is exactly where you left it. But that same thread showing up on your laptop a day later has no value, and syncing it would mean writing every keystroke of every throwaway exchange to the database for no benefit.

Local storage draws the line in the right place. It is durable enough to survive the thing users actually do many times a session (navigating away and back), and ephemeral enough that the database only ever holds things worth keeping. The jots and journal entries a user deliberately saves are a different category entirely, and those go to Postgres.

## Why the daily briefing is the exception

The briefing is the one piece of conversation-shaped content that does get persisted server-side, because it behaves like a record rather than a chat.

It is generated once per calendar day and cached against that date. Open the app again six hours later on a different device and you get the same briefing back rather than a freshly generated one. That matters for two reasons. Regenerating would produce a subtly different briefing each time, which quietly undermines the idea that it is *today's* reading of your data rather than one of many possible readings. And practically, a user who skims the briefing in the morning and wants to check a detail from it in the afternoon should be able to find it, not a replacement.

At the next day boundary it regenerates from scratch, picking up anything that changed in the meantime.

## The rule this comes down to

Put it in Postgres if losing it would lose something the user created or recorded. Put it in `localStorage` if it only needs to survive the next tap. Cache it server-side against a date when it needs to be stable and identical everywhere for a bounded window, which so far is the briefing and nothing else.
