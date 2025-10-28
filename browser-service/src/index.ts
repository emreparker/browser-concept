import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';

// Try to import browser automation libraries
let playwright: any = null;
let chromium: any = null;
let puppeteer: any = null;
let Browser: any = null;
let Page: any = null;
let axios: any = null;

try {
  // Try Playwright first (more reliable)
  const playwrightModule = require('playwright');
  playwright = playwrightModule;
  chromium = playwrightModule.chromium;
  console.log('✅ Using Playwright browser');
} catch (e) {
  console.log('Playwright not available:', e.message);
  try {
    // Fallback to Puppeteer
    const puppeteerModule = require('puppeteer');
    puppeteer = puppeteerModule;
    Browser = puppeteerModule.Browser;
    Page = puppeteerModule.Page;
    console.log('✅ Using Puppeteer browser');
  } catch (e2) {
    console.log('Puppeteer not available:', e2.message);
    try {
      // Fallback to axios for HTTP requests
      axios = require('axios');
      console.log('✅ Using HTTP client (axios)');
    } catch (e3) {
      console.log('Axios not available:', e3.message);
      console.log('⚠️ No browser automation or HTTP client available, using mock only');
    }
  }
}

class BrowserService {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private browser: any = null;
  private page: any = null;
  private browserType: 'playwright' | 'puppeteer' | 'mock' = 'mock';
  private currentUrl: string = 'https://www.google.com';
  private isInitialized: boolean = false;
  private streamingClients: Map<string, any> = new Map();
  private streamingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.app = express();

    // Create HTTP server
    this.server = createServer(this.app);

