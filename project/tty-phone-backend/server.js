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

// Store active calls with real-time data
const activeCalls = new Map();

// Get the base URL for webhooks
const getBaseUrl = () => {
  return process.env.NODE_ENV === 'production' 
    ? 'https://tty-phone-interface.onrender.com'
    : `http://localhost:${port}`;
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'TTY Phone Backend running successfully', 
    timestamp: new Date(),
    port: port,
    baseUrl: getBaseUrl(),
    twilioConfigured: !!client
  });
});

// TwiML endpoint for initial call setup
app.post('/twiml/initial-greeting', (req, res) => {
  const { CallSid, From, To } = req.body;
  console.log(`Initial greeting for call: ${CallSid}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Brief, clear greeting
  twiml.say({
    voice: 'alice',
    rate: '1.0'
  }, 'Hello, you are connected to a TTY communication service. The caller will send you messages that will be spoken to you. Please wait for their first message.');
  
  // Short pause then start listening
  twiml.pause({ length: 2 });
  
  // Redirect to listening mode
  twiml.redirect(`${getBaseUrl()}/twiml/listen-mode`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// TwiML endpoint for continuous listening (no repetition)
app.post('/twiml/listen-mode', (req, res) => {
  const { CallSid } = req.body;
  console.log(`Listen mode for call: ${CallSid}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Start recording for real-time transcription
  twiml.record({
    timeout: 3, // Stop recording after 3 seconds of silence
    transcribe: true,
    transcribeCallback: `${getBaseUrl()}/webhook/transcription`,
    playBeep: false,
    maxLength: 30, // Max 30 seconds per recording
    action: `${getBaseUrl()}/twiml/listen-mode` // Loop back to keep listening
  });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// TwiML endpoint for speaking messages (then return to listening)
app.post('/twiml/speak-message', (req, res) => {
  const { message, voice = 'alice', rate = '1.0' } = req.query;
  const { CallSid } = req.body;
  
  console.log(`Speaking message to call ${CallSid}: "${message}"`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  if (message) {
    // Speak the message clearly
    twiml.say({
      voice: voice,
      rate: rate
    }, message);
    
    // Brief pause
    twiml.pause({ length: 1 });
  }
  
  // Return to listening mode immediately (no prompts)
  twiml.redirect(`${getBaseUrl()}/twiml/listen-mode`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Real-time transcription webhook
app.post('/webhook/transcription', (req, res) => {
  const { TranscriptionText, CallSid, RecordingSid, TranscriptionStatus, RecordingUrl } = req.body;
  
  console.log('Transcription webhook received:', {
    CallSid,
    TranscriptionStatus,
    TranscriptionText: TranscriptionText || 'No text',
    RecordingUrl
  });
  
  if (CallSid && activeCalls.has(CallSid)) {
    const callData = activeCalls.get(CallSid);
    
    // Add transcription if available
    if (TranscriptionStatus === 'completed' && TranscriptionText && TranscriptionText.trim()) {
      if (!callData.transcriptions) {
        callData.transcriptions = [];
      }
      
      callData.transcriptions.push({
        text: TranscriptionText.trim(),
        timestamp: new Date(),
        recordingSid: RecordingSid,
        recordingUrl: RecordingUrl
      });
      
      console.log(`✅ Real-time transcription added for call ${CallSid}: "${TranscriptionText}"`);
    }
    
    // Always add recording URL for audio playback option
    if (RecordingUrl) {
      if (!callData.recordings) {
        callData.recordings = [];
      }
      
      callData.recordings.push({
        url: RecordingUrl,
        timestamp: new Date(),
        recordingSid: RecordingSid,
        transcription: TranscriptionText || null
      });
      
      console.log(`🎵 Audio recording available for call ${CallSid}: ${RecordingUrl}`);
    }
  }
  
  res.status(200).send('OK');
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

// Initiate a call
app.post('/api/initiate-call', async (req, res) => {
  try {
    const { to } = req.body;
    
    console.log(`Initiating call to: ${to}`);
    
    // Create the call with initial greeting
    const call = await client.calls.create({
      to: to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${getBaseUrl()}/twiml/initial-greeting`,
      method: 'POST',
      statusCallback: `${getBaseUrl()}/webhook/call-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      record: true // Enable call recording for backup
    });

    // Store call data
    activeCalls.set(call.sid, {
      sid: call.sid,
      to: to,
      status: call.status,
      startTime: new Date(),
      isActive: true,
      transcriptions: [],
      recordings: [],
      messagesSent: []
    });

    console.log(`✅ Call initiated successfully: ${call.sid}`);
    
    res.json({
      success: true,
      callSid: call.sid,
      status: call.status,
      to: to
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

// Speak text during call (no repetition)
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
    
    // Update the call to speak the message once, then return to listening
    await client.calls(callSid).update({
      url: `${getBaseUrl()}/twiml/speak-message?message=${encodeURIComponent(text)}&voice=${voice}&rate=${rate}`,
      method: 'POST'
    });

    // Track sent messages
    callData.messagesSent.push({
      text,
      timestamp: new Date(),
      voice,
      rate
    });

    console.log(`✅ Message sent successfully (no repetition)`);
    
    res.json({ success: true, message: 'Text spoken successfully' });
  } catch (error) {
    console.error('❌ Error speaking text:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get call status with real-time transcriptions and recordings
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
      transcriptions: callData.transcriptions || [],
      recordings: callData.recordings || [], // For audio playback
      messagesSent: callData.messagesSent || []
    });
  } catch (error) {
    console.error('❌ Error fetching call status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// End call gracefully
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
      // End with a brief goodbye
      await client.calls(callSid).update({
        twiml: '<Response><Say voice="alice" rate="1.0">Thank you for using TTY service. Goodbye.</Say><Hangup/></Response>'
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

app.listen(port, () => {
  console.log(`🚀 TTY Phone Backend running on port ${port}`);
  console.log(`📞 Twilio integration ready`);
  console.log(`🌐 Webhook base URL: ${getBaseUrl()}`);
  console.log(`🎤 Real-time transcription enabled`);
  console.log(`🔊 Audio playback support included`);
  console.log(`⚡ No message repetition - single delivery`);
});
