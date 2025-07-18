const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'https://your-frontend-domain.com'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Twilio client
let client;
try {
  console.log('Initializing Twilio client...');
  console.log('Account SID:', process.env.TWILIO_ACCOUNT_SID ? 'Set' : 'Missing');
  console.log('Auth Token:', process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'Missing');
  console.log('Phone Number:', process.env.TWILIO_PHONE_NUMBER);
  
  client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio client initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize Twilio client:', error);
  process.exit(1);
}

// Store active calls and streams
const activeCalls = new Map();
const activeStreams = new Map();

// Get the base URL for webhooks
const getBaseUrl = () => {
  return process.env.NODE_ENV === 'production' 
    ? 'https://tty-phone-interface.onrender.com'
    : `http://localhost:${port}`;
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'TTY Phone Backend with Live Audio Streaming', 
    timestamp: new Date(),
    port: port,
    baseUrl: getBaseUrl(),
    twilioConfigured: !!client,
    features: ['Live Audio Streaming', 'WebRTC', 'Real-time Communication']
  });
});

// Generate access token for WebRTC
app.post('/api/access-token', (req, res) => {
  try {
    const { identity } = req.body;
    
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const accessToken = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN,
      { identity: identity }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    accessToken.addGrant(voiceGrant);

    res.json({
      success: true,
      token: accessToken.toJwt(),
      identity: identity
    });
  } catch (error) {
    console.error('Error generating access token:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// TwiML for outgoing calls with live streaming
app.post('/twiml/outgoing-call', (req, res) => {
  const { To, From } = req.body;
  console.log(`Outgoing call TwiML: ${From} calling ${To}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Start live audio stream to the web interface
  const start = twiml.start();
  start.stream({
    name: 'live-audio-stream',
    url: `wss://${getBaseUrl().replace('https://', '').replace('http://', '')}/websocket/audio-stream`
  });
  
  // Dial the number
  const dial = twiml.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER
  });
  dial.number(To);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// TwiML for speaking messages during call
app.post('/twiml/speak-message', (req, res) => {
  const { message, voice = 'alice', rate = '1.0' } = req.body;
  
  console.log(`Speaking message: "${message}"`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  if (message) {
    // Map voice names to Twilio voices
    let twilioVoice = 'alice';
    if (voice && typeof voice === 'string') {
      const voiceLower = voice.toLowerCase();
      if (voiceLower.includes('male') && !voiceLower.includes('female')) {
        twilioVoice = 'man';
      } else if (voiceLower.includes('woman')) {
        twilioVoice = 'woman';
      }
    }
    
    twiml.say({
      voice: twilioVoice,
      rate: rate
    }, message.replace(/[<>&"']/g, (match) => {
      const escapeMap = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
      return escapeMap[match];
    }));
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// WebSocket server for live audio streaming
const WebSocket = require('ws');
const http = require('http');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  console.log('WebSocket connection established');
  
  if (req.url === '/websocket/audio-stream') {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.event === 'connected') {
          console.log('Audio stream connected');
        } else if (data.event === 'start') {
          console.log('Audio stream started');
        } else if (data.event === 'media') {
          // Forward audio data to frontend clients
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: 'audio',
                payload: data.media.payload
              }));
            }
          });
        } else if (data.event === 'stop') {
          console.log('Audio stream stopped');
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('Audio stream WebSocket closed');
    });
  }
});

// Initiate WebRTC call with live audio streaming
app.post('/api/initiate-webrtc-call', async (req, res) => {
  try {
    const { to, identity } = req.body;
    
    console.log(`Initiating WebRTC call from ${identity} to: ${to}`);
    
    // Create the call using WebRTC
    const call = await client.calls.create({
      to: to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${getBaseUrl()}/twiml/outgoing-call`,
      method: 'POST',
      statusCallback: `${getBaseUrl()}/webhook/call-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });

    // Store call data
    activeCalls.set(call.sid, {
      sid: call.sid,
      to: to,
      identity: identity,
      status: call.status,
      startTime: new Date(),
      isActive: true,
      messagesSent: []
    });

    console.log(`✅ WebRTC call initiated successfully: ${call.sid}`);
    
    res.json({
      success: true,
      callSid: call.sid,
      status: call.status,
      to: to,
      streamingEnabled: true
    });
  } catch (error) {
    console.error('❌ Error initiating WebRTC call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code 
    });
  }
});

