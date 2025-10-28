# Collaborative Browser

Browse the web with multiple people at the same time. Watch videos together, shop together, or just surf the web as a group. Inspired by [neko](https://github.com/m1k1o/neko).

## How it works

Three services run together:

1. **Signaling Server** (Node.js/TypeScript) - Handles WebRTC signaling and room management
2. **Browser Service** (Node.js/Playwright) - Controls a headless Chromium browser
3. **Client** (Next.js/React) - The web interface you use

## What you get

Real-time sync across all users. When the host navigates somewhere, everyone sees it.

Create or join rooms with unique IDs. Only the room host can change URLs.

No installation needed. Just open your browser and go.

Works on any device. Self-hosted so you control everything.

## Getting started

You need Docker, Docker Compose, and Node.js 18 or higher.

Clone the repo:
```bash
git clone <your-repo>
cd collaborative-browser
npm install
```

Build and run:
```bash
docker-compose build
docker-compose up -d
docker-compose logs -f
```

Open these URLs:
- Client: http://localhost:3000
- Signaling Server: http://localhost:3001
- Browser Service: http://localhost:3002

## Running without Docker

Start each service in a separate terminal.

Signaling server:
```bash
cd server
npm install
npm run dev
```

Browser service:
```bash
cd browser-service
npm install
npm run dev
```

Client:
```bash
npm run dev
```

## Using it

Click "Create Room" to start a session. Copy the room link and send it to whoever you want to invite. The host enters URLs and everyone sees the same content in real time.

## Tech stack

Node.js, TypeScript, Express, Socket.IO for the backend. Playwright for browser control. Next.js, React, and Tailwind CSS for the frontend. WebRTC and WebSocket for communication.

## How this differs from neko

Uses Node.js instead of Go. Built with React instead of Vue.js. Separated into modular services. Uses WebRTC streaming for browser content instead of screenshots.

## API endpoints

Signaling Server (Port 3001):
- `GET /health` - Health check
- `WebSocket /` - Real-time signaling

Browser Service (Port 3002):
- `GET /health` - Health check
- `GET /page` - Current page info
- `POST /navigate` - Navigate to URL
- `GET /screenshot` - Get page screenshot
- `POST /execute` - Execute JavaScript
- `GET /content` - Get page HTML content

## Architecture

```
React Client (3000) <--WebSocket--> Signaling Server (3001)
        |                                   |
        | HTTP                              |
        v                                   v
Browser Service (3002) <----------> Room Manager
        |
        | Playwright
        v
Headless Chromium
```

## Adding features

Want to add room features? Edit `RoomManager` in the signaling server. Need more browser controls? Extend the browser service API. Building UI components? Work in the React client.

Test it:
```bash
docker-compose up
curl http://localhost:3001/health
curl http://localhost:3002/health
```

## Troubleshooting

Port conflicts: Change ports in docker-compose.yml

Browser not starting: Check Docker permissions

WebRTC problems: Make sure STUN/TURN servers are accessible

View logs:
```bash
docker-compose logs
docker-compose logs signaling
docker-compose logs browser
docker-compose logs client
```

## License

MIT
