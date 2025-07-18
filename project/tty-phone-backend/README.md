# TTY Phone Interface - Real-Time 2-Way Communication

A web-based TTY communication tool for deaf and mute users with real-time speech-to-text transcription. This system provides complete 2-way communication through phone calls.

## 🚀 Current Status: FULLY DEPLOYED & WORKING

- ✅ **Frontend**: Running locally at `http://localhost:5173`
- ✅ **Backend**: Deployed at `https://tty-phone-interface.onrender.com`
- ✅ **Real Phone Calls**: Working with Twilio integration
- ✅ **2-Way Communication**: Messages spoken + responses transcribed
- ✅ **Real-time Transcription**: Speech-to-text working properly
- ✅ **Twilio Phone Number**: +18555945773

## 🎯 How It Works

### Perfect 2-Way Communication
1. **You type** → System speaks your message clearly to the other person
2. **They respond** → Their speech is automatically transcribed to text on your screen
3. **Real-time** → Transcriptions appear within 10-30 seconds of them speaking
4. **Conference-based** → Reliable connection with automatic recording for transcription

### Key Features
- **📞 Real Phone Calls**: Call any phone number worldwide using +18555945773
- **🗣️ Text-to-Speech**: Your messages spoken clearly with adjustable voice settings
- **📝 Speech-to-Text**: Their responses automatically transcribed in real-time
- **⚡ Quick Responses**: Pre-set phrases for faster communication
- **🎛️ Voice Controls**: Adjust speech rate, voice, and volume
- **⌨️ Keyboard Shortcuts**: Efficient operation for power users
- **📱 Responsive Design**: Works on desktop, tablet, and mobile

## 🔧 Setup Instructions

### Backend Setup
Your backend is deployed on Render at: `https://tty-phone-interface.onrender.com`

**Required Environment Variables (set in Render dashboard):**
- `TWILIO_ACCOUNT_SID` - Your Twilio Account SID
- `TWILIO_AUTH_TOKEN` - Your Twilio Auth Token  
- `TWILIO_PHONE_NUMBER` - Your Twilio phone number (format: +1234567890)
- `PORT` - Set to 10000
- `NODE_ENV` - Set to production

**⚠️ SECURITY NOTE:** Never commit credentials to GitHub. Always use environment variables in your hosting platform.

### Frontend (Local Development)
```bash
# Start the frontend
npm run dev

# Open browser to: http://localhost:5173
```

## 📞 Using the System

### Making Your First Call
1. **Enter Phone Number**: Use format `(555) 123-4567` or `+15551234567`  
2. **Click "Call"**: Wait 2-3 seconds for connection from your Twilio number
3. **Start Typing**: Use the large text area for your message
4. **Send Message**: Click "Speak Message" or press `Ctrl+Enter`
5. **Listen for Response**: The other person will hear your message clearly
6. **Read Their Response**: Their speech appears as text in the transcription area
7. **Continue Conversation**: Keep typing and sending messages
8. **End Call**: Click "End Call" when finished

### Keyboard Shortcuts
- **`Ctrl+Enter`**: Send current message
- **`Ctrl+D`**: Start or end call
- **`Ctrl+K`**: Focus on text input

### Quick Response Templates
Use the pre-set buttons for common phrases:
- "Hello, can you hear me?"
- "Please hold on a moment"
- "Thank you for waiting"
- "Could you please repeat that?"

## 🔧 Technical Architecture

```
Frontend (React + TypeScript) [Local]
    ↕ HTTPS Requests
Backend (Node.js + Express) [Render]
    ↕ Twilio API
Twilio Conference System (+18555945773)
    ↕ Phone Network
Recipient's Phone
```

### Key Components
- **Conference-based Calls**: Reliable 2-way audio with recording
- **Real-time Transcription**: Automatic speech-to-text conversion via webhooks
- **Webhook System**: Handles transcription callbacks from Twilio at Render URL
- **Message Queue**: Ensures reliable message delivery through conferences

## 🎛️ Speech Settings