// Traditional call initiation (fallback)
app.post('/api/initiate-call', async (req, res) => {
  try {
    const { to } = req.body;
    
    console.log(`Initiating traditional call to: ${to}`);
    
    const call = await client.calls.create({
      to: to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${getBaseUrl()}/twiml/outgoing-call`,
      method: 'POST',
      statusCallback: `${getBaseUrl()}/webhook/call-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });

    activeCalls.set(call.sid, {
      sid: call.sid,
      to: to,
      status: call.status,
      startTime: new Date(),
      isActive: true,
      messagesSent: []
    });

    console.log(`✅ Traditional call initiated successfully: ${call.sid}`);
    
    res.json({
      success: true,
      callSid: call.sid,
      status: call.status,
      to: to,
      streamingEnabled: false
    });
  } catch (error) {
    console.error('❌ Error initiating call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code 
    });
  }
});

// Speak text during call
app.post('/api/speak-text', async (req, res) => {
  try {
    const { callSid, text, voice = 'alice', rate = '1.0' } = req.body;
    
    const callData = activeCalls.get(callSid);
    if (!callData || !callData.isActive) {
      return res.status(404).json({ 
        success: false, 
        error: 'Call not found or ended' 
      });
    }

    console.log(`Sending message to call ${callSid}: "${text}"`);
    
    // Create TwiML for speaking the message
    const speakTwiML = `<Response>
      <Say voice="${voice.includes('male') && !voice.includes('female') ? 'man' : voice.includes('woman') ? 'woman' : 'alice'}" rate="${rate}">${text.replace(/[<>&"']/g, (match) => {
        const escapeMap = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };
        return escapeMap[match];
      })}</Say>
    </Response>`;
    
    // Update the call with TwiML
    await client.calls(callSid).update({
      twiml: speakTwiML
    });

    // Track sent messages
    callData.messagesSent.push({
      text,
      timestamp: new Date(),
      voice,
      rate
    });

    console.log(`✅ Message sent successfully`);
    
    res.json({ success: true, message: 'Text spoken successfully' });
  } catch (error) {
    console.error('❌ Error speaking text:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Call status webhook
app.post('/webhook/call-status', (req, res) => {
  const { CallSid, CallStatus } = req.body;
  
  console.log(`Call status update: ${CallSid} is now ${CallStatus}`);
  
  const callData = activeCalls.get(CallSid);
  if (callData) {
    callData.status = CallStatus;
    
    if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled') {
      callData.isActive = false;
      console.log(`Call ${CallSid} ended with status: ${CallStatus}`);
    }
  }
  
  res.status(200).send('OK');
});

// Get call status
app.get('/api/call-status/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    
    const callData = activeCalls.get(callSid);
    
    if (!callData) {
      return res.status(404).json({ 
        success: false, 
        error: 'Call not found' 
      });
    }
    
    res.json({
      success: true,
      status: callData.status,
      isActive: callData.isActive,
      startTime: callData.startTime,
      messagesSent: callData.messagesSent || [],
      streamingEnabled: true
    });
  } catch (error) {
    console.error('❌ Error fetching call status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// End call
app.post('/api/end-call', async (req, res) => {
  try {
    const { callSid } = req.body;
    
    const callData = activeCalls.get(callSid);
    if (!callData) {
      return res.status(404).json({ 
        success: false, 
        error: 'Call not found' 
      });
    }

    console.log(`Ending call: ${callSid}`);

    try {
      await client.calls(callSid).update({
        twiml: '<Response><Say voice="alice">Thank you for using TTY service. Goodbye.</Say><Hangup/></Response>'
      });
    } catch (twilioError) {
      console.log('Call may have already ended:', twilioError.message);
    }

    callData.isActive = false;

    res.json({ success: true, message: 'Call ended successfully' });
  } catch (error) {
    console.error('❌ Error ending call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// List active calls
app.get('/api/active-calls', (req, res) => {
  const calls = Array.from(activeCalls.values());
  res.json({ 
    success: true, 
    activeCalls: calls
  });
});

server.listen(port, () => {
  console.log(`🚀 TTY Phone Backend with Live Audio Streaming running on port ${port}`);
  console.log(`📞 Twilio integration ready`);
  console.log(`🌐 Webhook base URL: ${getBaseUrl()}`);
  console.log(`🎵 Live audio streaming enabled via WebSocket`);
  console.log(`🔊 Real-time voice-to-voice communication`);
  console.log(`⚡ WebRTC support for live audio`);
});
