# ⬡ StackRoom

> **Your team codes together. Gemini codes with you.**

StackRoom is a real-time collaborative IDE that runs entirely in the browser. Multiple developers join a shared workspace by role, see each other's live edits, and speak voice commands that Gemini executes instantly — updating code across every teammate's editor simultaneously.

Built for the **[Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com)** · Powered by **Gemini Live API** · Hosted on **Google Cloud Run**

---

##  Features

###  Real-Time Collaboration
- **Role-based workspaces** — join as Frontend, Backend, Fullstack, or Viewer
- **Live code sync** — every keystroke synced across all connected users via Socket.IO
- **Live cursors** — see where your teammates are editing in real time
- **Team chat** — built-in chat panel with typing indicators
- **Spectate mode** — watch any teammate's editor live with one click
- **File explorer** — create, delete, and rename files collaboratively

### ✦ Gemini Voice Director
- Speak a natural language instruction from within the workspace
- Gemini reads the entire codebase, returns structured file edits
- Changes propagate to **every teammate's Monaco editor simultaneously**
- Uses **Gemini Live API** (`BidiGenerateContent`) for real-time bidirectional streaming
- Falls back to REST API seamlessly if Live API is unavailable
- Text input fallback for silent environments

### ✦ Gemini Preview Agent 
- Open your running app in a new tab
- A floating **Gemini overlay** is automatically injected into the live preview
- Speak UI commands while **looking at your own running app**: *"move the button to the top right"*, *"make the navbar dark"*, *"add a gradient to the hero section"*
- Gemini patches the source files, broadcasts changes to all teammates' editors, and **reloads the preview instantly**
- Static HTML/CSS projects: hot-update in ~300ms (no restart)
- React/Vite projects: full rebuild with auto-reload

### ✦ Gemini AI Panel
- **Ask** — ask questions about your code with full file context
- **Generate** — generate code from a description
- **Fix** — paste an error log, Gemini fixes it
- **Explain** — understand what any code does
- Streaming SSE responses with syntax-highlighted code blocks
- One-click "Apply to file" button

###  Built-In Project Runner
- **Auto-detects language**: Node.js, Python, Flask, Java
- **Auto-installs dependencies**: `npm install`, `pip install -r requirements.txt`
- Serves React/JSX projects via **Vite dev server** (auto-scaffolded)
- Serves plain HTML/CSS/JS via Express static server
- **Live preview** embedded in workspace + opens in full tab
- Backend + frontend run simultaneously with API proxy

###  Database Linking
- Connect PostgreSQL, MySQL, MongoDB, Redis, or SQLite to your room
- Credentials masked — never exposed to client
- DB environment variables injected at runtime automatically
- One-click disconnect

###  File Management
- Upload local files directly into the room
- Download all room files as a ZIP archive
- Multi-language syntax highlighting via Monaco Editor

---

##  Architecture

```
Browser (React + Vite)
  ├── Monaco Editor (VS Code engine)
  ├── Socket.IO client (real-time sync)
  ├── VoiceDirector → /gemini-live WebSocket
  └── PreviewAgent overlay (injected into preview tab)

Server (Node.js + Express)
  ├── Socket.IO server (file:change, chat, cursors, users)
  ├── REST API (rooms, files, DB, AI, execute)
  ├── /gemini-live WebSocket
  │     ├── Gemini Live API (BidiGenerateContent v1alpha)
  │     └── REST fallback (gemini-2.5-flash)
  ├── /api/rooms/:code/preview-agent
  │     └── Gemini REST → hot-update files → auto-reload
  ├── /api/ai (streaming SSE → Gemini)
  ├── /preview/:code proxy (injects overlay script)
  └── Project Runner
        ├── Node.js backend runner
        ├── Python/Flask runner
        ├── Java runner
        └── Vite dev server (React projects)
```

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Monaco Editor |
| Backend | Node.js, Express, Socket.IO |
| AI | Gemini Live API, Gemini 2.5 Flash REST |
| Real-time | Socket.IO, WebSocket (ws) |
| Hosting | Google Cloud Run |
| Styling | CSS Modules |
| Code execution | child_process (Node/Python/Java) |

---

## 🚀 Local Development

