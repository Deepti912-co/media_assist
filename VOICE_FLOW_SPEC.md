# Real-Time Voice Conversation Flow (Frontend → Backend → Gemini Live)

This project should use the following **single conversational path** for live voice sessions:

1. **User mic input**
2. **Frontend streams audio frames** over **WebRTC or WebSocket**
3. **Backend receives and brokers the stream** (authentication, session management, safety policy, logging)
4. **Backend keeps a persistent Gemini Live session** and forwards user audio/text events
5. **Gemini Live returns streaming audio responses** to backend
6. **Backend relays response audio stream** to frontend
7. **Frontend plays streamed audio to user**

---

## Required Runtime Responsibilities by Layer

### Frontend
- Capture microphone PCM/Opus chunks.
- Send chunks continuously to backend (`/ws/live` or WebRTC data/audio channel).
- Receive assistant audio chunks and play with low latency.
- Handle push-to-talk or always-on VAD state in UI.

### Backend (Important Layer)
- Issue short-lived client auth tokens (never expose raw provider key in browser).
- Create and retain one persistent Gemini Live session per conversation.
- Enforce guardrails (rate limits, abuse checks, emergency handling hooks).
- Forward upstream/downstream events with backpressure controls.
- Persist transcripts/events for auditability.

### Gemini Live API
- Consume realtime user input stream.
- Emit incremental model text/audio output.
- Keep context in-session so follow-up turns are coherent.

---

## Event Contract (WebSocket Example)

Client → Backend events:
- `session.start` `{ language, voice, patientContext }`
- `audio.chunk` `{ chunkBase64, mimeType, sampleRateHz, seq }`
- `user.text` `{ text }` (optional typed fallback)
- `session.stop` `{ reason }`

Backend → Client events:
- `session.ready` `{ conversationId }`
- `assistant.audio.chunk` `{ chunkBase64, mimeType, seq }`
- `assistant.text.partial` `{ text, seq }`
- `assistant.text.final` `{ text }`
- `error` `{ code, message }`
- `session.ended` `{ reason }`

---

## Non-Negotiable Security Rules

- Do not call Gemini Live directly from browser with a long-lived API key.
- Keep provider credentials only on server.
- Validate message schema and sequence numbers.
- Apply per-session and per-IP rate limits.
- Close idle sessions and reclaim resources.

---

## Reference Sequence

```text
Mic → Frontend encoder → WS/WebRTC → Backend session broker → Gemini Live
Gemini Live audio/text stream → Backend relay → Frontend player → User
```

This is the exact conversation flow to implement for production-grade voice UX.