Customize how your messages sound:
- **Speed**: 0.5x to 2.0x (recommended: 0.9x for clarity)
- **Voice**: Choose from available system voices (Alice recommended)
- **Volume**: 0% to 100%

## 🔍 Troubleshooting

### Common Issues

**"No transcription appearing"**
- Transcriptions take 10-30 seconds to appear after they finish speaking
- Ask the other person to speak clearly and pause between sentences
- Background noise can affect transcription accuracy
- Ensure they're speaking into the phone clearly

**"Messages not being spoken clearly"**
- Check that you're hearing actual speech, not beeps
- Adjust speech rate to 0.9x for better clarity
- Try different voices in speech settings
- Ensure good internet connection

**"Call connection issues"**
- Check phone number format (include country code for international)
- Verify the number can receive calls from +18555945773
- Verify the number can receive calls from your Twilio number
- Some carriers may block automated calls - try a different number

**"Backend connection errors"**
- Backend is deployed at: `https://tty-phone-interface.onrender.com`
- Check `/api/health` endpoint for status
- Render may take 30 seconds to wake up if idle

### Testing the System

1. **Health Check**: Visit `https://tty-phone-interface.onrender.com/api/health`
2. **Test Call**: Call your own phone to test speech quality
3. **Transcription Test**: Have someone speak clearly to test transcription
4. **Full Conversation**: Try a complete back-and-forth conversation

## 💰 Costs

### Twilio Pricing (Approximate)
- **Outbound Calls**: ~$0.013 per minute (US)
- **Phone Number**: ~$1.15 per month (+18555945773)
- **Recording/Transcription**: ~$0.0025 per minute
- **Conference**: ~$0.0025 per participant per minute

### Hosting Costs
- **Frontend**: Free (local development)
- **Backend**: Free tier on Render (with usage limits)

**Total Monthly Cost**: ~$2-5 for regular use

## 🔒 Security & Privacy

- **No Message Storage**: Messages are not permanently saved
- **Session-Based**: Call history clears when call ends
- **Encrypted Transmission**: All API calls use HTTPS
- **Twilio Security**: SOC 2, HIPAA compliant infrastructure
- **Environment Variables**: Credentials secured in Render environment

## 🚀 Deployment Status

### Current Setup
- **Backend**: ✅ Deployed on Render (`https://tty-phone-interface.onrender.com`)
- **Frontend**: ✅ Running locally (`http://localhost:5173`)
- **Twilio Integration**: ✅ Configured with your Twilio credentials
- **Twilio Phone Number**: ✅ Your assigned Twilio number
- **2-Way Communication**: ✅ Working with real-time transcription
- **Webhook Endpoints**: ✅ Configured for transcription callbacks

### File Structure (Cleaned)
```
tty-phone-interface/
├── src/
│   ├── components/
│   │   └── PhoneInterface.tsx    # Main UI component
│   ├── App.tsx                   # Root component
│   └── main.tsx                  # Entry point
├── tty-phone-backend/            # Backend server (deployed)
│   ├── server.js                 # Express server with Twilio
│   ├── package.json              # Backend dependencies
│   └── .env                      # Your Twilio credentials
└── README.md                     # This file
```

## 🎉 Ready to Use!

Your TTY Phone Interface is **fully deployed and ready for daily use**:

1. **Frontend**: Start with `npm run dev` at `http://localhost:5173`
2. **Backend**: Deployed at `https://tty-phone-interface.onrender.com`
3. **Real Calls**: Make actual phone calls with 2-way communication using your Twilio number
4. **Transcription**: Real-time speech-to-text working with webhook system

**Start making calls now!** The system provides complete 2-way TTY communication with professional-quality speech synthesis and real-time transcription.

---

**Perfect for deaf users**: This system eliminates the need for interpreters or relay services. You type messages that are spoken clearly to the other person, and their responses are automatically transcribed to text on your screen in real-time.

## 🔄 Next Steps

1. **Test the system** with a friend or family member
2. **Adjust speech settings** for optimal clarity
3. **Practice using quick responses** for common phrases
4. **Consider upgrading Twilio plan** for higher usage limits if needed

Your TTY phone system is now fully operational! 🎉