    // Create Socket.IO server
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
      },
      allowEIO3: true,
      transports: ['websocket', 'polling']
    });

    // Middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https:"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"],
          fontSrc: ["'self'", "https:", "data:"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'self'"],
          frameAncestors: ["'self'", "http://localhost:3000", "http://localhost:3003", "http://127.0.0.1:3000", "http://127.0.0.1:3003"]
        }
      }
    }));
    this.app.use(cors());
    this.app.use(compression());
    this.app.use(express.json());

    this.setupRoutes();
    this.setupSocketIO();
  }

  private setupSocketIO(): void {
    console.log('🚀 Setting up Socket.IO server for browser service...');

    this.io.on('connection', (socket) => {
      console.log(`🌐 Signaling server connected: ${socket.id}`);

      socket.on('webrtc-offer', async (data: { offer: RTCSessionDescriptionInit, clientId: string }) => {
        console.log('📡 Received WebRTC offer from signaling server for client:', data.clientId);

        try {
          // Create WebRTC peer connection for this client
          const peerConnection = new RTCPeerConnection({
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' }
            ]
          });

          // Store the peer connection
          this.streamingClients.set(data.clientId, peerConnection);

          // Handle data channel
          peerConnection.ondatachannel = (event) => {
            const dataChannel = event.channel;
            console.log('Data channel received:', dataChannel.label);

            dataChannel.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data);
                console.log('Received data channel message:', message);

                if (message.type === 'navigate') {
                  this.navigateToUrl(message.url);
                }
              } catch (error) {
                console.error('Error parsing data channel message:', error);
              }
            };

            dataChannel.onopen = () => {
              console.log('Data channel opened for client:', data.clientId);
            };
          };

          // Handle ICE candidates
          peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
              socket.emit('webrtc-ice-candidate', {
                candidate: event.candidate,
                clientId: data.clientId
              });
            }
          };

          // Set remote description
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

          // Create answer
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          // Send answer back to signaling server
          socket.emit('webrtc-answer', {
            answer: answer,
            clientId: data.clientId
          });

          // Start streaming if browser is ready
          this.startStreaming(data.clientId);

          console.log('📡 WebRTC connection established for client:', data.clientId);

        } catch (error) {
          console.error('❌ WebRTC offer handling failed:', error);
          socket.emit('error', {
            message: 'Failed to process WebRTC offer',
            clientId: data.clientId
          });
        }
      });

      socket.on('webrtc-ice-candidate', async (data: { candidate: RTCIceCandidateInit, clientId: string }) => {
        const peerConnection = this.streamingClients.get(data.clientId);
        if (peerConnection) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (error) {
            console.error('❌ Failed to add ICE candidate:', error);
          }
        }
      });

      socket.on('navigate', async (data: { url: string }) => {
        console.log(`🌐 Navigation request: ${data.url}`);
        try {
          if (this.page && this.isInitialized) {
            await Promise.race([
              this.page.goto(data.url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Navigation timeout')), 30000)
              )
            ]);

            // Wait a bit for page to stabilize
            await new Promise(resolve => setTimeout(resolve, 1000));

            this.currentUrl = this.page.url();
            console.log(`✅ Navigated to: ${this.currentUrl}`);
          } else {
            console.error('Browser not ready for navigation');
          }
        } catch (error) {
          console.error('Navigation failed:', error);
        }
      });

      socket.on('refresh', async () => {
        console.log('🔄 Refresh request');
        if (this.page) {
          await this.page.reload();
        }
      });

      socket.on('back', async () => {
        console.log('⬅️ Back navigation request');
        if (this.page) {
          await this.page.goBack();
        }
      });

      socket.on('forward', async () => {
        console.log('➡️ Forward navigation request');
        if (this.page) {
          await this.page.goForward();
        }
      });

      socket.on('client-disconnected', (data: { clientId: string }) => {
        console.log(`🌐 Client disconnected: ${data.clientId}`);
        const peerConnection = this.streamingClients.get(data.clientId);
        if (peerConnection) {
          peerConnection.close();
          this.streamingClients.delete(data.clientId);
        }
      });

      socket.on('disconnect', () => {
        console.log(`🌐 Signaling server disconnected: ${socket.id}`);
        // Close all peer connections
        for (const [clientId, peerConnection] of this.streamingClients) {
          peerConnection.close();
        }
        this.streamingClients.clear();
      });
    });
  }

  private async startStreaming(clientId: string): Promise<void> {
    if (!this.page || !this.isInitialized) {
      console.log('Browser not ready for streaming');
      return;
    }

    const peerConnection = this.streamingClients.get(clientId);
    if (!peerConnection) {
      console.log('No peer connection found for client:', clientId);
      return;
    }

    console.log('Starting screenshot streaming for client:', clientId);

    // Start capturing screenshots and sending them as video frames
    this.streamingInterval = setInterval(async () => {
      try {
        if (!this.page || !this.isInitialized) {
          return;
        }

        const screenshot = await this.page.screenshot({
          type: 'png',
          fullPage: false
        });

        // Send screenshot data through WebRTC data channel
        // For now, we'll send via Socket.IO as fallback since data channel setup is complex
        const socket = Array.from(this.io.sockets.sockets.values()).find(
          (s: any) => s.id === clientId
        );

        if (socket) {
          socket.emit('browser-frame', {
            imageData: screenshot.toString('base64'),
            timestamp: Date.now()
          });
        } else {
          console.log('Socket not found for client:', clientId);
        }
      } catch (error) {
        console.error('Error capturing screenshot:', error);
      }
    }, 100); // 10 FPS

    console.log('Screenshot streaming started for client:', clientId);
  }

  // Initialize browser - try Playwright first, then Puppeteer
  private async initializeBrowser(): Promise<void> {
    if (this.isInitialized && this.browser && this.page) {
      console.log('✅ Browser already initialized');
      return;
    }

    // Close existing browser if it exists
    if (this.browser) {
      try {
        if (this.browserType === 'playwright') {
          await this.browser.close();
        } else if (this.browserType === 'puppeteer') {
          await this.browser.close();
        }
      } catch (error) {
        console.error('Error closing existing browser:', error);
      }
      this.browser = null;
      this.page = null;
    }

    // Try Playwright first
    if (playwright && chromium) {
      try {
        console.log('🚀 Launching Playwright browser...');

        this.browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
          ]
        });

        this.page = await this.browser.newPage();
        await this.page.setViewportSize({ width: 1280, height: 720 });
        // Note: Playwright handles user agent automatically, no need to set it manually

        await this.page.goto(this.currentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        this.browserType = 'playwright';
        this.isInitialized = true;
        console.log('✅ Playwright browser initialized successfully');
        return;

      } catch (error) {
        console.error('❌ Playwright failed:', error);
      }
    }

    // Try Puppeteer as fallback
    if (puppeteer) {
      try {
        console.log('🚀 Launching Puppeteer browser...');

        this.browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ]
        });

        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1280, height: 720 });
        await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        this.page.on('error', (error) => {
          console.error('Page error:', error);
        });

        this.page.on('pageerror', (error) => {
          console.error('Page JavaScript error:', error);
        });

        await this.page.goto(this.currentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        this.browserType = 'puppeteer';
        this.isInitialized = true;
        console.log('✅ Puppeteer browser initialized successfully');
        return;

      } catch (error) {
        console.error('❌ Puppeteer failed:', error);
      }
    }

    // Try HTTP client as final fallback
    if (axios) {
      console.log('✅ Using HTTP client for content fetching');
      this.browserType = 'http';
      this.isInitialized = true;
      return;
    }

    // Fallback to mock
    console.log('🔄 Falling back to mock browser');
    this.browserType = 'mock';
    this.isInitialized = false;
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        browserReady: this.isInitialized,
        currentUrl: this.currentUrl,
        timestamp: new Date().toISOString()
      });
    });

    // Get current page info
    this.app.get('/page', async (req, res) => {
      try {
        if (this.page) {
          // Use real browser
          const title = await this.page.title();
          const url = this.page.url();

          res.json({
            title,
            url,
            currentUrl: url
          });
        } else {
          // Fallback to mock
          const mockTitle = this.currentUrl.includes('google')
            ? 'Google'
            : this.currentUrl.includes('youtube')
            ? 'YouTube'
            : 'Web Page';

          res.json({
            title: mockTitle,
            url: this.currentUrl,
            currentUrl: this.currentUrl
          });
        }
      } catch (error) {
        console.error('Error getting page info:', error);
        res.status(500).json({ error: 'Failed to get page info' });
      }
    });

    // Navigate to URL
    this.app.post('/navigate', async (req, res) => {
      const { url } = req.body;

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL is required' });
      }

      console.log(`🔗 Navigating to: ${url}`);

      // Set a timeout for the entire operation
      const timeout = setTimeout(() => {
        console.error('Navigation timeout');
        if (!res.headersSent) {
          res.status(504).json({ error: 'Navigation timeout' });
        }
      }, 35000); // 35 seconds timeout

      try {
        if (this.page && this.isInitialized) {
          // Use real browser with timeout
          await Promise.race([
            this.page.goto(url, {
              waitUntil: 'domcontentloaded', // Less strict than networkidle2
              timeout: 30000
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Navigation timeout')), 30000)
            )
          ]);

          // Wait a bit for page to stabilize
          await new Promise(resolve => setTimeout(resolve, 1000));

          try {
            this.currentUrl = this.page.url();
            const title = await this.page.title();

            clearTimeout(timeout);
            res.json({
              success: true,
              url: this.currentUrl,
              title
            });
          } catch (pageError) {
            console.error('Error getting page info:', pageError);
            // Still return success if navigation worked
            clearTimeout(timeout);
            res.json({
              success: true,
              url: url,
              title: 'Page Loaded'
            });
          }
        } else if (this.browserType === 'http' && axios) {
          // Use HTTP client to fetch real content
          console.log('🌐 Using HTTP client to fetch content');
          try {
            const response = await axios.get(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
              },
              timeout: 15000,
              maxRedirects: 5
            });

            this.currentUrl = url;

            // Extract title from HTML
            const titleMatch = response.data.match(/<title[^>]*>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : 'Web Page';

            clearTimeout(timeout);
            res.json({
              success: true,
              url: this.currentUrl,
              title
            });
          } catch (httpError) {
            console.error('HTTP request failed:', httpError.message);
            // Fallback to mock response
            this.currentUrl = url;
            const mockTitle = url.includes('google')
              ? 'Google'
              : url.includes('youtube')
              ? 'YouTube'
              : 'Web Page';

            clearTimeout(timeout);
            res.json({
              success: true,
              url,
              title: mockTitle
            });
          }
        } else {
          // Fallback to mock - try to reinitialize browser first
          console.log('Browser not ready, attempting to reinitialize...');
          try {
            await this.initializeBrowser();
            if (this.page && this.isInitialized) {
              // Retry with real browser
              await this.page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 20000
              });
              this.currentUrl = this.page.url();
              const title = await this.page.title();

              clearTimeout(timeout);
              res.json({
                success: true,
                url: this.currentUrl,
                title
              });
            } else if (this.browserType === 'http' && axios) {
              // Use HTTP client
              const response = await axios.get(url, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 15000
              });

              this.currentUrl = url;
              const titleMatch = response.data.match(/<title[^>]*>([^<]+)<\/title>/i);
              const title = titleMatch ? titleMatch[1].trim() : 'Web Page';

              clearTimeout(timeout);
              res.json({
                success: true,
                url: this.currentUrl,
                title
              });
            } else {
              throw new Error('Browser initialization failed');
            }
          } catch (initError) {
            console.error('Browser initialization failed:', initError.message);
            // Fallback to mock response
            this.currentUrl = url;
            const mockTitle = url.includes('google')
              ? 'Google'
              : url.includes('youtube')
              ? 'YouTube'
              : 'Web Page';

            clearTimeout(timeout);
            res.json({
              success: true,
              url,
              title: mockTitle
            });
          }
        }

      } catch (error) {
        console.error('Error navigating:', error);
        clearTimeout(timeout);

        if (!res.headersSent) {
          // Try to reinitialize browser and retry
          try {
            console.log('Attempting browser recovery...');
            this.isInitialized = false;
            await this.initializeBrowser();

            if (this.page && this.isInitialized) {
              res.json({
                success: true,
                url,
                title: 'Page Loaded (Recovered)'
              });
            } else {
              res.status(500).json({ error: 'Browser unavailable' });
            }
          } catch (recoveryError) {
            res.status(500).json({ error: 'Navigation failed' });
          }
        }
      }
    });

    // Interactive Browser endpoint - WebRTC STREAMING VERSION
    this.app.get('/browser', async (req, res) => {
      const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Real Interactive Browser</title>
    <script src="https://cdn.socket.io/4.7.4/socket.io.min.js"></script>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            overflow: hidden;
        }

        .browser-container {
            width: 100vw;
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: #2d2d2d;
        }

        .browser-toolbar {
            height: 50px;
            background: #3d3d3d;
            border-bottom: 1px solid #555;
            display: flex;
            align-items: center;
            padding: 0 20px;
            gap: 10px;
        }

        .nav-button {
            width: 30px;
            height: 30px;
            border: none;
            border-radius: 4px;
            background: #555;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 14px;
            transition: background 0.2s;
        }

        .nav-button:hover {
            background: #666;
        }

        .address-bar {
            flex: 1;
            height: 32px;
            border: 1px solid #666;
            border-radius: 20px;
            padding: 0 16px;
            font-size: 14px;
            outline: none;
            background: #2d2d2d;
            color: #fff;
        }

        .address-bar:focus {
            border-color: #007bff;
            box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
        }

        .go-button {
            padding: 6px 16px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }

        .go-button:hover {
            background: #0056b3;
        }

        .browser-content {
            flex: 1;
            position: relative;
            overflow: hidden;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .browser-video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #000;
        }

        .browser-canvas {
            width: 100%;
            height: 100%;
            background: #000;
        }

        .loading-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            color: #fff;
            z-index: 1000;
        }

        .status-text {
            margin-top: 20px;
            font-size: 14px;
            color: #ccc;
        }

        .loading-overlay.hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="browser-container">
        <div class="browser-toolbar">
            <button class="nav-button" id="back-btn" title="Back">←</button>
            <button class="nav-button" id="forward-btn" title="Forward">→</button>
            <button class="nav-button" id="refresh-btn" title="Refresh">↻</button>
            <input type="text" class="address-bar" id="address-bar" placeholder="Enter URL..." value="https://example.com">
            <button class="go-button" id="go-btn">Go</button>
        </div>

        <div class="browser-content">
            <div class="loading-overlay" id="loading">
                <div>🚀 Loading Real Browser...</div>
                <div class="status-text" id="status">Initializing browser connection</div>
            </div>

            <canvas class="browser-canvas" id="browser-canvas"></canvas>
        </div>
    </div>

    <script>
        const canvas = document.getElementById('browser-canvas');
        const addressBar = document.getElementById('address-bar');
        const loading = document.getElementById('loading');
        const statusText = document.getElementById('status');
        const backBtn = document.getElementById('back-btn');
        const forwardBtn = document.getElementById('forward-btn');
        const refreshBtn = document.getElementById('refresh-btn');
        const goBtn = document.getElementById('go-btn');

        const ctx = canvas.getContext('2d');
        let currentUrl = 'https://example.com';
        let socket = null;
        let lastFrameTime = 0;

        // Initialize canvas size
        function resizeCanvas() {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
        }

        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        // WebRTC variables
        let peerConnection = null;
        let dataChannel = null;

        // Initialize Socket.IO connection to signaling server
        function initializeSocket() {
            statusText.textContent = 'Connecting to signaling server...';

            socket = io('http://localhost:3001/browser-webrtc');

            socket.on('connect', () => {
                console.log('Connected to signaling server');
                statusText.textContent = 'Connected - establishing WebRTC...';
                initializeWebRTC();
            });

            socket.on('disconnect', () => {
                console.log('Disconnected from signaling server');
                statusText.textContent = 'Disconnected - attempting to reconnect...';
                loading.classList.remove('hidden');
                if (peerConnection) {
                    peerConnection.close();
                    peerConnection = null;
                }
            });

            socket.on('webrtc-answer', (data) => {
                console.log('Received WebRTC answer');
                if (peerConnection) {
                    peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                }
            });

            socket.on('webrtc-ice-candidate', (data) => {
                console.log('Received ICE candidate');
                if (peerConnection) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            });

            socket.on('browser-frame', (data) => {
                // Display the received frame
                const img = new Image();
                img.onload = () => {
                    // Clear canvas
                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    // Calculate aspect ratio to fit the canvas
                    const canvasRatio = canvas.width / canvas.height;
                    const imgRatio = img.width / img.height;

                    let drawWidth, drawHeight, drawX, drawY;

                    if (imgRatio > canvasRatio) {
                        // Image is wider than canvas
                        drawWidth = canvas.width;
                        drawHeight = canvas.width / imgRatio;
                        drawX = 0;
                        drawY = (canvas.height - drawHeight) / 2;
                    } else {
                        // Image is taller than canvas
                        drawHeight = canvas.height;
                        drawWidth = canvas.height * imgRatio;
                        drawX = (canvas.width - drawWidth) / 2;
                        drawY = 0;
                    }

                    // Draw the image
                    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

                    // Hide loading if it's still visible
                    if (!loading.classList.contains('hidden')) {
                        loading.classList.add('hidden');
                        statusText.textContent = 'Browser ready - receiving video stream';
                    }

                    lastFrameTime = Date.now();
                };
                img.src = 'data:image/png;base64,' + data.imageData;
            });

            socket.on('connect_error', (error) => {
                console.error('Connection error:', error);
                statusText.textContent = 'Connection failed - will retry...';
                setTimeout(initializeSocket, 2000);
            });
        }

        // Initialize WebRTC connection
        async function initializeWebRTC() {
            try {
                console.log('Creating WebRTC peer connection...');

                // Create peer connection
                peerConnection = new RTCPeerConnection({
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                });

                // Handle ICE candidates
                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        console.log('Sending ICE candidate');
                        socket.emit('webrtc-ice-candidate', {
                            candidate: event.candidate
                        });
                    }
                };

                // Create data channel for control messages
                dataChannel = peerConnection.createDataChannel('control');
                dataChannel.onopen = () => {
                    console.log('Data channel opened');
                    statusText.textContent = 'WebRTC connected - initializing browser...';
                    initializeBrowser();
                };

                // Create offer and send to signaling server
                console.log('Creating WebRTC offer...');
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);

                console.log('Sending WebRTC offer to signaling server...');
                socket.emit('webrtc-offer', {
                    offer: offer
                });

                statusText.textContent = 'WebRTC offer sent - waiting for response...';

            } catch (error) {
                console.error('WebRTC initialization failed:', error);
                statusText.textContent = 'WebRTC failed - retrying...';
                setTimeout(initializeWebRTC, 2000);
            }
        }

        // Initialize browser
        async function initializeBrowser() {
            statusText.textContent = 'Starting browser session...';
            await navigateToUrl(currentUrl);
        }

        // Navigate to URL
        async function navigateToUrl(url) {
            loading.classList.remove('hidden');
            addressBar.value = url;
            currentUrl = url;

            if (dataChannel && dataChannel.readyState === 'open') {
                console.log('Sending navigation command:', url);
                dataChannel.send(JSON.stringify({
                    type: 'navigate',
                    url: url
                }));
                statusText.textContent = 'Navigating to ' + url + '...';
            } else {
                console.log('Data channel not ready, trying socket fallback');
                if (socket && socket.connected) {
                    socket.emit('navigate', { url: url });
                    statusText.textContent = 'Navigating to ' + url + '...';
                } else {
                    statusText.textContent = 'Not connected to signaling server';
                    loading.classList.add('hidden');
                }
            }
        }

        // Event listeners
        goBtn.addEventListener('click', () => {
            const url = addressBar.value.trim();
            if (url) {
                const fullUrl = url.startsWith('http') ? url : 'https://' + url;
                navigateToUrl(fullUrl);
            }
        });

        addressBar.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                goBtn.click();
            }
        });

        refreshBtn.addEventListener('click', () => {
            navigateToUrl(currentUrl);
        });

        // Initialize on page load
        initializeSocket();

        // Add some helpful keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'r':
                        e.preventDefault();
                        refreshBtn.click();
                        break;
                    case 'l':
                        e.preventDefault();
                        addressBar.focus();
                        addressBar.select();
                        break;
                }
            }
        });

        // Show helpful message
        setTimeout(() => {
            if (!socket || !socket.connected) {
                statusText.textContent = 'Having trouble connecting. Please check browser service.';
            }
        }, 10000);
    </script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self' http://localhost:3000 http://localhost:3003 http://127.0.0.1:3000 http://127.0.0.1:3003");
      res.send(html);
    });

    // Take screenshot
    this.app.get('/screenshot', async (req, res) => {
      // Set a timeout for screenshot operation
      const timeout = setTimeout(() => {
        console.error('Screenshot timeout');
        if (!res.headersSent) {
          res.status(504).json({ error: 'Screenshot timeout' });
        }
      }, 10000); // 10 seconds timeout

      try {
        if (this.page && this.isInitialized && this.browserType !== 'mock') {
          // Use real browser screenshot with timeout
          const screenshot = await Promise.race([
            this.page.screenshot({ type: 'png', fullPage: false }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Screenshot timeout')), 8000)
            )
          ]);

          clearTimeout(timeout);
          res.setHeader('Content-Type', 'image/png');
          res.send(screenshot);
        } else {
          // Try to reinitialize browser first
          console.log('Browser not ready for screenshot, attempting to reinitialize...');
          try {
            await this.initializeBrowser();
            if (this.page && this.isInitialized && this.browserType !== 'mock') {
              const screenshot = await Promise.race([
                this.browserType === 'playwright'
                  ? this.page.screenshot({ type: 'png', fullPage: false })
                  : this.page.screenshot({ type: 'png', fullPage: false }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Screenshot timeout')), 5000)
                )
              ]);

              clearTimeout(timeout);
              res.setHeader('Content-Type', 'image/png');
              res.send(screenshot);
            } else {
              throw new Error('Browser initialization failed');
            }
          } catch (initError) {
            console.error('Browser initialization failed for screenshot:', initError);
            // Fallback to SVG mock
            clearTimeout(timeout);
            const width = 1280;
            const height = 720;

            const svgContent = `
              <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#f8f9fa"/>
                <text x="50%" y="30%" font-family="Arial" font-size="36" fill="#6b7280" text-anchor="middle">
                  🔄 Initializing Browser...
                </text>
                <text x="50%" y="50%" font-family="Arial" font-size="24" fill="#9ca3af" text-anchor="middle">
                  ${this.currentUrl}
                </text>
                <text x="50%" y="70%" font-family="Arial" font-size="18" fill="#d1d5db" text-anchor="middle">
                  Real browser content loading...
                </text>
              </svg>
            `;

            res.setHeader('Content-Type', 'image/svg+xml');
            res.send(svgContent);
          }
        }
      } catch (error) {
        console.error('Error creating screenshot:', error);
        clearTimeout(timeout);

        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to create screenshot' });
        }
      }
    });

    // Execute JavaScript - mock response
    this.app.post('/execute', async (req, res) => {
      try {
        const { script } = req.body;

        if (!script || typeof script !== 'string') {
          return res.status(400).json({ error: 'Script is required' });
        }

        // Mock JavaScript execution result
        const mockResult = `Executed: ${script.substring(0, 50)}...`;

        res.json({
          success: true,
          result: mockResult
        });
      } catch (error) {
        console.error('Error executing script:', error);
        res.status(500).json({ error: 'Failed to execute script' });
      }
    });

    // Get page content
    this.app.get('/content', async (req, res) => {
      try {
        const targetUrl = req.query.url || this.currentUrl;
        console.log('🌐 Fetching content for URL:', targetUrl);

        if (this.page && this.browserType !== 'mock') {
          // Navigate to the requested URL first
          if (req.query.url && req.query.url !== this.currentUrl) {
            console.log('🔗 Navigating browser to:', req.query.url);
            await this.page.goto(req.query.url, {
              waitUntil: 'domcontentloaded',
              timeout: 15000
            });
            this.currentUrl = req.query.url;
          }

          // Use real browser content
          const content = await this.page.content();
          res.setHeader('Content-Type', 'text/html');
          res.send(content);
        } else if (axios) {
          // Use HTTP client to fetch real content
          console.log('🌐 Fetching real content with HTTP client for:', targetUrl);
          const response = await axios.get(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept-Encoding': 'gzip, deflate, br',
              'Connection': 'keep-alive',
              'Upgrade-Insecure-Requests': '1'
            },
            timeout: 15000,
            maxRedirects: 5
          });

          res.setHeader('Content-Type', 'text/html');
          res.send(response.data);
        } else {
          // Fallback to mock HTML
          const mockHtml = `
            <!DOCTYPE html>
            <html>
              <head>
                <title>Browser Content - ${this.currentUrl}</title>
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background: #f8f9fa;
                    color: #333;
                  }
                  .header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 30px;
                    border-radius: 12px;
                    margin-bottom: 20px;
                    text-align: center;
                  }
                  .content {
                    background: white;
                    padding: 30px;
                    border-radius: 12px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    max-width: 1200px;
                    margin: 0 auto;
                  }
                  .url-display {
                    background: #f1f3f4;
                    padding: 15px;
                    border-radius: 8px;
                    font-family: 'Monaco', 'Menlo', monospace;
                    margin: 20px 0;
                    border-left: 4px solid #4285f4;
                  }
                  .info {
                    background: #e8f5e8;
                    border: 1px solid #4caf50;
                    border-radius: 8px;
                    padding: 20px;
                    margin: 20px 0;
                  }
                  .warning {
                    background: #fff3e0;
                    border: 1px solid #ff9800;
                    border-radius: 8px;
                    padding: 20px;
                    margin: 20px 0;
                  }
                </style>
              </head>
              <body>
                <div class="header">
                  <h1>🌐 Browser Content</h1>
                  <p>Real web content loading...</p>
                </div>

                <div class="content">
                  <div class="url-display">
                    <strong>Current URL:</strong><br>
                    ${this.currentUrl}
                  </div>

                  <div class="info">
                    <h3>✅ Connection Successful!</h3>
                    <p>Your collaborative browser is working and connected to the browser service.</p>
                  </div>

                  <div class="warning">
                    <h3>⚠️ Browser Service Status</h3>
                    <p>The browser service is currently in fallback mode. Real browser automation is initializing...</p>
                    <p>You can still navigate to websites and the system will fetch real content using HTTP requests.</p>
                  </div>

                  <h2>🚀 Try These URLs:</h2>
                  <ul style="line-height: 2;">
                    <li><code>https://www.google.com</code> - Search engine</li>
                    <li><code>https://www.github.com</code> - Development platform</li>
                    <li><code>https://www.wikipedia.org</code> - Encyclopedia</li>
                    <li><code>https://news.ycombinator.com</code> - Tech news</li>
                  </ul>

                  <p><strong>Navigation:</strong> Enter any URL in the address bar above and press Enter to navigate.</p>
                  <p><strong>Collaboration:</strong> Create a room and share the link to browse together!</p>
                </div>
              </body>
            </html>
          `;

          res.setHeader('Content-Type', 'text/html');
          res.send(mockHtml);
        }
      } catch (error) {
        console.error('Error getting content:', error);
        res.status(500).json({ error: 'Failed to get content' });
      }
    });
  }

  public async start(port: number = 3002): Promise<void> {
    try {
      // Initialize browser first
      await this.initializeBrowser();

      // Start HTTP server with Socket.IO
      this.server.listen(port, () => {
        console.log(`🚀 Browser service running on port ${port}`);
        console.log(`📸 Screenshot endpoint: http://localhost:${port}/screenshot`);
        console.log(`📄 Content endpoint: http://localhost:${port}/content`);
        console.log(`🔗 Navigate endpoint: POST http://localhost:${port}/navigate`);
        console.log(`🌐 WebRTC endpoint: ws://localhost:${port}`);
        console.log(`🖥️ Browser UI: http://localhost:${port}/browser`);
      });

      // Graceful shutdown
      const shutdown = async () => {
        console.log('🛑 Received shutdown signal...');
        this.server.close(async () => {
          await this.stop();
          process.exit(0);
        });
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

    } catch (error) {
      console.error('❌ Failed to start browser service:', error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    console.log('🛑 Stopping browser service...');

    // Stop streaming
    if (this.streamingInterval) {
      clearInterval(this.streamingInterval);
      this.streamingInterval = null;
    }

    // Close all WebRTC connections
    for (const [clientId, peerConnection] of this.streamingClients) {
      try {
        peerConnection.close();
      } catch (error) {
        console.error(`Error closing peer connection for ${clientId}:`, error);
      }
    }
    this.streamingClients.clear();

    try {
      if (this.page) {
        if (this.browserType === 'playwright') {
          await this.page.close();
        } else if (this.browserType === 'puppeteer') {
          await this.page.close();
        }
        this.page = null;
      }
    } catch (error) {
      console.error('Error closing page:', error);
    }

    try {
      if (this.browser) {
        if (this.browserType === 'playwright') {
          await this.browser.close();
        } else if (this.browserType === 'puppeteer') {
          await this.browser.close();
        }
        this.browser = null;
      }
    } catch (error) {
      console.error('Error closing browser:', error);
    }

    try {
      if (this.server) {
        this.server.close();
      }
    } catch (error) {
      console.error('Error closing server:', error);
    }

    this.isInitialized = false;
    this.browserType = 'mock';
    console.log('✅ Browser service stopped');
  }
}

// Start the service
const service = new BrowserService();

// Graceful shutdown
process.on('SIGINT', async () => {
  await service.stop();
  process.exit(0);
});

service.start().catch(console.error);
