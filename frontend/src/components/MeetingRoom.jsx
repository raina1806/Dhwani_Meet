import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import VideoPlayer from './VideoPlayer';
import Controls from './Controls';
import { SOCKET_URL, BACKEND_URL } from '../config';

const MeetingRoom = ({ roomId, userName, onLeave }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [speakIncoming, setSpeakIncoming] = useState(true);
  const [captions, setCaptions] = useState(new Map()); // Map of socketId -> current caption text
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [showChat, setShowChat] = useState(false); // Mobile chat toggle
  const [signLanguageEnabled, setSignLanguageEnabled] = useState(false); // Sign language recognition toggle
  const [signLanguageCaption, setSignLanguageCaption] = useState(''); // Current sign language prediction
  const [signLanguageSequence, setSignLanguageSequence] = useState(''); // Accumulated sign language sequence
  const [signLanguageText, setSignLanguageText] = useState(''); // Converted text from sequence
  const [signLanguageSentence, setSignLanguageSentence] = useState([]); // Array of committed words
  const [remoteSignLanguage, setRemoteSignLanguage] = useState(new Map()); // Map of socketId -> {sequence, text, sentence, userName}

  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const localVideoRef = useRef(null);
  const screenStreamRef = useRef(null);
  const localStreamRef = useRef(null);
  const participantsInfoRef = useRef(new Map()); // Store participant info (socketId -> userName)
  const userIdRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const recognitionRef = useRef(null);
  const captionTimeoutRef = useRef(new Map()); // Store timeout refs for clearing captions
  const signLanguageIntervalRef = useRef(null); // Interval for capturing frames
  const lastSignLanguagePredictionRef = useRef(''); // Last prediction that was added to sequence
  const lastAddedLetterRef = useRef(''); // Last letter that was actually added to sequence (to allow duplicates after instability)
  const signLanguageUpdateTimeoutRef = useRef(null); // Timeout for updating sequence
  const predictionHistoryRef = useRef([]); // Track recent predictions for stability check
  const stablePredictionRef = useRef(''); // Currently stable prediction
  const stablePredictionStartTimeRef = useRef(null); // When current stable prediction started
  const signLanguageSequenceRef = useRef(''); // Ref to track current sequence for immediate access

  useEffect(() => {
    let localStreamTemp = null;

    // Initialize socket connection
    console.log('Connecting to socket server:', SOCKET_URL);
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    const socket = socketRef.current;

    // Socket connection event handlers for debugging
    socket.on('connect', () => {
      console.log('Socket connected successfully:', socket.id);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      console.log('Attempting to connect to:', SOCKET_URL);
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log('Socket reconnected after', attemptNumber, 'attempts');
    });

    // Store pending participants until localStream is ready
    const pendingParticipants = [];

    // Process pending participants when stream is ready
    const processPendingParticipants = () => {
      if (localStreamTemp) {
        console.log('Processing pending participants:', pendingParticipants);
        pendingParticipants.forEach(({ socketId, userName: remoteUserName, isInitiator }) => {
          createPeerConnection(socketId, isInitiator !== false, remoteUserName);
        });
        pendingParticipants.length = 0;
      }
    };

    // Initialize media stream - with better mobile support
    const initializeMedia = async () => {
      try {
        console.log('Requesting media access...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user', // Prefer front camera on mobile
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true
          }
        });
        console.log('Media access granted, stream tracks:', stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));
        localStreamTemp = stream;
        localStreamRef.current = stream;
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          console.log('[Sign Language] Video srcObject set, stream tracks:', stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled })));
          // Ensure video plays on mobile
          localVideoRef.current.play().catch(err => {
            console.error('Error playing local video:', err);
          });
          // Trigger a check for sign language recognition after video is set
          // Use a small delay to ensure video element is ready
          setTimeout(() => {
            if (signLanguageEnabled && !signLanguageIntervalRef.current) {
              console.log('[Sign Language] Video srcObject set, triggering recognition check');
              // Force a re-check by dispatching a custom event or directly checking
              const hasLocalStream = localStream || localStreamRef.current;
              const hasLocalVideo = localVideoRef.current && localVideoRef.current.srcObject;
              if (signLanguageEnabled && hasLocalVideo && videoEnabled && hasLocalStream) {
                console.log('[Sign Language] Starting recognition after video setup');
                signLanguageIntervalRef.current = setInterval(() => {
                  captureFrameAndRecognize();
                }, 500);
              }
            }
          }, 500);
        }

        // Process any pending participants now that stream is ready
        processPendingParticipants();

        // After stream is ready, add tracks to any existing peer connections
        peersRef.current.forEach((peer, socketId) => {
          stream.getTracks().forEach((track) => {
            peer.addTrack(track, stream);
          });
        });
      } catch (error) {
        console.error('Error accessing media devices:', error);
        // Still allow user to join even if media fails (will show avatar)
        setLocalStream(null);
        localStreamRef.current = null;
        
        // Process pending participants even without stream
        processPendingParticipants();
        
        // Show user-friendly error message
        const errorMessage = error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError'
          ? 'Camera/microphone access denied. You can still join but others won\'t see/hear you.'
          : error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError'
          ? 'No camera/microphone found. You can still join but others won\'t see/hear you.'
          : 'Could not access camera/microphone. You can still join but others won\'t see/hear you.';
        
        alert(errorMessage);
        console.log('User can still participate without media');
      }
    };

    initializeMedia();

    // Join room
    const userId = `user_${Math.random().toString(36).substr(2, 9)}`;
    userIdRef.current = userId;
    socket.emit('join-room', { roomId, userId, userName });

    // Handle existing participants
    socket.on('existing-participants', (participants) => {
      console.log('Existing participants:', participants);
      participants.forEach((participant) => {
        participantsInfoRef.current.set(participant.socketId, participant.userName);
        if (localStreamTemp) {
          createPeerConnection(participant.socketId, true, participant.userName);
        } else {
          pendingParticipants.push({ 
            socketId: participant.socketId, 
            userName: participant.userName,
            isInitiator: true 
          });
        }
      });
    });

    // Handle new user joining
    socket.on('user-joined', ({ socketId, userName: remoteUserName }) => {
      console.log('User joined:', socketId, remoteUserName);
      participantsInfoRef.current.set(socketId, remoteUserName);
      if (localStreamTemp) {
        createPeerConnection(socketId, false, remoteUserName);
      } else {
        pendingParticipants.push({ 
          socketId, 
          userName: remoteUserName,
          isInitiator: false 
        });
      }
    });

    // Handle incoming chat messages
    socket.on('chat-message', (data) => {
      setMessages((prev) => [...prev, data]);
      const isSelf = data.socketId === socketRef.current?.id || data.userId === userIdRef.current;
      if (!isSelf && speakIncoming && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(`${data.userName || 'Guest'} says: ${data.message}`);
        utterance.rate = 1;
        utterance.pitch = 1;
        window.speechSynthesis.speak(utterance);
      }
    });

    // Handle incoming captions
    socket.on('caption', (data) => {
      if (!captionsEnabled) return;
      
      const socketId = data.socketId;
      const captionText = data.caption;
      
      // Update caption for this participant
      setCaptions((prev) => {
        const next = new Map(prev);
        next.set(socketId, captionText);
        return next;
      });

      // Clear caption after 3 seconds of inactivity
      if (captionTimeoutRef.current.has(socketId)) {
        clearTimeout(captionTimeoutRef.current.get(socketId));
      }
      
      const timeoutId = setTimeout(() => {
        setCaptions((prev) => {
          const next = new Map(prev);
          next.delete(socketId);
          return next;
        });
        captionTimeoutRef.current.delete(socketId);
      }, 3000);
      
      captionTimeoutRef.current.set(socketId, timeoutId);
    });

    // Handle incoming sign language data
    socket.on('sign-language', (data) => {
      const socketId = data.socketId;
      const sequence = data.sequence || '';
      const text = data.text || '';
      const sentence = data.sentence || [];
      const userName = data.userName || 'Anonymous';
      
      // Update remote sign language data
      setRemoteSignLanguage((prev) => {
        const next = new Map(prev);
        if (sequence || sentence.length > 0) {
          next.set(socketId, { sequence, text, sentence, userName });
        } else {
          // Clear if both sequence and sentence are empty
          next.delete(socketId);
        }
        return next;
      });
      
      console.log('[Sign Language] Received from', userName, ':', { sequence, text, sentence });
    });

    // Load chat history on join
    socket.on('chat-history', (history) => {
      if (Array.isArray(history)) {
        setMessages(history);
      }
    });

    // Handle WebRTC signaling
    socket.on('offer', async ({ offer, socketId }) => {
      console.log('Received offer from:', socketId);
      let peer = peersRef.current.get(socketId);
      
      // Create peer connection if it doesn't exist
      if (!peer) {
        // Get userName from stored participant info or use default
        const remoteUserName = participantsInfoRef.current.get(socketId) || 'Remote User';
        createPeerConnection(socketId, false, remoteUserName);
        peer = peersRef.current.get(socketId);
      }
      
      if (peer) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          console.log('Sending answer to:', socketId);
          socket.emit('answer', { roomId, answer, targetSocketId: socketId });
        } catch (error) {
          console.error('Error handling offer:', error);
        }
      }
    });

    socket.on('answer', async ({ answer, socketId }) => {
      console.log('Received answer from:', socketId);
      const peer = peersRef.current.get(socketId);
      if (peer) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(answer));
          console.log('Set remote description for:', socketId);
        } catch (error) {
          console.error('Error handling answer:', error);
        }
      }
    });

    socket.on('ice-candidate', async ({ candidate, socketId }) => {
      const peer = peersRef.current.get(socketId);
      if (peer && candidate) {
        try {
          const iceCandidate = new RTCIceCandidate(candidate);
          await peer.addIceCandidate(iceCandidate);
          console.log(`[ICE Candidate Received] from ${socketId}:`, {
            type: candidate.type || 'unknown',
            protocol: candidate.protocol,
            address: candidate.address
          });
        } catch (error) {
          console.error(`Error adding ICE candidate from ${socketId}:`, error);
        }
      }
    });

    // Handle user leaving
    socket.on('user-left', ({ socketId }) => {
      // Clean up remote sign language data for disconnected user
      setRemoteSignLanguage((prev) => {
        const next = new Map(prev);
        next.delete(socketId);
        return next;
      });
      const peer = peersRef.current.get(socketId);
      if (peer) {
        peer.close();
        peersRef.current.delete(socketId);
      }
      participantsInfoRef.current.delete(socketId);
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.delete(socketId);
        return next;
      });
    });

    // Initialize speech recognition after stream and socket are ready
    const initializeSpeechRecognition = () => {
      if (typeof window === 'undefined') {
        console.warn('Window is undefined');
        return null;
      }
      
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.warn('Speech recognition not supported in this browser. Please use Chrome or Edge.');
        return null;
      }

      // Don't start if already running
      if (recognitionRef.current) {
        console.log('Speech recognition already running');
        return recognitionRef.current;
      }

      console.log('Initializing speech recognition...');
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      let lastFinalTranscript = '';

      recognition.onstart = () => {
        console.log('Speech recognition started');
      };

      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        // Send final transcript as caption
        if (finalTranscript.trim()) {
          lastFinalTranscript = finalTranscript.trim();
          console.log('Final transcript:', lastFinalTranscript);
          if (socketRef.current && roomId && socketRef.current.connected) {
            socketRef.current.emit('caption', {
              roomId,
              caption: lastFinalTranscript,
              userName,
              userId: userIdRef.current
            });
          }
        }

        // Update local caption with interim or final (show both for better UX)
        const displayText = finalTranscript.trim() || interimTranscript || lastFinalTranscript;
        if (displayText && socketRef.current && socketRef.current.id) {
          const localSocketId = socketRef.current.id;
          console.log('Setting caption for', localSocketId, ':', displayText);
          setCaptions((prev) => {
            const next = new Map(prev);
            next.set(localSocketId, displayText);
            return next;
          });

          // Clear local caption after 3 seconds
          if (captionTimeoutRef.current.has(localSocketId)) {
            clearTimeout(captionTimeoutRef.current.get(localSocketId));
          }
          
          const timeoutId = setTimeout(() => {
            setCaptions((prev) => {
              const next = new Map(prev);
              next.delete(localSocketId);
              return next;
            });
            captionTimeoutRef.current.delete(localSocketId);
          }, 3000);
          
          captionTimeoutRef.current.set(localSocketId, timeoutId);
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          console.warn('Microphone permission denied for speech recognition');
          alert('Please allow microphone access for speech-to-text captions to work.');
          recognitionRef.current = null;
        } else if (event.error === 'no-speech') {
          // This is normal, don't log as error
          console.log('No speech detected');
        } else if (event.error === 'aborted') {
          // Aborted usually means recognition was stopped/restarted, which is expected
          console.log('Recognition aborted (this is normal when restarting)');
          recognitionRef.current = null;
        } else if (event.error === 'network') {
          console.error('Network error in speech recognition');
        } else if (event.error === 'audio-capture') {
          console.error('No microphone found or microphone not accessible');
        } else {
          console.error('Speech recognition error details:', event.error);
        }
      };

      recognition.onend = () => {
        console.log('Speech recognition ended');
        // Only restart if audio is enabled and we don't have a recognition instance
        // Add a delay to prevent rapid restart loops
        if (audioEnabled && socketRef.current && socketRef.current.connected && !recognitionRef.current) {
          setTimeout(() => {
            try {
              // Double-check we still need to restart
              if (audioEnabled && socketRef.current?.connected && !recognitionRef.current) {
                recognitionRef.current = recognition;
                recognition.start();
                console.log('Restarted recognition after end');
              }
            } catch (error) {
              // Ignore errors when recognition is already starting or aborted
              if (error.name !== 'InvalidStateError' && error.name !== 'AbortError') {
                console.error('Error restarting recognition:', error);
              }
            }
          }, 500); // Increased delay to prevent rapid restarts
        }
      };

      try {
        recognition.start();
        recognitionRef.current = recognition;
        console.log('Speech recognition started successfully');
        return recognition;
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        return null;
      }
    };

    // Start speech recognition after socket connects and stream is ready
    // Note: We'll let the separate useEffect handle recognition based on audio state
    // This prevents duplicate recognition instances

    // Cleanup on unmount
    return () => {
      // Stop speech recognition properly
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort(); // Use abort instead of stop to prevent onend callback
          recognitionRef.current = null;
        } catch (error) {
          // Ignore errors when stopping
          recognitionRef.current = null;
        }
      }
      
      // Clear all caption timeouts
      captionTimeoutRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      captionTimeoutRef.current.clear();

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      peersRef.current.forEach((peer) => peer.close());
      socket.off('chat-message');
      socket.off('chat-history');
      socket.off('caption');
      socket.disconnect();
    };
  }, [roomId, userName]);

  // Separate effect for managing speech recognition based on audio state
  // This is the primary place where recognition is managed
  useEffect(() => {
    // Cleanup function
    const cleanup = () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (error) {
          // Ignore abort errors
        }
        recognitionRef.current = null;
      }
    };

    if (!audioEnabled) {
      console.log('Stopping speech recognition (audio disabled)');
      cleanup();
      return cleanup;
    }

    // Only start if we don't have a recognition instance and all conditions are met
    if (audioEnabled && !recognitionRef.current && localStream && socketRef.current?.connected) {
      console.log('Audio enabled, starting speech recognition...');
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let lastFinalTranscript = '';

        recognition.onstart = () => {
          console.log('Speech recognition started (from audio toggle effect)');
        };

        recognition.onresult = (event) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }

          if (finalTranscript.trim()) {
            lastFinalTranscript = finalTranscript.trim();
            console.log('Final transcript (audio toggle):', lastFinalTranscript);
            if (socketRef.current && roomId && socketRef.current.connected) {
              socketRef.current.emit('caption', {
                roomId,
                caption: lastFinalTranscript,
                userName,
                userId: userIdRef.current
              });
            }
          }

          const displayText = finalTranscript.trim() || interimTranscript || lastFinalTranscript;
          if (displayText && socketRef.current?.id) {
            const localSocketId = socketRef.current.id;
            console.log('Setting caption (audio toggle):', displayText);
            setCaptions((prev) => {
              const next = new Map(prev);
              next.set(localSocketId, displayText);
              return next;
            });

            if (captionTimeoutRef.current.has(localSocketId)) {
              clearTimeout(captionTimeoutRef.current.get(localSocketId));
            }
            
            const timeoutId = setTimeout(() => {
              setCaptions((prev) => {
                const next = new Map(prev);
                next.delete(localSocketId);
                return next;
              });
              captionTimeoutRef.current.delete(localSocketId);
            }, 3000);
            
            captionTimeoutRef.current.set(localSocketId, timeoutId);
          }
        };

        recognition.onerror = (event) => {
          if (event.error === 'aborted') {
            console.log('Recognition aborted (audio toggle) - this is normal');
            recognitionRef.current = null;
          } else if (event.error === 'not-allowed') {
            console.warn('Microphone permission denied');
            recognitionRef.current = null;
          } else if (event.error === 'no-speech') {
            console.log('No speech detected (audio toggle)');
          } else {
            console.error('Speech recognition error (audio toggle):', event.error);
          }
        };

        recognition.onend = () => {
          console.log('Speech recognition ended (audio toggle)');
          // Only restart if audio is enabled and we don't have a recognition instance
          if (audioEnabled && socketRef.current?.connected && !recognitionRef.current) {
            setTimeout(() => {
              try {
                // Double-check we still need to restart
                if (audioEnabled && socketRef.current?.connected && !recognitionRef.current) {
                  recognitionRef.current = recognition;
                  recognition.start();
                  console.log('Restarted recognition after end (audio toggle)');
                }
              } catch (error) {
                // Ignore errors when recognition is already starting or aborted
                if (error.name !== 'InvalidStateError' && error.name !== 'AbortError') {
                  console.error('Error restarting recognition:', error);
                }
                recognitionRef.current = null;
              }
            }, 500); // Increased delay to prevent rapid restarts
          }
        };

        try {
          recognition.start();
          recognitionRef.current = recognition;
          console.log('Speech recognition started successfully (audio toggle)');
        } catch (error) {
          console.error('Error starting speech recognition:', error);
          recognitionRef.current = null;
        }
      } else {
        console.warn('Speech recognition not available');
      }
    }

    // Return cleanup function
    return cleanup;
  }, [audioEnabled, localStream, roomId, userName]);

  // Auto-scroll chat to the latest message
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Convert sign language sequence to text using dictionary and optional API
  const convertSequenceToText = (sequence) => {
    if (!sequence) return '';
    
    // Remove spaces and convert to uppercase word
    const word = sequence.replace(/\s+/g, '').toUpperCase();
    
    // Extended dictionary (common ISL words and phrases)
    const commonWords = {
      'HELLO': 'Hello',
      'HI': 'Hi',
      'THANKYOU': 'Thank You',
      'THANKS': 'Thanks',
      'YES': 'Yes',
      'NO': 'No',
      'PLEASE': 'Please',
      'SORRY': 'Sorry',
      'GOOD': 'Good',
      'MORNING': 'Morning',
      'AFTERNOON': 'Afternoon',
      'EVENING': 'Evening',
      'NIGHT': 'Night',
      'GOODBYE': 'Goodbye',
      'BYE': 'Bye',
      'NAME': 'Name',
      'MY': 'My',
      'YOUR': 'Your',
      'HOW': 'How',
      'ARE': 'Are',
      'YOU': 'You',
      'I': 'I',
      'AM': 'Am',
      'FINE': 'Fine',
      'OK': 'OK',
      'OKAY': 'Okay',
      'WELCOME': 'Welcome',
      'NICE': 'Nice',
      'MEET': 'Meet',
      'TO': 'To',
      'SEE': 'See',
      'AGAIN': 'Again',
      'LATER': 'Later',
      'TODAY': 'Today',
      'TOMORROW': 'Tomorrow',
      'YESTERDAY': 'Yesterday',
      'HELP': 'Help',
      'NEED': 'Need',
      'WANT': 'Want',
      'WATER': 'Water',
      'FOOD': 'Food',
      'HOME': 'Home',
      'WORK': 'Work',
      'SCHOOL': 'School',
      'FRIEND': 'Friend',
      'FAMILY': 'Family',
      'LOVE': 'Love',
      'LIKE': 'Like',
      'HAPPY': 'Happy',
      'SAD': 'Sad',
      'ANGRY': 'Angry',
      'SICK': 'Sick',
      'HOSPITAL': 'Hospital',
      'DOCTOR': 'Doctor',
      'TIME': 'Time',
      'WHAT': 'What',
      'WHERE': 'Where',
      'WHEN': 'When',
      'WHY': 'Why',
      'WHO': 'Who',
    };
    
    // Check if word exists in dictionary first (fastest)
    if (commonWords[word]) {
      return commonWords[word];
    }
    
    // If word is short (1-3 letters), return as is
    if (word.length <= 3) {
      return word;
    }
    
    // Try to find partial matches
    for (const [key, value] of Object.entries(commonWords)) {
      if (word.includes(key) || key.includes(word)) {
        return value;
      }
    }
    
    // Optional: Use external API for translation (if needed)
    // Uncomment and configure if you want to use an external translation API
    /*
    try {
      const response = await fetch(`${BACKEND_URL}/api/translate-sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence: word, language: 'en' })
      });
      const data = await response.json();
      if (data.text) return data.text;
    } catch (error) {
      console.log('[Sign Language] API translation failed, using fallback');
    }
    */
    
    // Return the word as uppercase if no match found
    return word;
  };

  // Keep ref in sync with state (for cases where state is updated outside the main flow)
  useEffect(() => {
    signLanguageSequenceRef.current = signLanguageSequence;
  }, [signLanguageSequence]);

  // Convert sequence to text when sequence changes
  useEffect(() => {
    if (signLanguageSequence) {
      // Convert synchronously for now (can be made async if using API)
      const convertedText = convertSequenceToText(signLanguageSequence);
      setSignLanguageText(convertedText);
      console.log('[Sign Language] Sequence:', signLanguageSequence, '→ Text:', convertedText);
    } else {
      setSignLanguageText('');
    }
  }, [signLanguageSequence]);

  // Broadcast sign language sequence, text, and sentence to all participants
  useEffect(() => {
    if (signLanguageEnabled && socketRef.current && roomId && socketRef.current.connected) {
      // Always send the current sequence, text, and sentence (even if empty, to clear remote displays)
      socketRef.current.emit('sign-language', {
        roomId,
        sequence: signLanguageSequence || '',
        text: signLanguageText || '',
        sentence: signLanguageSentence || [],
        userName,
        userId: userIdRef.current
      });
      if (signLanguageSequence || signLanguageSentence.length > 0) {
        console.log('[Sign Language] Broadcasting to participants:', { 
          sequence: signLanguageSequence, 
          text: signLanguageText,
          sentence: signLanguageSentence 
        });
      }
    }
  }, [signLanguageSequence, signLanguageText, signLanguageSentence, signLanguageEnabled, roomId, userName]);

  // Debug: Monitor sign language enabled state changes
  useEffect(() => {
    console.log('[Sign Language] signLanguageEnabled state changed to:', signLanguageEnabled);
    console.log('[Sign Language] Current conditions:', {
      signLanguageEnabled,
      videoEnabled,
      localStream: !!localStream,
      localStreamRef: !!localStreamRef.current,
      videoElement: !!localVideoRef.current,
      videoSrcObject: !!(localVideoRef.current && localVideoRef.current.srcObject),
      videoReadyState: localVideoRef.current ? localVideoRef.current.readyState : 'no element'
    });
  }, [signLanguageEnabled]);

  // Debug: Monitor sign language sequence changes
  useEffect(() => {
    if (signLanguageEnabled && signLanguageSequence) {
      console.log('[Sign Language] Sequence state updated:', signLanguageSequence);
    }
  }, [signLanguageSequence, signLanguageEnabled]);

  // Handle keyboard shortcuts for sign language
  useEffect(() => {
    if (!signLanguageEnabled) return;

    const handleKeyDown = (event) => {
      // Only handle keys when not typing in an input field
      if (
        event.target.tagName === 'INPUT' ||
        event.target.tagName === 'TEXTAREA' ||
        event.target.isContentEditable
      ) {
        return;
      }

      // Spacebar: Commit current word to sentence
      if (event.code === 'Space') {
        event.preventDefault();
        
        // Use ref to get the most up-to-date sequence (React state might be stale)
        const currentSequence = signLanguageSequenceRef.current || signLanguageSequence;
        
        // Commit current sequence (letters before the arrow) if we have a sequence
        if (currentSequence && currentSequence.trim()) {
          // Remove all spaces from the sequence before committing
          const wordToCommit = currentSequence.replace(/\s+/g, '');
          console.log('[Sign Language] Spacebar pressed! Committing sequence:', wordToCommit, 'from state:', signLanguageSequence, 'from ref:', signLanguageSequenceRef.current);
          
          // Add sequence to sentence (without spaces) and immediately broadcast
          setSignLanguageSentence((prev) => {
            const newSentence = [...prev, wordToCommit];
            
            // Immediately broadcast the updated sentence to all participants
            if (socketRef.current && roomId && socketRef.current.connected) {
              console.log('[Sign Language] Broadcasting updated sentence immediately:', newSentence);
              socketRef.current.emit('sign-language', {
                roomId,
                sequence: '', // Clear sequence after commit
                text: '',
                sentence: newSentence,
                userName,
                userId: userIdRef.current
              });
            }
            
            return newSentence;
          });
          
          // Clear the sequence and text for next word
          setSignLanguageSequence('');
          signLanguageSequenceRef.current = '';
          setSignLanguageText('');
          lastSignLanguagePredictionRef.current = '';
          lastAddedLetterRef.current = '';
          predictionHistoryRef.current = [];
          stablePredictionRef.current = '';
          stablePredictionStartTimeRef.current = null;
          setSignLanguageCaption('');
        }
      }
      
      // Escape: Clear entire sentence
      if (event.code === 'Escape') {
        event.preventDefault();
        console.log('[Sign Language] Escape pressed! Clearing sentence');
        setSignLanguageSentence([]);
        
        // Immediately broadcast the cleared sentence to all participants
        if (socketRef.current && roomId && socketRef.current.connected) {
          console.log('[Sign Language] Broadcasting cleared sentence immediately');
          socketRef.current.emit('sign-language', {
            roomId,
            sequence: signLanguageSequence || '',
            text: signLanguageText || '',
            sentence: [],
            userName,
            userId: userIdRef.current
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [signLanguageEnabled, signLanguageText]);

  const createPeerConnection = (socketId, isInitiator, remoteUserName = 'Remote User') => {
    // Check if peer connection already exists
    if (peersRef.current.has(socketId)) {
      console.log('Peer connection already exists for:', socketId);
      return;
    }

    console.log('Creating peer connection:', socketId, 'isInitiator:', isInitiator);
    
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    });
    
    console.log('WebRTC Configuration:', {
      iceServers: peer.getConfiguration().iceServers,
      iceCandidatePoolSize: peer.getConfiguration().iceCandidatePoolSize
    });

    // Add local stream tracks to peer connection
    const currentStream = localStreamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => {
        peer.addTrack(track, currentStream);
        console.log('Added track to peer:', track.kind, socketId);
      });
    }

    // Handle remote stream - improved for mobile devices
    peer.ontrack = (event) => {
      console.log('Received remote track from:', socketId, event);
      console.log('Track event details:', {
        streams: event.streams,
        track: event.track,
        transceiver: event.transceiver
      });
      
      // Handle multiple streams or create a new stream from tracks
      let remoteStream = null;
      if (event.streams && event.streams.length > 0) {
        remoteStream = event.streams[0];
      } else if (event.track) {
        // Create a new MediaStream if no stream is provided
        remoteStream = new MediaStream([event.track]);
        console.log('Created new MediaStream from track:', event.track.kind);
      }
      
      if (remoteStream) {
        console.log('Setting remote stream for:', socketId, 'Stream tracks:', remoteStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, id: t.id })));
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          // Check if we already have a stream for this socketId
          const existing = next.get(socketId);
          if (existing && existing.stream) {
            // Add new tracks to existing stream
            event.track && existing.stream.addTrack(event.track);
          } else {
            // Create new entry
            next.set(socketId, { stream: remoteStream, userName: remoteUserName });
          }
          return next;
        });
      } else {
        console.error('No remote stream or track found in event:', event);
      }
    };
    
    // Fallback: Check receivers periodically (for mobile devices where ontrack might not fire)
    let checkReceiversInterval = null;
    const startReceiverCheck = () => {
      checkReceiversInterval = setInterval(() => {
        if (peer.connectionState === 'connected' && peer.getReceivers().length > 0) {
          const receivers = peer.getReceivers();
          const tracks = receivers.map(r => r.track).filter(t => t && t.readyState === 'live');
          
          if (tracks.length > 0) {
            console.log('Found tracks via receivers for:', socketId, tracks.length);
            const remoteStream = new MediaStream(tracks);
            
            setRemoteStreams((prev) => {
              const next = new Map(prev);
              if (!next.has(socketId) || !next.get(socketId)?.stream) {
                next.set(socketId, { stream: remoteStream, userName: remoteUserName });
                console.log('Set remote stream via receivers for:', socketId);
              }
              return next;
            });
            
            // Clear interval once we have the stream
            if (checkReceiversInterval) {
              clearInterval(checkReceiversInterval);
              checkReceiversInterval = null;
            }
          }
        }
        
        // Clear interval if connection is closed or failed
        if (peer.connectionState === 'closed' || peer.connectionState === 'failed') {
          if (checkReceiversInterval) {
            clearInterval(checkReceiversInterval);
            checkReceiversInterval = null;
          }
        }
      }, 1000);
      
      // Clean up interval after 10 seconds
      setTimeout(() => {
        if (checkReceiversInterval) {
          clearInterval(checkReceiversInterval);
          checkReceiversInterval = null;
        }
      }, 10000);
    };
    
    // Start checking after a short delay
    setTimeout(startReceiverCheck, 2000);

    // Handle ICE candidates with detailed logging
    const iceCandidates = {
      host: [],
      srflx: [],
      relay: []
    };
    
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        const candidate = event.candidate;
        const candidateType = candidate.type || 'unknown';
        const candidateInfo = {
          type: candidateType,
          protocol: candidate.protocol,
          address: candidate.address,
          port: candidate.port,
          priority: candidate.priority,
          candidate: candidate.candidate
        };
        
        // Categorize candidates
        if (candidateType === 'host') {
          iceCandidates.host.push(candidateInfo);
        } else if (candidateType === 'srflx') {
          iceCandidates.srflx.push(candidateInfo);
        } else if (candidateType === 'relay') {
          iceCandidates.relay.push(candidateInfo);
        }
        
        console.log(`[ICE Candidate ${candidateType.toUpperCase()}] for ${socketId}:`, candidateInfo);
        console.log(`Total candidates - Host: ${iceCandidates.host.length}, SRFLX: ${iceCandidates.srflx.length}, Relay: ${iceCandidates.relay.length}`);
        
        // Warn if no srflx or relay candidates (NAT traversal issues)
        if (iceCandidates.host.length > 0 && iceCandidates.srflx.length === 0 && iceCandidates.relay.length === 0) {
          console.warn('⚠️ No srflx or relay candidates found - NAT traversal may fail. Check STUN server connectivity.');
        }
        
        socketRef.current.emit('ice-candidate', {
          roomId,
          candidate: candidate,
          targetSocketId: socketId
        });
      } else {
        // No more candidates
        console.log(`[ICE Gathering Complete] for ${socketId}`);
        console.log('Final candidate summary:', {
          host: iceCandidates.host.length,
          srflx: iceCandidates.srflx.length,
          relay: iceCandidates.relay.length,
          hasNATTraversal: iceCandidates.srflx.length > 0 || iceCandidates.relay.length > 0
        });
      }
    };
    
    // Monitor ICE connection state
    peer.oniceconnectionstatechange = () => {
      const state = peer.iceConnectionState;
      console.log(`[ICE Connection State] for ${socketId}: ${state}`);
      
      if (state === 'failed') {
        console.error(`❌ ICE connection failed for ${socketId}. Candidates:`, {
          host: iceCandidates.host.length,
          srflx: iceCandidates.srflx.length,
          relay: iceCandidates.relay.length
        });
      } else if (state === 'connected' || state === 'completed') {
        console.log(`✅ ICE connection ${state} for ${socketId}`);
      }
    };
    
    // Monitor ICE gathering state
    peer.onicegatheringstatechange = () => {
      console.log(`[ICE Gathering State] for ${socketId}: ${peer.iceGatheringState}`);
    };

    // Handle connection state changes
    peer.onconnectionstatechange = () => {
      console.log('Peer connection state changed:', socketId, peer.connectionState);
      if (peer.connectionState === 'connected') {
        console.log('Peer connection established with:', socketId);
        // Once connected, check for receivers in case ontrack didn't fire
        setTimeout(() => {
          const receivers = peer.getReceivers();
          if (receivers.length > 0) {
            const tracks = receivers.map(r => r.track).filter(t => t && t.readyState === 'live');
            if (tracks.length > 0) {
              console.log('Found tracks after connection for:', socketId);
              const remoteStream = new MediaStream(tracks);
              setRemoteStreams((prev) => {
                const next = new Map(prev);
                if (!next.has(socketId) || !next.get(socketId)?.stream) {
                  next.set(socketId, { stream: remoteStream, userName: remoteUserName });
                  console.log('Set remote stream after connection for:', socketId);
                }
                return next;
              });
            }
          }
        }, 500);
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        console.log('Peer connection failed/disconnected:', socketId);
        // Remove remote stream on disconnection
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(socketId);
          return next;
        });
      }
    };

    peersRef.current.set(socketId, peer);

    // Create and send offer if initiator
    if (isInitiator && currentStream) {
      peer.createOffer()
        .then((offer) => {
          console.log('Created offer for:', socketId);
          return peer.setLocalDescription(offer);
        })
        .then(() => {
          socketRef.current.emit('offer', {
            roomId,
            offer: peer.localDescription,
            targetSocketId: socketId
          });
          console.log('Sent offer to:', socketId);
        })
        .catch((error) => console.error('Error creating offer:', error));
    }
  };

  const handleToggleAudio = () => {
    const nextAudioEnabled = !audioEnabled;
    console.log(`[Audio Toggle] Changing audio state from ${audioEnabled} to ${nextAudioEnabled}`);

    // Always update local UI state so the button reflects the intent,
    // even if this device has no active audio track (e.g., permission denied).
    setAudioEnabled(nextAudioEnabled);

    // Collect all possible audio streams (local stream, screen share stream)
    const streamsToUpdate = [];
    if (localStream || localStreamRef.current) {
      streamsToUpdate.push(localStream || localStreamRef.current);
    }
    if (screenSharing && screenStreamRef.current) {
      streamsToUpdate.push(screenStreamRef.current);
    }

    // Update all audio tracks in all streams
    let totalTracksUpdated = 0;
    streamsToUpdate.forEach((stream, streamIndex) => {
      if (stream) {
        const audioTracks = stream.getAudioTracks();
        console.log(`[Audio] Stream ${streamIndex} has ${audioTracks.length} audio track(s)`);
        audioTracks.forEach((track, trackIndex) => {
          const wasEnabled = track.enabled;
          track.enabled = nextAudioEnabled;
          totalTracksUpdated++;
          console.log(`[Audio] Stream ${streamIndex}, Track ${trackIndex} (${track.id}): ${wasEnabled} -> ${track.enabled}, readyState: ${track.readyState}`);
        });
      }
    });
    
    // Update tracks in all peer connections (this is critical for remote peers)
    let totalSendersUpdated = 0;
    peersRef.current.forEach((peer, socketId) => {
      const senders = peer.getSenders();
      console.log(`[Audio] Peer ${socketId} has ${senders.length} sender(s)`);
      senders.forEach((sender, senderIndex) => {
        if (sender.track && sender.track.kind === 'audio') {
          const wasEnabled = sender.track.enabled;
          sender.track.enabled = nextAudioEnabled;
          totalSendersUpdated++;
          console.log(`[Audio] Peer ${socketId}, Sender ${senderIndex} (${sender.track.id}): ${wasEnabled} -> ${sender.track.enabled}, readyState: ${sender.track.readyState}, muted: ${sender.track.muted}`);
        } else if (sender.track) {
          console.log(`[Audio] Peer ${socketId}, Sender ${senderIndex} is ${sender.track.kind}, skipping`);
        } else {
          console.log(`[Audio] Peer ${socketId}, Sender ${senderIndex} has no track`);
        }
      });
    });

    console.log(`[Audio Toggle] Updated ${totalTracksUpdated} stream track(s) and ${totalSendersUpdated} sender track(s)`);

    // Notify other participants about audio state change
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('toggle-audio', {
        roomId,
        audioEnabled: nextAudioEnabled
      });
      console.log(`[Audio] Emitted toggle-audio event: ${nextAudioEnabled}`);
    } else {
      console.warn('[Audio] Socket not connected, cannot emit toggle-audio event');
    }
  };

  const handleToggleVideo = () => {
    const nextVideoEnabled = !videoEnabled;

    // Always update local UI state so the button reflects the intent,
    // even if this device has no active video track.
    setVideoEnabled(nextVideoEnabled);

    // Determine which stream to update (screen share takes priority if active)
    const streamToUpdate = screenSharing && screenStreamRef.current 
      ? screenStreamRef.current 
      : (localStream || localStreamRef.current);
    
    if (streamToUpdate) {
      const videoTracks = streamToUpdate.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = nextVideoEnabled;
        console.log(`[Video] Track ${track.id} enabled: ${track.enabled}, readyState: ${track.readyState}`);
      });
    }
    
    // Update tracks in all peer connections (this is critical for remote peers)
    peersRef.current.forEach((peer, socketId) => {
      const senders = peer.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'video') {
          sender.track.enabled = nextVideoEnabled;
          console.log(`[Video] Updated sender track in peer ${socketId}, enabled: ${nextVideoEnabled}, readyState: ${sender.track.readyState}`);
        }
      });
    });
    
    // Update local video element visibility/display
    if (localVideoRef.current) {
      if (nextVideoEnabled) {
        localVideoRef.current.style.opacity = '1';
        localVideoRef.current.style.pointerEvents = 'auto';
      } else {
        // When video is disabled, show black screen or placeholder
        localVideoRef.current.style.opacity = '0.3';
      }
    }

    // Notify other participants about video state change
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('toggle-video', {
        roomId,
        videoEnabled: nextVideoEnabled
      });
    }
  };

  const handleScreenShare = async () => {
    try {
      if (!screenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        screenStreamRef.current = screenStream;

        // Replace video track in all peer connections
        const videoTrack = screenStream.getVideoTracks()[0];
        peersRef.current.forEach((peer) => {
          const sender = peer.getSenders().find(
            (s) => s.track && s.track.kind === 'video'
          );
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });

        // Update local video
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        setScreenSharing(true);

        // Handle screen share end
        videoTrack.onended = () => {
          handleStopScreenShare();
        };
      } else {
        handleStopScreenShare();
      }
    } catch (error) {
      console.error('Error sharing screen:', error);
    }
  };

  const handleStopScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }

    // Restore camera video track
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      peersRef.current.forEach((peer) => {
        const sender = peer.getSenders().find(
          (s) => s.track && s.track.kind === 'video'
        );
        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack);
        }
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
    }

    setScreenSharing(false);
  };

  // Capture frame from video and send for sign language recognition
  const captureFrameAndRecognize = async () => {
    // Check both state and ref for video stream
    // Also check video element's srcObject directly - it might have the stream even if refs don't
    const videoElement = localVideoRef.current;
    const videoSrcObject = videoElement && videoElement.srcObject;
    const hasLocalStream = localStream || localStreamRef.current || (videoSrcObject instanceof MediaStream);
    
    if (!videoElement || !signLanguageEnabled || !videoEnabled || !hasLocalStream) {
      return;
    }

    const video = videoElement;
    
    // Ensure video element has a valid stream
    if (!video.srcObject) {
      console.warn('[Sign Language] Video element has no srcObject');
      return;
    }
    
    // Ensure video is ready
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      return;
    }

    try {
      // Get actual video dimensions - ensure we have valid dimensions
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      
      if (!videoWidth || !videoHeight || videoWidth === 0 || videoHeight === 0) {
        console.warn('[Sign Language] Invalid video dimensions:', videoWidth, videoHeight);
        return;
      }
      
      // Create canvas to capture frame with exact video dimensions
      const canvas = document.createElement('canvas');
      canvas.width = videoWidth;
      canvas.height = videoHeight;
      const ctx = canvas.getContext('2d');
      
      // Draw video frame directly (no flipping - getUserMedia stream is not mirrored)
      // The video element might appear mirrored in CSS, but the actual stream data is correct
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

      // Convert canvas to base64 with high-quality JPEG (0.95 quality)
      // JPEG with high quality is smaller than PNG but still maintains good quality for MediaPipe
      // This reduces payload size and prevents "request entity too large" errors
      const imageData = canvas.toDataURL('image/jpeg', 0.95);
      
      // Debug: Log frame capture info (only occasionally to avoid spam)
      if (Math.random() < 0.01) { // Log 1% of frames
        console.log('[Sign Language] Frame captured:', {
          width: videoWidth,
          height: videoHeight,
          format: 'PNG',
          dataLength: imageData.length
        });
      }

      // Send to backend for recognition
      let response;
      try {
        response = await fetch(`${BACKEND_URL}/api/predict-sign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ image: imageData }),
        });
      } catch (fetchError) {
        console.error('[Sign Language] Network error calling prediction API:', fetchError);
        // Don't show error for every frame, just log it
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Sign Language] API error (${response.status}):`, errorText);
        // Only log, don't show error UI for every failed frame
        return;
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('[Sign Language] Failed to parse response:', jsonError);
        return;
      }

      if (data.success && data.prediction) {
        const prediction = data.prediction.toUpperCase();
        const confidence = data.confidence || 0;

        // Only process if confidence is high enough
        if (confidence > 0.5) {
          // Add prediction to history (capturing every 500ms, need 2 for 1 second)
          const FRAME_INTERVAL_MS = 500;
          const STABILITY_DURATION_MS = 1000; // 1 second
          const HISTORY_SIZE = Math.ceil(STABILITY_DURATION_MS / FRAME_INTERVAL_MS); // ~2 predictions
          
          predictionHistoryRef.current.push({
            letter: prediction,
            timestamp: Date.now()
          });
          
          // Keep only recent predictions (last N)
          if (predictionHistoryRef.current.length > HISTORY_SIZE) {
            predictionHistoryRef.current.shift();
          }
          
          // Check if prediction is stable (appears in majority of recent predictions)
          const recentPredictions = predictionHistoryRef.current.map(p => p.letter);
          const predictionCounts = {};
          recentPredictions.forEach(letter => {
            predictionCounts[letter] = (predictionCounts[letter] || 0) + 1;
          });
          
          // Find the most common prediction in recent history
          const mostCommon = Object.entries(predictionCounts)
            .sort((a, b) => b[1] - a[1])[0];
          
          const stableLetter = mostCommon ? mostCommon[0] : '';
          const stableCount = mostCommon ? mostCommon[1] : 0;
          const stabilityThreshold = Math.ceil(recentPredictions.length * 0.7); // 70% of recent predictions
          
          // Check if we have a stable prediction
          if (stableLetter && stableCount >= stabilityThreshold) {
            const now = Date.now();
            
            // If this is a new stable prediction (different from current stable), reset the timer
            // This allows the same letter to be added again if it was unstable and then stable again
            const isNewStablePrediction = stableLetter !== stablePredictionRef.current;
            if (isNewStablePrediction) {
              stablePredictionRef.current = stableLetter;
              stablePredictionStartTimeRef.current = now;
              console.log('[Sign Language] New stable prediction detected:', stableLetter, 'Previous:', stablePredictionRef.current);
            }
            
            // Check if stable prediction has been stable for required duration
            const stableDuration = now - stablePredictionStartTimeRef.current;
            if (stableDuration >= STABILITY_DURATION_MS) {
              // Prediction is stable for required duration
              // Allow adding the letter if:
              // 1. It's different from the last added letter, OR
              // 2. It's a new stable prediction (user moved away and came back to same letter)
              // This allows duplicate letters (like "EE" in "SEE") when user re-signs the same letter
              const shouldAdd = stableLetter !== lastAddedLetterRef.current || isNewStablePrediction;
              
              if (shouldAdd) {
                console.log('[Sign Language] Adding letter:', stableLetter, 'isNewStablePrediction:', isNewStablePrediction, 'lastAddedLetter:', lastAddedLetterRef.current);
                lastSignLanguagePredictionRef.current = stableLetter;
                lastAddedLetterRef.current = stableLetter;
                
                // Update sequence with stable prediction
                setSignLanguageSequence((prev) => {
                  // If empty, just add the prediction
                  if (!prev) {
                    const newSequence = stableLetter;
                    signLanguageSequenceRef.current = newSequence;
                    console.log('[Sign Language] Starting new sequence:', newSequence);
                    return newSequence;
                  }
                  
                  // Add a space and new letter (allow duplicates - same letter can be added if user re-signs it)
                  const newSequence = prev + ' ' + stableLetter;
                  signLanguageSequenceRef.current = newSequence;
                  console.log('[Sign Language] Updated sequence with stable letter:', newSequence);
                  return newSequence;
                });
                
                // Reset stability timer for next letter
                stablePredictionStartTimeRef.current = now;
              }
              
              // Update current caption with stable prediction
              setSignLanguageCaption(stableLetter);
              
              // Note: Sign language sequence and text are broadcast via useEffect hook
              // that watches signLanguageSequence and signLanguageText changes
            } else {
              // Prediction is stable but not yet for required duration
              // Show it as "pending" (optional - you can remove this if you don't want to show pending)
              setSignLanguageCaption(`${stableLetter} (${Math.round(stableDuration / 1000)}s)`);
            }
          } else {
            // No stable prediction yet, clear caption and reset stable prediction
            // This allows the same letter to be added again if user re-signs it
            setSignLanguageCaption('');
            stablePredictionRef.current = '';
            stablePredictionStartTimeRef.current = null;
            // Reset both refs when prediction becomes unstable
            // This allows duplicate letters when user moves away and comes back to the same letter
            lastSignLanguagePredictionRef.current = '';
            lastAddedLetterRef.current = ''; // Reset this too so same letter can be added again
          }
          
          // Reset timeout for clearing sequence
          if (signLanguageUpdateTimeoutRef.current) {
            clearTimeout(signLanguageUpdateTimeoutRef.current);
          }
          signLanguageUpdateTimeoutRef.current = setTimeout(() => {
            console.log('[Sign Language] Clearing sequence after timeout');
            setSignLanguageSequence('');
            signLanguageSequenceRef.current = '';
            setSignLanguageCaption('');
            setSignLanguageText('');
            // Note: Don't clear sentence on timeout - keep committed words
            lastSignLanguagePredictionRef.current = '';
            lastAddedLetterRef.current = '';
            predictionHistoryRef.current = [];
            stablePredictionRef.current = '';
            stablePredictionStartTimeRef.current = null;
            // Broadcast empty sequence to clear for remote participants (but keep sentence)
            if (socketRef.current && roomId && socketRef.current.connected) {
              socketRef.current.emit('sign-language', {
                roomId,
                sequence: '',
                text: '',
                sentence: signLanguageSentence || [],
                userName,
                userId: userIdRef.current
              });
            }
          }, 10000); // Clear after 10 seconds of inactivity
        } else {
          console.log('[Sign Language] Low confidence:', confidence, 'for prediction:', prediction);
        }
      } else if (data.error) {
        console.log('[Sign Language] Error from service:', data.error);
      }
    } catch (error) {
      console.error('Error in sign language recognition:', error);
    }
  };

  // Effect to handle sign language recognition
  useEffect(() => {
    console.log('[Sign Language] useEffect triggered - signLanguageEnabled:', signLanguageEnabled, 'videoEnabled:', videoEnabled, 'localStream:', !!localStream);
    
    const checkAndStartRecognition = () => {
      // Check both state and ref for localStream (ref might be set even if state isn't updated yet)
      // Also check video element's srcObject directly - it might have the stream even if refs don't
      const videoElement = localVideoRef.current;
      const videoSrcObject = videoElement && videoElement.srcObject;
      const hasLocalStream = localStream || localStreamRef.current || (videoSrcObject instanceof MediaStream);
      const hasLocalVideo = videoElement && videoSrcObject;
      
      const conditions = {
        signLanguageEnabled,
        hasLocalVideo: !!hasLocalVideo,
        videoEnabled,
        hasLocalStream: !!hasLocalStream,
        localStreamState: !!localStream,
        localStreamRef: !!localStreamRef.current,
        videoElement: !!videoElement,
        videoSrcObject: !!videoSrcObject,
        videoSrcObjectIsStream: videoSrcObject instanceof MediaStream,
        videoReadyState: videoElement ? videoElement.readyState : 'no element',
        videoPaused: videoElement ? videoElement.paused : 'no element',
        videoEnded: videoElement ? videoElement.ended : 'no element',
        intervalRunning: !!signLanguageIntervalRef.current
      };
      
      console.log('[Sign Language] Checking recognition conditions:', conditions);
      
      if (signLanguageEnabled && hasLocalVideo && videoEnabled && hasLocalStream) {
        // Only start if not already running
        if (!signLanguageIntervalRef.current) {
          console.log('[Sign Language] ✅ Starting recognition interval - all conditions met!');
          // Start capturing frames every 500ms
          signLanguageIntervalRef.current = setInterval(() => {
            captureFrameAndRecognize();
          }, 500);
          console.log('[Sign Language] Recognition interval started, will capture frames every 500ms');
        } else {
          console.log('[Sign Language] Recognition interval already running, skipping start');
        }
      } else {
        // Clear interval if disabled or conditions not met
        if (signLanguageIntervalRef.current) {
          console.log('[Sign Language] ❌ Stopping recognition interval - conditions not met:', conditions);
          clearInterval(signLanguageIntervalRef.current);
          signLanguageIntervalRef.current = null;
        } else {
          console.log('[Sign Language] ⚠️ Recognition not starting - conditions not met:', conditions);
        }
        // Reset state (but keep sentence - don't lose committed words)
        if (!signLanguageEnabled) {
          setSignLanguageCaption('');
          setSignLanguageSequence('');
          signLanguageSequenceRef.current = '';
          setSignLanguageText('');
          // Note: Don't clear signLanguageSentence - keep committed words
          lastSignLanguagePredictionRef.current = '';
          lastAddedLetterRef.current = '';
          predictionHistoryRef.current = [];
          stablePredictionRef.current = '';
          stablePredictionStartTimeRef.current = null;
        }
      }
    };

    // Initial check
    checkAndStartRecognition();

    // Set up video element listeners to re-check when video becomes ready
    const videoElement = localVideoRef.current;
    const handleLoadedMetadata = () => {
      console.log('[Sign Language] Video metadata loaded, re-checking recognition conditions');
      checkAndStartRecognition();
    };
    const handleLoadedData = () => {
      console.log('[Sign Language] Video data loaded, re-checking recognition conditions');
      checkAndStartRecognition();
    };

    if (videoElement) {
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.addEventListener('loadeddata', handleLoadedData);
    }

    // Also check periodically (every 2 seconds) in case video becomes ready after effect runs
    // This handles the case where video element gets srcObject after the effect has run
    const periodicCheck = setInterval(() => {
      if (signLanguageEnabled && !signLanguageIntervalRef.current) {
        console.log('[Sign Language] Periodic check - signLanguageEnabled but interval not running, re-checking...');
        checkAndStartRecognition();
      }
    }, 2000);

    return () => {
      if (signLanguageIntervalRef.current) {
        clearInterval(signLanguageIntervalRef.current);
      }
      if (signLanguageUpdateTimeoutRef.current) {
        clearTimeout(signLanguageUpdateTimeoutRef.current);
      }
      if (videoElement) {
        videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoElement.removeEventListener('loadeddata', handleLoadedData);
      }
      clearInterval(periodicCheck);
    };
  }, [signLanguageEnabled, videoEnabled, localStream]);

  const handleLeave = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    peersRef.current.forEach((peer) => peer.close());
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    onLeave();
  };

  

  const [chatInput, setChatInput] = useState('');
  const handleSendMessage = () => {
    const text = chatInput.trim();
    if (!text) {
      return;
    }
    const payload = {
      roomId,
      message: text,
      userName,
      userId: userIdRef.current,
      timestamp: Date.now()
    };
    // Emit to room; server will broadcast to everyone including sender
    socketRef.current?.emit('chat-message', payload);
    // Speak locally
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
    setChatInput('');
  };

  // Always include local participant, even if stream is null
  // Use localStreamRef.current as fallback to ensure we always have the latest stream reference
  const localStreamForDisplay = localStream || localStreamRef.current;
  const allParticipants = [
    { 
      id: 'local', 
      socketId: socketRef.current?.id || 'local',
      stream: localStreamForDisplay, 
      userName: userName || 'You', 
      isLocal: true 
    },
    ...Array.from(remoteStreams.entries()).map(([socketId, data]) => ({
      id: socketId,
      socketId,
      stream: data.stream || data,
      userName: data.userName || data?.userName || 'Remote User',
      isLocal: false
    }))
  ];
  
  // Debug logging
  console.log('All participants:', allParticipants.map(p => ({ 
    id: p.id, 
    userName: p.userName, 
    hasStream: !!p.stream,
    isLocal: p.isLocal 
  })));
  console.log('Local stream state:', localStream ? 'exists' : 'null');
  console.log('Remote streams count:', remoteStreams.size);

  return (
    <div className="h-screen w-full bg-gray-900 flex flex-col overflow-hidden">
      <div className="flex-1 p-2 sm:p-4 overflow-hidden meeting-content">
        <div className="flex flex-col lg:flex-row gap-2 sm:gap-4 h-full max-w-7xl mx-auto">
          <div className="flex-1 overflow-auto min-h-0 pb-20 sm:pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
              {allParticipants.map((participant) => {
                // For local user, use socket.id if available, otherwise try both 'local' and socket.id
                // For remote users, use their socketId
                let participantSocketId = participant.socketId || participant.id;
                if (participant.isLocal && socketRef.current?.id) {
                  participantSocketId = socketRef.current.id;
                }
                let caption = captions.get(participantSocketId) || '';
                
                // Add sign language caption for local user
                if (participant.isLocal && signLanguageEnabled) {
                  let signCaption = '';
                  
                  // Show sentence if available
                  if (signLanguageSentence.length > 0) {
                    const sentenceText = signLanguageSentence.join(' ');
                    signCaption = `[Sentence: "${sentenceText}"]`;
                  }
                  
                  // Show current word being built (just the sequence, no arrow or converted text)
                  if (signLanguageSequence) {
                    const wordCaption = `[Sign: ${signLanguageSequence}]`;
                    signCaption = signCaption 
                      ? `${signCaption} ${wordCaption}`
                      : wordCaption;
                  }
                  
                  if (signCaption) {
                    caption = caption 
                      ? `${caption} ${signCaption}`
                      : signCaption;
                  }
                  
                  // Debug logging for sign language
                  console.log('[Sign Language Display] Sentence:', signLanguageSentence, 'Sequence:', signLanguageSequence, 'Text:', signLanguageText, 'Full caption:', caption);
                }
                
                // Add sign language caption for remote participants
                if (!participant.isLocal) {
                  const remoteSignData = remoteSignLanguage.get(participantSocketId);
                  if (remoteSignData) {
                    let signCaption = '';
                    
                    // Show sentence if available
                    if (remoteSignData.sentence && remoteSignData.sentence.length > 0) {
                      const sentenceText = remoteSignData.sentence.join(' ');
                      signCaption = `[Sentence: "${sentenceText}"]`;
                    }
                    
                    // Show current word being built (just the sequence, no arrow or converted text)
                    if (remoteSignData.sequence) {
                      const wordCaption = `[Sign: ${remoteSignData.sequence}]`;
                      signCaption = signCaption 
                        ? `${signCaption} ${wordCaption}`
                        : wordCaption;
                    }
                    
                    if (signCaption) {
                      caption = caption 
                        ? `${caption} ${signCaption}`
                        : signCaption;
                    }
                  }
                }
                
                // Debug logging
                if (participant.isLocal && caption) {
                  console.log('Rendering caption for local user:', caption, 'socketId:', participantSocketId);
                }
                
                return (
                  <VideoPlayer
                    key={participant.id}
                    stream={participant.stream}
                    userName={participant.userName}
                    isLocal={participant.isLocal}
                    videoRef={participant.isLocal ? localVideoRef : null}
                    caption={caption}
                  />
                );
              })}
            </div>
          </div>
          {/* Mobile chat toggle button */}
          <button
            onClick={() => setShowChat(!showChat)}
            className="lg:hidden fixed bottom-20 sm:bottom-24 right-4 z-40 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white p-3 rounded-full shadow-lg touch-manipulation"
            aria-label={showChat ? 'Hide chat' : 'Show chat'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {showChat ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              )}
            </svg>
          </button>
          <aside className={`${showChat ? 'flex' : 'hidden'} lg:flex w-full lg:w-80 xl:w-96 bg-gray-800 rounded-lg flex-col fixed lg:relative inset-0 lg:inset-auto z-[10000] lg:z-auto`}>
            <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm sm:text-base">Chat</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSpeakIncoming((v) => !v)}
                  className={`text-xs px-2 py-1 rounded ${speakIncoming ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white'}`}
                  aria-label={speakIncoming ? 'Disable speaking incoming messages' : 'Enable speaking incoming messages'}
                  title={speakIncoming ? 'TTS: On' : 'TTS: Off'}
                >
                  {speakIncoming ? 'TTS On' : 'TTS Off'}
                </button>
                <button
                  onClick={() => setShowChat(false)}
                  className="lg:hidden text-white p-1 hover:bg-gray-700 rounded"
                  aria-label="Close chat"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div ref={messagesContainerRef} className="flex-1 overflow-auto p-2 sm:p-3 space-y-2 pb-2 sm:pb-2" aria-live="polite">
              {messages.length === 0 && (
                <div className="text-gray-400 text-xs sm:text-sm text-center mt-8">No messages yet</div>
              )}
              {messages.map((m, idx) => {
                const isSelf = m.socketId === socketRef.current?.id || m.userId === userIdRef.current;
                return (
                  <div key={idx} className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] sm:max-w-[75%] rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 ${isSelf ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white'}`}>
                      <div className="text-[9px] sm:text-[10px] opacity-80 mb-0.5">
                        {isSelf ? 'You' : (m.userName || 'Guest')}
                      </div>
                      <div className="text-xs sm:text-sm break-words">{m.message}</div>
                      <div className="text-[9px] sm:text-[10px] opacity-60 mt-1 text-right">
                        {new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-2 sm:p-3 border-t border-gray-700 pb-20 sm:pb-2 lg:pb-3 bg-gray-800">
              <label htmlFor="chat-input" className="sr-only">Type a message</label>
              <div className="flex items-center gap-2">
                <input
                  id="chat-input"
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Message..."
                  className="flex-1 px-3 sm:px-3 py-3 sm:py-2.5 text-base sm:text-base rounded-md bg-gray-700 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 touch-manipulation"
                  aria-label="Chat message"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSendMessage();
                    }
                  }}
                />
                <button
                  onClick={handleSendMessage}
                  className="px-4 sm:px-4 py-3 sm:py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-base sm:text-base touch-manipulation min-h-[44px] sm:min-h-0"
                  aria-label="Send message"
                  title="Send message"
                >
                  Send
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className="bg-gray-800 p-3 sm:p-4 flex-shrink-0 relative z-[9999] border-t-2 border-gray-600 shadow-lg controls-container">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 max-w-7xl mx-auto">
          <div className="text-white text-xs sm:text-sm order-2 sm:order-1 hidden sm:block">
            Meeting ID: <span className="font-mono font-semibold break-all">{roomId}</span>
          </div>
          <Controls
            audioEnabled={audioEnabled}
            videoEnabled={videoEnabled}
            screenSharing={screenSharing}
            signLanguageEnabled={signLanguageEnabled}
            onToggleAudio={handleToggleAudio}
            onToggleVideo={handleToggleVideo}
            onScreenShare={handleScreenShare}
            onToggleSignLanguage={() => {
              const newValue = !signLanguageEnabled;
              console.log('[Sign Language] Button clicked! Toggling from', signLanguageEnabled, 'to', newValue);
              console.log('[Sign Language] Current state at button click:', {
                signLanguageEnabled,
                videoEnabled,
                hasLocalStream: !!(localStream || localStreamRef.current),
                hasLocalVideo: !!(localVideoRef.current && localVideoRef.current.srcObject),
                localStreamState: !!localStream,
                localStreamRef: !!localStreamRef.current,
                videoElement: !!localVideoRef.current,
                videoSrcObject: !!(localVideoRef.current && localVideoRef.current.srcObject),
                videoReadyState: localVideoRef.current ? localVideoRef.current.readyState : 'no element'
              });
              setSignLanguageEnabled(newValue);
            }}
            onLeave={handleLeave}
          />
        </div>
      </div>
    </div>
  );
};

export default MeetingRoom;
