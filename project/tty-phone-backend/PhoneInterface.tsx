import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneCall, PhoneOff, Volume2, Settings, MessageCircle, Keyboard, VolumeX, Mic, MicOff } from 'lucide-react';
import axios from 'axios';

// Backend API configuration
const API_BASE_URL = 'https://tty-phone-interface.onrender.com';

interface CallState {
  isActive: boolean;
  isConnecting: boolean;
  phoneNumber: string;
  startTime: Date | null;
  duration: string;
  callSid: string | null;
  streamingEnabled: boolean;
  audioConnected: boolean;
}

interface Message {
  id: string;
  text: string;
  timestamp: Date;
  spoken: boolean;
}

interface SpeechSettings {
  rate: number;
  pitch: number;
  volume: number;
  voice: string;
}

const PhoneInterface: React.FC = () => {
  const [callState, setCallState] = useState<CallState>({
    isActive: false,
    isConnecting: false,
    phoneNumber: '',
    startTime: null,
    duration: '00:00:00',
    callSid: null,
    streamingEnabled: false,
    audioConnected: false
  });

  const [currentMessage, setCurrentMessage] = useState('');
  const [messageHistory, setMessageHistory] = useState<Message[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState(1.0);
  const [speechSettings, setSpeechSettings] = useState<SpeechSettings>({
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voice: 'alice'
  });

  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const statusCheckIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const audioElementRef = useRef<HTMLAudioElement>(null);

  // Quick response templates
  const quickResponses = [
    "Hello, can you hear me?",
    "Please hold on a moment",
    "Thank you for waiting",
    "I understand",
    "Could you please repeat that?",
    "I need to check something",
    "Yes, that's correct",
    "No, that's not right"
  ];

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (voices.length > 0 && speechSettings.voice === 'alice') {
        const preferredVoice = voices.find(v => 
          v.name.toLowerCase().includes('female') || 
          v.name.toLowerCase().includes('woman') ||
          v.name.toLowerCase().includes('alice')
        );
        if (preferredVoice) {
          setSpeechSettings(prev => ({ ...prev, voice: preferredVoice.name }));
        }
      }
    };

    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);

    return () => {
      speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  // Initialize audio context for live streaming
  useEffect(() => {
    const initAudioContext = async () => {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        console.log('Audio context initialized for live streaming');
      } catch (error) {
        console.error('Failed to initialize audio context:', error);
      }
    };

    initAudioContext();

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // WebSocket connection for live audio streaming
  useEffect(() => {
    if (callState.isActive && callState.streamingEnabled) {
      const wsUrl = API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://') + '/websocket/audio-stream';
      
      try {
        websocketRef.current = new WebSocket(wsUrl);
        
        websocketRef.current.onopen = () => {
          console.log('Live audio WebSocket connected');
          setCallState(prev => ({ ...prev, audioConnected: true }));
        };
        
        websocketRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'audio' && audioContextRef.current && !audioMuted) {
              // Decode and play audio data
              const audioData = atob(data.payload);
              const audioBuffer = new ArrayBuffer(audioData.length);
              const view = new Uint8Array(audioBuffer);
              
              for (let i = 0; i < audioData.length; i++) {
                view[i] = audioData.charCodeAt(i);
              }
              
              // Play audio through Web Audio API
              audioContextRef.current.decodeAudioData(audioBuffer)
                .then(buffer => {
                  const source = audioContextRef.current!.createBufferSource();
                  const gainNode = audioContextRef.current!.createGain();
                  
                  source.buffer = buffer;
                  gainNode.gain.value = audioVolume;
                  
                  source.connect(gainNode);
                  gainNode.connect(audioContextRef.current!.destination);
                  
                  source.start();
                })
                .catch(error => {
                  console.error('Audio decode error:', error);
                });
            }
          } catch (error) {
            console.error('WebSocket message error:', error);
          }
        };
        
        websocketRef.current.onclose = () => {
          console.log('Live audio WebSocket disconnected');
          setCallState(prev => ({ ...prev, audioConnected: false }));
        };
        
        websocketRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          setCallState(prev => ({ ...prev, audioConnected: false }));
        };
        
      } catch (error) {
        console.error('Failed to connect WebSocket:', error);
      }
    }

    return () => {
      if (websocketRef.current) {
        websocketRef.current.close();
      }
    };
  }, [callState.isActive, callState.streamingEnabled, audioMuted, audioVolume]);

  // Status monitoring
  useEffect(() => {
    if (callState.callSid) {
      statusCheckIntervalRef.current = window.setInterval(async () => {
        try {
          const response = await axios.get(`${API_BASE_URL}/api/call-status/${callState.callSid}`);
          if (response.data.success) {
            const { isActive } = response.data;
            
            if (!isActive && callState.isActive) {
              console.log('Call ended remotely');
              setCallState(prev => ({
                ...prev,
                isActive: false,
                isConnecting: false,
                audioConnected: false
              }));
            }
          }
        } catch (error) {
          console.error('Error checking call status:', error);
        }
      }, 2000);
    } else if (statusCheckIntervalRef.current) {
      clearInterval(statusCheckIntervalRef.current);
    }

    return () => {
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
      }
    };
  }, [callState.callSid, callState.isActive]);

  // Update call duration
  useEffect(() => {
    if (callState.isActive && callState.startTime) {
      durationIntervalRef.current = window.setInterval(() => {
        const now = new Date();
        const diff = now.getTime() - callState.startTime!.getTime();
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        
        setCallState(prev => ({
          ...prev,
          duration: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        }));
      }, 1000);
    } else if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }

    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [callState.isActive, callState.startTime]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'Enter':
            e.preventDefault();
            if (currentMessage.trim()) {
              speakMessage(currentMessage);
            }
            break;
          case 'd':
            e.preventDefault();
            if (callState.isActive) {
              endCall();
            } else {
              initiateCall();
            }
            break;
          case 'k':
            e.preventDefault();
            textAreaRef.current?.focus();
            break;
          case 'm':
            e.preventDefault();
            setAudioMuted(!audioMuted);
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentMessage, callState.isActive, audioMuted]);

  const speakMessage = async (text: string) => {
    if (!text.trim()) return;

    if (callState.isActive && callState.callSid) {
      try {
        const response = await axios.post(`${API_BASE_URL}/api/speak-text`, {
          callSid: callState.callSid,
          text,
          voice: speechSettings.voice,
          rate: speechSettings.rate.toString()
        });

        if (response.data.success) {
          console.log('Message sent successfully');
          
          const newMessage: Message = {
            id: Date.now().toString(),
            text,
            timestamp: new Date(),
            spoken: true
          };

          setMessageHistory(prev => [...prev, newMessage]);
          setCurrentMessage('');
        }
      } catch (error) {
        console.error('Error sending message:', error);
        alert('Failed to send message. Check backend connection.');
      }
    } else {
      alert('Please start a call first');
    }
  };

  const initiateCall = async () => {
    if (!callState.phoneNumber.trim()) {
      alert('Please enter a phone number');
      return;
    }

    let formattedNumber = callState.phoneNumber.replace(/\D/g, '');
    if (!formattedNumber.startsWith('1') && formattedNumber.length === 10) {
      formattedNumber = '1' + formattedNumber;
    }
    formattedNumber = '+' + formattedNumber;

    setCallState(prev => ({ ...prev, isConnecting: true }));

    try {
      console.log('Initiating live audio call to:', formattedNumber);
      
      // Try WebRTC call first for live audio streaming
      const response = await axios.post(`${API_BASE_URL}/api/initiate-webrtc-call`, {
        to: formattedNumber,
        identity: `user_${Date.now()}`
      });

      if (response.data.success) {
        console.log('Live audio call initiated successfully:', response.data);
        
        setCallState(prev => ({
          ...prev,
          isActive: true,
          isConnecting: false,
          startTime: new Date(),
          callSid: response.data.callSid,
          streamingEnabled: response.data.streamingEnabled
        }));
      } else {
        throw new Error(response.data.error || 'Failed to initiate call');
      }
    } catch (error: any) {
      console.error('Error initiating call:', error);
      
      // Fallback to traditional call
      try {
        console.log('Falling back to traditional call...');
        const fallbackResponse = await axios.post(`${API_BASE_URL}/api/initiate-call`, {
          to: formattedNumber
        });

        if (fallbackResponse.data.success) {
          setCallState(prev => ({
            ...prev,
            isActive: true,
            isConnecting: false,
            startTime: new Date(),
            callSid: fallbackResponse.data.callSid,
            streamingEnabled: false
          }));
        } else {
          throw new Error('Both WebRTC and traditional calls failed');
        }
      } catch (fallbackError: any) {
        let errorMessage = 'Failed to initiate call. ';
        if (error.response?.data?.error) {
          errorMessage += error.response.data.error;
        } else {
          errorMessage += 'Check backend connection and Twilio credentials.';
        }
        
        alert(errorMessage);
        
        setCallState(prev => ({
          ...prev,
          isConnecting: false
        }));
      }
    }
  };

  const endCall = async () => {
    if (callState.callSid) {
      try {
        await axios.post(`${API_BASE_URL}/api/end-call`, {
          callSid: callState.callSid
        });
        console.log('Call ended successfully');
      } catch (error) {
        console.error('Error ending call:', error);
      }
    }

    // Close WebSocket connection
    if (websocketRef.current) {
      websocketRef.current.close();
    }

    setCallState({
      isActive: false,
      isConnecting: false,
      phoneNumber: callState.phoneNumber,
      startTime: null,
      duration: '00:00:00',
      callSid: null,
      streamingEnabled: false,
      audioConnected: false
    });
    setMessageHistory([]);
    speechSynthesis.cancel();
  };

  const formatPhoneNumber = (value: string) => {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length <= 3) return cleaned;
    if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4">
      <audio ref={audioElementRef} style={{ display: 'none' }} />
      
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">TTY Phone Interface</h1>
          <p className="text-lg text-slate-600">Live Voice-to-Voice Communication with Real-time Audio Streaming</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Call Control Panel */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-xl p-6 border border-slate-200">
              <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Live Audio Call
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={callState.phoneNumber}
                    onChange={(e) => setCallState(prev => ({ 
                      ...prev, 
                      phoneNumber: formatPhoneNumber(e.target.value)
                    }))}
                    placeholder="(555) 123-4567"
                    className="w-full px-4 py-3 text-lg border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={callState.isActive || callState.isConnecting}
                  />
                </div>

                <div className="flex gap-3">
                  {!callState.isActive && !callState.isConnecting && (
                    <button
                      onClick={initiateCall}
                      className="flex-1 bg-green-500 hover:bg-green-600 text-white py-3 px-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center gap-2"
                    >
                      <PhoneCall className="w-5 h-5" />
                      Call
                    </button>
                  )}

                  {callState.isConnecting && (
                    <div className="flex-1 bg-yellow-500 text-white py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Connecting...
                    </div>
                  )}

                  {callState.isActive && (
                    <button
                      onClick={endCall}
                      className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 px-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center gap-2"
                    >
                      <PhoneOff className="w-5 h-5" />
                      End Call
                    </button>
                  )}
                </div>

                {callState.isActive && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-green-800">
                      <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                      <span className="font-medium">Live Audio Connected</span>
                    </div>
                    <div className="text-sm text-green-700 mt-1">
                      Duration: {callState.duration}
                    </div>
                    <div className="text-sm text-green-700">
                      To: {callState.phoneNumber}
                    </div>
                    {callState.streamingEnabled && (
                      <div className="text-xs text-green-600 mt-2 p-2 bg-green-100 rounded flex items-center gap-2">
                        {callState.audioConnected ? (
                          <>
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            <strong>🎵 Live Audio Streaming Active</strong>
                          </>
                        ) : (
                          <>
                            <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                            <strong>⏳ Connecting Audio Stream...</strong>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Audio Controls */}
                {callState.isActive && callState.streamingEnabled && (
                  <div className="border-t pt-4 space-y-3">
                    <h3 className="text-sm font-medium text-slate-700">Audio Controls</h3>
                    
                    <div className="flex gap-2">
                      <button
                        onClick={() => setAudioMuted(!audioMuted)}
                        className={`flex-1 py-2 px-3 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center gap-2 ${
                          audioMuted 
                            ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        }`}
                      >
                        {audioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        {audioMuted ? 'Unmute' : 'Mute'}
                      </button>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Audio Volume: {Math.round(audioVolume * 100)}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={audioVolume}
                        onChange={(e) => setAudioVolume(parseFloat(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 px-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  Speech Settings
                </button>

                {showSettings && (
                  <div className="space-y-4 border-t pt-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Speed: {speechSettings.rate.toFixed(1)}x
                      </label>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={speechSettings.rate}
                        onChange={(e) => setSpeechSettings(prev => ({ ...prev, rate: parseFloat(e.target.value) }))}
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Voice
                      </label>
                      <select
                        value={speechSettings.voice}
                        onChange={(e) => setSpeechSettings(prev => ({ ...prev, voice: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="alice">Alice (Twilio - Female)</option>
                        <option value="man">Man (Twilio - Male)</option>
                        <option value="woman">Woman (Twilio - Female)</option>
                        {availableVoices.map(voice => (
                          <option key={voice.name} value={voice.name} title={voice.name}>
                            {voice.name.length > 40 ? voice.name.substring(0, 40) + '...' : voice.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Volume: {Math.round(speechSettings.volume * 100)}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={speechSettings.volume}
                        onChange={(e) => setSpeechSettings(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Main Communication Area */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-xl p-6 border border-slate-200">
              <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <MessageCircle className="w-5 h-5" />
                Type Your Response
              </h2>

              <div className="space-y-4">
                {callState.isActive && callState.streamingEnabled && callState.audioConnected && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-blue-800">
                      <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                      <span className="font-medium">🎵 You can hear them speaking live!</span>
                    </div>
                    <div className="text-sm text-blue-700 mt-1">
                      Live audio streaming is active. You hear their voice in real-time while you type your responses.
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Type your message (they hear you speak, you hear them live)
                  </label>
                  <textarea
                    ref={textAreaRef}
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    placeholder="Type your message here... Press Ctrl+Enter to speak it while hearing their live response."
                    className="w-full h-32 px-4 py-3 text-lg border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    disabled={!callState.isActive}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => speakMessage(currentMessage)}
                    disabled={!callState.isActive || !currentMessage.trim()}
                    className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3 px-4 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center gap-2"
                  >
                    <Volume2 className="w-5 h-5" />
                    Speak Message
                  </button>
                  <button
                    onClick={() => setCurrentMessage('')}
                    className="px-4 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors duration-200"
                  >
                    Clear
                  </button>
                </div>

                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-slate-700 mb-2">Quick Responses</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {quickResponses.map((response, index) => (
                      <button
                        key={index}
                        onClick={() => speakMessage(response)}
                        disabled={!callState.isActive}
                        className="text-left px-3 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 text-sm"
                      >
                        {response}
                      </button>
                    ))}
                  </div>
                </div>

                {messageHistory.length > 0 && (
                  <div className="border-t pt-4">
                    <h3 className="text-sm font-medium text-slate-700 mb-3">📤 Your Messages Sent</h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {messageHistory.map((message) => (
                        <div
                          key={message.id}
                          className="bg-green-50 rounded-lg p-3 text-sm border border-green-200"
                        >
                          <div className="text-green-800 font-medium">"{message.text}"</div>
                          <div className="text-xs text-green-600 mt-1">
                            ✅ Spoken at {message.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Usage Instructions */}
        <div className="mt-6 bg-white rounded-2xl shadow-xl p-6 border border-slate-200">
          <h3 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Keyboard className="w-5 h-5" />
            Live Voice-to-Voice Communication
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
            <div>
              <h4 className="font-medium text-slate-700 mb-2">🎵 How It Works</h4>
              <div className="space-y-2 text-slate-600">
                <p>• <strong>Live Audio:</strong> Hear their voice in real-time through your speakers</p>
                <p>• <strong>Type & Speak:</strong> Your typed messages are spoken to them clearly</p>
                <p>• <strong>Natural Flow:</strong> Like a regular phone call, but you type instead of speak</p>
                <p>• <strong>No Delays:</strong> Instant audio streaming, no waiting for transcriptions</p>
              </div>
            </div>
            
            <div>
              <h4 className="font-medium text-slate-700 mb-2">⌨️ Keyboard Shortcuts</h4>
              <div className="space-y-2 text-slate-600">
                <p>• <strong>Ctrl+Enter:</strong> Send current message</p>
                <p>• <strong>Ctrl+D:</strong> Start/end call</p>
                <p>• <strong>Ctrl+K:</strong> Focus text input</p>
                <p>• <strong>Ctrl+M:</strong> Mute/unmute audio</p>
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">
              <strong>🎯 Perfect Solution:</strong> This is true voice-to-voice communication! You hear them speaking 
              live through your speakers while you type responses that are spoken clearly to them. No more waiting 
              for transcriptions or dealing with delays - it's like using a regular phone, but you type instead of speak.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhoneInterface;