### Prerequisites
- Node.js v18+
- npm v9+
- A Gemini API key from [aistudio.google.com](https://aistudio.google.com)

### Setup

```bash
# Clone the repo
git clone https://github.com/yourname/stackroom.git
cd stackroom

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### Environment Variables

Create `server/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=4000
```

### Run

Open **two terminals**:

```bash
# Terminal 1 — Start the server
cd server
npm run dev
# Server runs on http://localhost:4000
```

```bash
# Terminal 2 — Start the client
cd client
npm run dev
# Client runs on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

##  Deployment (Google Cloud Run)

```bash
# Authenticate
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Deploy — builds Docker image and deploys in one command
gcloud run deploy stackroom \
  --source . \
  --port 4000 \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=your_key_here \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600
```

Your live URL will be: `https://stackroom-xxxxxxxx-uc.a.run.app`

---

##  API Reference

### Room Management
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/rooms` | Create a new room |
| `POST` | `/api/rooms/:code/join` | Join an existing room |
| `GET` | `/api/rooms/:code` | Get room state |
| `GET` | `/api/rooms/:code/download` | Download files as ZIP |
| `POST` | `/api/rooms/:code/upload` | Upload files into room |

### AI Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/rooms/:code/preview-agent` | Gemini Preview Agent command |
| `POST` | `/api/ai` | AI panel (Ask/Generate/Fix/Explain) |

### Database
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/rooms/:code/db` | Get DB connection status |
| `POST` | `/api/rooms/:code/db` | Link a database |
| `DELETE` | `/api/rooms/:code/db` | Remove database connection |

### Execution & Preview
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/execute` | Run a code snippet |
| `GET` | `/preview/:code/*` | Proxied preview with Gemini overlay |

### WebSocket Events (Socket.IO)
| Event | Direction | Description |
|---|---|---|
| `room:join` | Client → Server | Join a room |
| `file:change` | Bidirectional | Live file edit sync |
| `file:create` / `file:delete` | Client → Server | Create or delete a file |
| `chat:send` / `chat:message` | Bidirectional | Team chat |
| `cursor:move` | Bidirectional | Live cursor positions |
| `project:run` / `project:stop` | Client → Server | Start or stop the project |
| `project:ready` | Server → Client | Preview URL ready |
| `gemini:edit` | Server → Client | Gemini applied file edits |
| `spectate:request` / `spectate:snapshot` | Bidirectional | Watch a teammate's editor |

---

##  How the Gemini Live API is Used

StackRoom uses the **Gemini Live API** (`BidiGenerateContent`) for the Voice Director feature:

```
Browser mic → Web Speech API transcription
→ WebSocket /gemini-live (our server)
→ BidiGenerateContent (Gemini Live API v1alpha)
   model: gemini-2.0-flash-exp
   responseModalities: 'text'
→ Streaming text response
→ JSON parsed (bulletproof 4-strategy parser)
→ File edits applied to room
→ Socket.IO broadcasts file:change to all teammates
→ Every editor updates live
```

The Live API connection is established per room session and kept alive for the duration of the session, enabling true real-time bidirectional streaming between the developer and Gemini.

---

##  How the Preview Agent Works

The Preview Agent is StackRoom's breakthrough feature — Gemini embedded directly inside your running app:

```
1. Developer clicks ↗ to open preview in new tab
2. Server intercepts HTML response → injects overlay <script>
3. Floating "✦ Gemini" pill appears on the developer's live app
4. Developer speaks: "change the hero background to dark blue"
5. Web Speech API transcribes → POST /api/rooms/:code/preview-agent
6. Server sends command + full codebase to Gemini 2.5 Flash
7. Gemini returns structured JSON with file edits
8. Server applies edits → broadcasts file:change to all editors
9. For static HTML: hot-updates files on disk (~300ms reload)
10. For React: full Vite rebuild → auto-reload when ready
11. Teammates see Monaco editors update live
12. Preview tab reloads with the change applied
```

---

##  Project Structure

```
stackroom/
├── client/                    # React frontend
│   └── src/
│       ├── pages/
│       │   ├── Landing.jsx    # Room create/join page
│       │   └── Workspace.jsx  # Main IDE workspace
│       └── components/
│           ├── EditorPane.jsx      # Monaco editor with live sync
│           ├── FileExplorer.jsx    # File tree
│           ├── ChatPanel.jsx       # Team chat
│           ├── AiPanel.jsx         # Gemini AI assistant
│           ├── VoiceDirector.jsx   # Gemini voice commands
│           ├── PreviewPanel.jsx    # Live preview iframe
│           ├── DatabasePanel.jsx   # DB connection UI
│           ├── ConsolePanel.jsx    # Project logs
│           ├── Navbar.jsx          # Top bar
│           ├── SpectatePanel.jsx   # Watch teammate's editor
│           └── StatusBar.jsx       # Bottom status bar
├── server/
│   ├── index.js           # Express server + all REST endpoints
│   ├── gemini-live.js     # Gemini Live API + WebSocket handler
│   ├── gemini-parse.js    # Bulletproof JSON response parser
│   ├── preview-agent.js   # Preview overlay injection script
│   ├── runner.js          # Multi-language project runner
│   ├── executor.js        # Code snippet execution
│   └── db-connector.js    # Database connection testing
├── Dockerfile             # Google Cloud Run deployment
├── .dockerignore
└── README.md
```

---

##  Reproducible Testing Instructions

Follow these steps exactly to test every feature of StackRoom. No account or login required — just a browser and a terminal.

---

### Option A — Test on Hosted Version (Google Cloud Run)

Open the live deployment directly in your browser — no setup needed:

```
https://stackroom-xxxxxxxx-uc.a.run.app
```

Skip to **Step 2** below.

---

### Option B — Test Locally

**Prerequisites:**
- Node.js v18+
- npm v9+
- Google Chrome (required for Web Speech API)

**1. Clone and install:**
```bash
git clone https://github.com/yourname/stackroom.git
cd stackroom

# Install server
cd server && npm install

# Install client
cd ../client && npm install
```

**2. Add your Gemini API key:**
```bash
# Create server/.env
echo "GEMINI_API_KEY=your_key_here" > server/.env
```
Get a free key at: https://aistudio.google.com

**3. Start both servers (two terminals):**
```bash
# Terminal 1
cd server && npm run dev

# Terminal 2  
cd client && npm run dev
```

**4. Open:** http://localhost:3000

---

### ✅ Test 1 — Create a Room and Join as Two Users

1. Open **Chrome Tab 1** → http://localhost:3000
2. Enter name: `Developer 1`, role: `Frontend` → click **Create Room**
3. Note the 6-character room code shown in the top navbar (e.g. `ABC123`)
4. Open **Chrome Tab 2** → http://localhost:3000
5. Enter name: `Developer 2`, role: `Backend`, paste the room code → click **Join Room**
6. ✅ **Expected:** Both tabs show 2 users online in the left sidebar
7. ✅ **Expected:** Tab 2 sees Tab 1's files in the file explorer

---

### ✅ Test 2 — Real-Time Code Sync

1. In **Tab 1**, click `frontend/App.jsx` in the file explorer
2. Type anything in the Monaco editor
3. ✅ **Expected:** Tab 2's editor updates in real time with every keystroke
4. In **Tab 2**, click `backend/server.js` and type something
5. ✅ **Expected:** Tab 1 sees the backend file update live

---

### ✅ Test 3 — Team Chat

1. In **Tab 1**, click the ** Chat** tab in the right panel
2. Type a message and press Enter
3. ✅ **Expected:** Message appears in Tab 2's chat instantly
4. Type in Tab 2 and verify Tab 1 receives it

---

### ✅ Test 4 — Gemini Generates a Complete Project

1. In **Tab 1**, click the **✦ Voice** button (bottom right of workspace)
2. The panel opens — type in the text box:
   ```
   create a simple todo list web app with add and delete functionality
   ```
3. Press Enter or click ↑
4. ✅ **Expected:** Status shows "⚙ Gemini is thinking..."
5. ✅ **Expected:** After 5-10 seconds, new files appear in the file explorer (`frontend/index.html`, `frontend/style.css`, `frontend/app.js` etc.)
6. ✅ **Expected:** Tab 2's file explorer updates simultaneously with the same files
7. ✅ **Expected:** Chat shows "✦ Gemini: Created todo list app with..."

---

### ✅ Test 5 — Run the Project and See Live Preview

1. Click the **▶ Run Project** button in the top navbar
2. Watch the Console panel — it shows build progress
3. ✅ **Expected:** After 10-30 seconds, the Preview tab activates automatically
4. ✅ **Expected:** The todo app (or whatever was generated) is live and interactive
5. Click **↗** (open in new tab) next to the preview URL
6. ✅ **Expected:** App opens in a new browser tab at `localhost:3000/preview/ROOMCODE/`
7. ✅ **Expected:** A **"✦ Gemini"** pill button appears in the bottom-right corner of the app

---

### ✅ Test 6 — Gemini Preview Agent (Core Feature)

*This test requires the preview to be open in a new tab (from Test 5)*

1. In the new preview tab, click the **✦ Gemini** pill (bottom right)
2. The panel opens — type a UI command in the text box:
   ```
   change the background color to dark navy blue
   ```
3. Click ↑ or press Enter
4. ✅ **Expected:** Status shows "⚙ Gemini is thinking…"
5. ✅ **Expected:** After a few seconds, status shows "✓ Changed background..."
6. ✅ **Expected:** Preview tab reloads with the dark navy background
7. ✅ **Expected:** Back in StackRoom (Tab 1 and Tab 2), the CSS file in Monaco editor shows the updated background color

Try more commands:
- `"make the heading font size larger"`
- `"add a red border to the input field"`
- `"center everything on the page"`

---

### ✅ Test 7 — Voice Command (requires microphone)

1. In the StackRoom workspace, click **✦ Voice** button
2. Click **🎙 Tap to Speak**
3. Allow microphone permission when Chrome asks
4. Speak clearly: *"add a footer with copyright 2026"*
5. Click ⏹ Stop when done speaking
6. ✅ **Expected:** Transcript appears in blue showing what was heard
7. ✅ **Expected:** Gemini processes and edits the relevant file
8. ✅ **Expected:** Monaco editor in both tabs updates with the footer

---

### ✅ Test 8 — AI Panel (Ask / Fix / Generate / Explain)

1. Click the **✦ AI** tab in the right panel
2. Select **Ask** mode → type: `"what does this file do?"`  → click Send
3. ✅ **Expected:** Gemini streams an explanation of the current file
4. Select **Generate** mode → type: `"add a dark mode toggle button"` → click Send
5. ✅ **Expected:** Gemini returns code with a **Apply to file** button
6. Click **Apply to file**
7. ✅ **Expected:** Monaco editor updates with the new code

---

### ✅ Test 9 — Spectate Mode

1. In **Tab 2**, find **Developer 1** in the Team sidebar
2. Click the **◎** watch button next to their name
3. Go back to **Tab 1** and switch between files
4. ✅ **Expected:** Tab 2 automatically mirrors whatever Tab 1 is viewing
5. Click **◉** to stop spectating

---

### ✅ Test 10 — Download as ZIP

1. Click the **↓ Download** button in the top navbar
2. ✅ **Expected:** A `.zip` file downloads containing all project files
3. Extract it — verify all files (HTML, CSS, JS, etc.) are present with correct content

---

###  Testing Gemini Live API Connection

To verify the Live API (not REST fallback) is being used:

1. Open the server terminal
2. Click **✦ Voice** in the workspace
3. ✅ **Expected server log:**
   ```
   [GeminiLive] Connecting to Live API for room XXXXXX...
   [GeminiLive] Connected — sending setup for room XXXXXX
   [GeminiLive] ✓ Setup complete — room XXXXXX
   ```
4. The Voice Director panel shows: `"🎙 Ready — powered by Gemini Live API"`
5. If it shows `"🎙 Ready — using Gemini REST API"` — the Live API is falling back to REST (still functional, but note this in evaluation)

---

###  Known Limitations

| Limitation | Details |
|---|---|
| Room persistence | Rooms are in-memory — lost on server restart (by design for hackathon) |
| Gemini rate limit | Free tier: 20 requests/minute — wait 60s if you hit quota errors |
| Voice recognition | Requires Google Chrome — not supported in Firefox/Safari |
| React project build | First run takes 60-90s while Vite installs npm packages |
| Mic permission | Must allow microphone access when Chrome prompts |

---

###  Quick Test Credentials

No login required. Use any name when creating/joining a room.

| Field | Value |
|---|---|
| Room creation | Any name + any role |
| Room joining | Any name + room code from creator |
| Gemini API | Provided via server `.env` — no client-side key needed |

---

##  Built For

**Gemini Live Agent Challenge** — geminiliveagentchallenge.devpost.com

StackRoom demonstrates that the most powerful AI experience isn't one AI assistant for one developer — it's one AI for the whole team, operating in real time, visible to everyone, changing code that every teammate can see update live.

---

