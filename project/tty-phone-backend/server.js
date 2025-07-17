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

// Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Store active calls and conferences
const activeCalls = new Map();
const activeConferences = new Map();

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
    baseUrl: getBaseUrl()
  });
});

// Webhook to handle conference events
app.post('/webhook/conference-status', (req, res) => {
  const { ConferenceSid, StatusCallbackEvent, CallSid, Muted } = req.body;
  
  console.log(`Conference Event: ${StatusCallbackEvent} for conference ${ConferenceSid}`);
  
  if (StatusCallbackEvent === 'participant-join') {
    console.log(`Participant ${CallSid} joined conference ${ConferenceSid}`);
  } else if (StatusCallbackEvent === 'participant-leave') {
    console.log(`Participant ${CallSid} left conference ${ConferenceSid}`);
  }
  
  res.status(200).send('OK');
});

// Webhook to handle call recordings and transcriptions
app.post('/webhook/recording-transcription', (req, res) => {
  const { TranscriptionText, CallSid, RecordingSid, TranscriptionStatus } = req.body;
  
  console.log('Transcription webhook received:', {
    CallSid,
    RecordingSid,
    TranscriptionStatus,
    TranscriptionText
  });
  
  if (TranscriptionStatus === 'completed' && TranscriptionText) {
    // Find the conference this call belongs to
    for (let [conferenceId, conferenceData] of activeConferences) {
      if (conferenceData.participantCallSid === CallSid) {
        if (!conferenceData.transcriptions) {
          conferenceData.transcriptions = [];
        }
        
        conferenceData.transcriptions.push({
          text: TranscriptionText,
          timestamp: new Date(),
          callSid: CallSid
        });
        
        console.log(`Added transcription for conference ${conferenceId}: "${TranscriptionText}"`);
        break;
      }
    }
  }
  
  res.status(200).send('OK');
});

// Initiate a call with conference
app.post('/api/initiate-call', async (req, res) => {
  try {
    const { to } = req.body;
    
    console.log(`Initiating call to: ${to}`);
    
    // Create a conference first
    const conference = await client.conferences.create({
      friendlyName: `TTY-Call-${Date.now()}`,
      statusCallback: `${getBaseUrl()}/webhook/conference-status`,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      record: 'record-from-start',
      recordingStatusCallback: `${getBaseUrl()}/webhook/recording-transcription`
    });
    
    console.log(`Conference created: ${conference.sid}`);
    
    // Call the target number and connect to conference
    const call = await client.calls.create({
      to: to,
      from: process.env.TWILIO_PHONE_NUMBER,
      twiml: `<Response>
        <Say voice="alice" rate="0.9">
          Hello, you are now connected to a TTY communication service. 
          You will hear messages from the caller, and your responses will be transcribed for them to read.
          Please speak clearly after each message you hear.
        </Say>
        <Dial>
          <Conference 
            startConferenceOnEnter="true" 
            endConferenceOnExit="false"
            record="record-from-start"
            recordingStatusCallback="${getBaseUrl()}/webhook/recording-transcription"
            transcribe="true"
            transcribeCallback="${getBaseUrl()}/webhook/recording-transcription"
          >${conference.sid}</Conference>
        </Dial>
      </Response>`
    });

    // Store conference and call data
    activeConferences.set(conference.sid, {
      sid: conference.sid,
      participantCallSid: call.sid,
      to: to,
      startTime: new Date(),
      isActive: true,
      transcriptions: [],
      messageQueue: []
    });

    activeCalls.set(call.sid, {
      sid: call.sid,
      conferenceSid: conference.sid,
      to: to,
      status: call.status,
      startTime: new Date(),
      isActive: true
    });

    console.log(`Call initiated successfully: ${call.sid}, Conference: ${conference.sid}`);
    
    res.json({
      success: true,
      callSid: call.sid,
      conferenceSid: conference.sid,
      status: call.status,
      to: to
    });
  } catch (error) {
    console.error('Error initiating call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code 
    });
  }
});

// Speak text during call using conference
app.post('/api/speak-text', async (req, res) => {
  try {
    const { callSid, text } = req.body;
    
    const callData = activeCalls.get(callSid);
    if (!callData || !callData.isActive) {
      return res.status(404).json({ 
        success: false, 
        error: 'Call not found or ended' 
      });
    }

    console.log(`Speaking text to conference: "${text}"`);
    
    // Create a new call that joins the conference and speaks the message
    const speakCall = await client.calls.create({
      to: callData.to,
      from: process.env.TWILIO_PHONE_NUMBER,
      twiml: `<Response>
        <Say voice="alice" rate="0.9">${text}</Say>
        <Pause length="3"/>
        <Say voice="alice" rate="0.8">Please respond now if you have something to say.</Say>
        <Pause length="5"/>
        <Hangup/>
      </Response>`
    });

    // Add to message queue for the conference
    const conferenceData = activeConferences.get(callData.conferenceSid);
    if (conferenceData) {
      conferenceData.messageQueue.push({
        text,
        timestamp: new Date(),
        spoken: true
      });
    }

    console.log(`Message spoken successfully via call: ${speakCall.sid}`);
    
    res.json({ success: true, message: 'Text spoken successfully' });
  } catch (error) {
    console.error('Error speaking text:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// End call and conference
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

    console.log(`Ending call: ${callSid} and conference: ${callData.conferenceSid}`);

    try {
      // End the conference
      if (callData.conferenceSid) {
        await client.conferences(callData.conferenceSid).update({ status: 'completed' });
        
        const conferenceData = activeConferences.get(callData.conferenceSid);
        if (conferenceData) {
          conferenceData.isActive = false;
        }
      }
      
      // End the call
      await client.calls(callSid).update({ status: 'completed' });
    } catch (twilioError) {
      console.log('Call/Conference may have already ended:', twilioError.message);
    }

    callData.isActive = false;
    activeCalls.set(callSid, callData);

    res.json({ success: true, message: 'Call ended successfully' });
  } catch (error) {
    console.error('Error ending call:', error);
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
    
    const localCallData = activeCalls.get(callSid);
    if (!localCallData) {
      return res.status(404).json({ 
        success: false, 
        error: 'Call not found' 
      });
    }
    
    // Get conference data for transcriptions
    const conferenceData = activeConferences.get(localCallData.conferenceSid);
    
    res.json({
      success: true,
      status: localCallData.status,
      isActive: localCallData.isActive,
      startTime: localCallData.startTime,
      transcriptions: conferenceData ? conferenceData.transcriptions : [],
      messageQueue: conferenceData ? conferenceData.messageQueue : []
    });
  } catch (error) {
    console.error('Error fetching call status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// List active calls and conferences
app.get('/api/active-calls', (req, res) => {
  const calls = Array.from(activeCalls.values());
  const conferences = Array.from(activeConferences.values());
  res.json({ 
    success: true, 
    activeCalls: calls,
    activeConferences: conferences
  });
});

app.listen(port, () => {
  console.log(`🚀 TTY Phone Backend running on port ${port}`);
  console.log(`📞 Twilio integration ready with conference support`);
  console.log(`🌐 Webhook base URL: ${getBaseUrl()}`);
  console.log(`🎤 Real-time transcription enabled`);
});