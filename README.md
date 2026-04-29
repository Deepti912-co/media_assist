<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your app

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set `VITE_GEMINI_API_KEY` in your environment (for Vercel, add it in **Project Settings → Environment Variables** for Production/Preview/Development)
3. Run the app:
   `npm run dev`


## Live Voice Architecture (Recommended)

For production voice conversation, use a strict streaming chain:

`Mic → Frontend stream (WebRTC/WebSocket) → Backend broker (persistent session manager) → Gemini Live API → Audio stream back to frontend → User playback`.

See `VOICE_FLOW_SPEC.md` for the exact layer responsibilities, event contract, and security rules.
