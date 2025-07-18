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

// Initialize Twilio client properly
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

// Store active calls
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

// TwiML endpoint for handling calls
app.post('/twiml/call-handler', (req, res) => {
  const { CallSid, From, To } = req.body;
  console.log(`Call handler webhook: ${CallSid} from ${From} to ${To}`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  // Initial greeting
  twiml.say({
    voice: 'alice',
    rate: '0.9'
  }, 'Hello, you are now connected to a TTY communication service. Please hold while the caller prepares their message.');
  
  // Pause to let them process
  twiml.pause({ length: 2 });
  
  // Keep the call alive and wait for updates
  twiml.say({
    voice: 'alice',
    rate: '0.8'
  }, 'You will hear messages from the caller. Please speak clearly after each message for transcription.');
  
  // Long pause to keep call active
  twiml.pause({ length: 30 });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// TwiML endpoint for speaking messages
app.post('/twiml/speak-message', (req, res) => {
  const { message, voice = 'alice', rate = '0.9' } = req.query;
  console.log(`Speaking message: "${message}"`);
  
  const twiml = new twilio.twiml.VoiceResponse();
  
  if (message) {
    twiml.say({
      voice: voice,
      rate: rate
    }, message);
  }
  
  // Pause after message
  twiml.pause({ length: 3 });
  
  // Prompt for response
  twiml.say({
    voice: 'alice',
    rate: '0.8'
  }, 'Please respond now if you have something to say.');
  
  // Record their response for transcription
  twiml.record({
    timeout: 10,
    transcribe: true,
    transcribeCallback: `${getBaseUrl()}/webhook/transcription`,
    playBeep: false,
    maxLength: 30
  });
  
  // Keep call alive
  twiml.pause({ length: 5 });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Webhook for transcription results
app.post('/webhook/transcription', (req, res) => {
  const { TranscriptionText, CallSid, RecordingSid, TranscriptionStatus } = req.body;
  
  console.log('Transcription webhook received:', {
    CallSid,
    RecordingSid,
    TranscriptionStatus,
    TranscriptionText
  });
  
  if (TranscriptionStatus === 'completed' && TranscriptionText) {
    // Find the call and add transcription
    const callData = activeCalls.get(CallSid);
    if (callData) {
      if (!callData.transcriptions) {
        callData.transcriptions = [];
      }
      
      callData.transcriptions.push({
        text: TranscriptionText,
        timestamp: new Date(),
        recordingSid: RecordingSid
      });
      
      console.log(`✅ Added transcription for call ${CallSid}: "${TranscriptionText}"`);
    }
  }
  
  res.status(200).send('OK');
});

// Initiate a call
app.post('/api/initiate-call', async (req, res) => {
  try {
    const { to } = req.body;
    
    console.log(`Initiating call to: ${to}`);
    
    // Create the call with TwiML webhook
    const call = await client.calls.create({
      to: to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `${getBaseUrl()}/twiml/call-handler`,
      method: 'POST',
      statusCallback: `${getBaseUrl()}/webhook/call-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });

    // Store call data
    activeCalls.set(call.sid, {
      sid: call.sid,
      to: to,
      status: call.status,
      startTime: new Date(),
      isActive: true,
      transcriptions: [],
      messageQueue: []
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

// Speak text during call
app.post('/api/speak-text', async (req, res) => {
  try {
    const { callSid, text, voice = 'alice', rate = '0.9' } = req.body;
    
    const callData = activeCalls.get(callSid);
    if (!callData || !callData.isActive) {
      return res.status(404).json({ 
        success: false, 
        error: 'Call not found or ended' 
      });
    }

    console.log(`Speaking text to call ${callSid}: "${text}"`);
    
    // Update the call with new TwiML to speak the message
    await client.calls(callSid).update({
      url: `${getBaseUrl()}/twiml/speak-message?message=${encodeURIComponent(text)}&voice=${voice}&rate=${rate}`,
      method: 'POST'
    });

    // Add to message queue
    callData.messageQueue.push({
      text,
      timestamp: new Date(),
      spoken: true
    });

    console.log(`✅ Message update sent successfully`);
    
    res.json({ success: true, message: 'Text spoken successfully' });
  } catch (error) {
    console.error('❌ Error speaking text:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Webhook for call status updates
app.post('/webhook/call-status', (req, res) => {
  const { CallSid, CallStatus, From, To } = req.body;
  
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
      // Update call with goodbye message then hang up
      await client.calls(callSid).update({
        url: `${getBaseUrl()}/twiml/speak-message?message=${encodeURIComponent('Thank you for using TTY service. Goodbye.')}&voice=alice&rate=0.9`,
        method: 'POST'
      });
      
      // Wait a moment then hang up
      setTimeout(async () => {
        try {
          await client.calls(callSid).update({ status: 'completed' });
        } catch (e) {
          console.log('Call may have already ended');
        }
      }, 3000);
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

// Get call status with transcriptions
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
      messageQueue: callData.messageQueue || []
    });
  } catch (error) {
    console.error('❌ Error fetching call status:', error);
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
  console.log(`🎤 TwiML-based approach for reliable 2-way communication`);
  console.log(`📋 Transcription webhooks configured`);
});
