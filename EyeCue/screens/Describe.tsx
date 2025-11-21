import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { useIsFocused, useNavigation, useNavigationState } from "@react-navigation/native";
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
  Alert,
} from "react-native";
import {
  GestureDetector,
  Gesture,
  Directions,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useCameraContext } from "../contexts/CameraContext";
import {
  sendImageForCaptioning,
  sendImageForVQA,
  sendAudioForTranscription,
  speakText,
  cancelSpeakText,
  currentSound,
} from "../services/huggingfaceApi";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";

/**
 * Describe screen component for image captioning and visual question answering
 * Handles camera capture, image processing, and speech recognition
 * Implements gesture controls for camera interaction and voice input
 */
export default function Describe() {
  // Navigation and permission hooks
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const navigationState = useNavigationState(state => state);
  const [permission, requestPermission] = useCameraPermissions();

  // Camera and UI state management
  const [showCamera, setShowCamera] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [recognizedQuestion, setRecognizedQuestion] = useState("");
  const [vqaResponse, setVqaResponse] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isCaptioning, setIsCaptioning] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isWhisperProcessing, setIsWhisperProcessing] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [recordingTimeLeft, setRecordingTimeLeft] = useState<number>(0);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs for managing component lifecycle and state
  const sessionIdRef = useRef(0); // Tracks current session to prevent stale operations
  const abortControllerRef = useRef<AbortController | null>(null);
  const cameraRef = useRef<any>(null);
  const loadingSoundRef = useRef<Audio.Sound | null>(null);
  const listeningSoundRef = useRef<Audio.Sound | null>(null);
  const audioQueueRef = useRef<(() => Promise<void>)[]>([]);
  const isPlayingAudioRef = useRef(false);
  const lastCaptureTimeRef = useRef<number>(0);

  // Constants
  const CAPTURE_COOLDOWN = 2000; // Prevents rapid consecutive captures
  const RECORDING_TIMEOUT = 10000; // 10 seconds timeout for recording

  // Context values for camera and tutorial state
  const { facing, setFacing, isTutorialActive, startTutorial, tutorialText } = useCameraContext();

  // Add with other state variables
  const [isLongPressActive, setIsLongPressActive] = useState(false);
  const [forceGestureEnd, setForceGestureEnd] = useState(false);

  /**
   * Resets component state to initial values
   * Called when switching modes or cleaning up
   */
  const resetState = () => {
    setCapturedPhoto(null);
    setCaption("");
    setRecognizedQuestion("");
    setVqaResponse("");
    setStatusMessage("");
    setIsCaptioning(false);
    setIsDetecting(false);
    setIsCapturing(false);
    setIsWhisperProcessing(false);
    lastCaptureTimeRef.current = 0;
  };

  /**
   * Manages the audio queue for sequential playback
   * Ensures only one audio clip plays at a time
   */
  const playNextInQueue = async () => {
    if (isPlayingAudioRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingAudioRef.current = true;
    const nextAudio = audioQueueRef.current.shift();
    
    if (nextAudio) {
      try {
        await nextAudio();
      } catch (error) {
        console.warn("Error playing audio:", error);
      }
    }
    
    isPlayingAudioRef.current = false;
    playNextInQueue();
  };

  /**
   * Adds an audio function to the playback queue
   * @param audioFn - Async function that plays an audio clip
   */
  const queueAudio = (audioFn: () => Promise<void>) => {
    audioQueueRef.current.push(audioFn);
    playNextInQueue();
  };

  /**
   * Stops and cleans up a sound reference
   * @param ref - Reference to the sound object to stop
   */
  const stopSound = async (ref: React.MutableRefObject<Audio.Sound | null>) => {
    if (ref.current) {
      try {
        const status = await ref.current.getStatusAsync();
        if (status.isLoaded) {
          await ref.current.stopAsync();
          await ref.current.unloadAsync();
        }
      } catch (error) {
        console.warn("Error stopping sound:", error);
      } finally {
        ref.current = null;
      }
    }
  };

  // Handle screen focus changes and cleanup
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const handleFocusChange = async () => {
      // Stop any playing sounds when focus changes
      await Promise.all([
        stopSound(loadingSoundRef),
        stopSound(listeningSoundRef)
      ]);
      
      if (isFocused) {
        // Initialize new session
        sessionIdRef.current += 1;
        abortControllerRef.current?.abort();
        cancelSpeakText();
        abortControllerRef.current = new AbortController();
        resetState();

        // Reset camera state with small delay
        setShowCamera(false);
        setCameraKey((prev) => prev + 1);
        
        timeout = setTimeout(() => {
          setShowCamera(true);
        }, 300);
      } else {
        // Cleanup when leaving screen
        sessionIdRef.current += 1;
        
        // Stop all audio and abort ongoing operations
        await Promise.all([
          stopSound(loadingSoundRef),
          stopSound(listeningSoundRef)
        ]);
        cancelSpeakText();
        
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        
        // Stop any ongoing recording
        if (recording) {
          try {
            await recording.stopAndUnloadAsync();
            const uri = await recording.getURI();
            if (uri) {
              await FileSystem.deleteAsync(uri, { idempotent: true });
            }
          } catch (err) {
            console.warn("Failed to stop recording:", err);
          }
        }

        // Reset all states
        setShowCamera(false);
        setIsWhisperProcessing(false);
        setIsDetecting(false);
        setIsCapturing(false);
        setIsCaptioning(false);
        setVqaResponse("");
        setRecognizedQuestion("");
        setStatusMessage("");
        setRecording(null);
        setCapturedPhoto(null);
        setCaption("");
        lastCaptureTimeRef.current = 0;

        // Clean up temporary files
        if (capturedPhoto) {
          try {
            await FileSystem.deleteAsync(capturedPhoto, { idempotent: true });
          } catch (err) {
            console.warn("Failed to delete photo:", err);
          }
        }
      }
    };

    handleFocusChange();

    return () => {
      clearTimeout(timeout);
      // Ensure sounds are stopped when component unmounts
      Promise.all([
        stopSound(loadingSoundRef),
        stopSound(listeningSoundRef)
      ]);
    };
  }, [isFocused]);

  // Request camera permissions if not granted
  useEffect(() => {
    if (!permission) return;
    if (permission.status === "undetermined") {
      requestPermission();
    }
  }, [permission]);

  /**
   * Captures and processes a photo for image captioning
   * Handles the complete flow from capture to caption
   */
  const takePhoto = async () => {
    const now = Date.now();
    if (now - lastCaptureTimeRef.current < CAPTURE_COOLDOWN) {
      return; // Prevent rapid consecutive captures
    }

    if (!cameraRef.current || isCaptioning || isCapturing || isWhisperProcessing) return;
    const currentSession = sessionIdRef.current;

    try {
      lastCaptureTimeRef.current = now;
      setIsCapturing(true);

      // Capture photo
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        base64: false,
        exif: false,
      });
      if (!photo?.uri) throw new Error("Photo capture failed");
      if (sessionIdRef.current !== currentSession) return;

      // Update UI and start processing
      setCapturedPhoto(photo.uri);
      setCaption("Processing...");
      setRecognizedQuestion("");
      setVqaResponse("");
      setIsCaptioning(true);

      // Audio feedback for processing state
      await speakText("Processing...");

      // Start processing sound
      const { sound } = await Audio.Sound.createAsync(
        require("../assets/processing.mp3")
      );
      loadingSoundRef.current = sound;
      await sound.setIsLoopingAsync(true);
      setTimeout(() => {
        sound.playAsync();
      }, 300);

      // Get image caption from API
      const captionResp = await sendImageForCaptioning(
        photo.uri,
        abortControllerRef.current?.signal
      );

      if (sessionIdRef.current !== currentSession) return;

      // Stop processing sound and update UI
      await stopSound(loadingSoundRef);
      setCaption(captionResp || "No description found.");

      // Speak caption if available
      if (captionResp && sessionIdRef.current === currentSession && isFocused) {
        await speakText(captionResp);
      }

      setIsCaptioning(false);
    } catch (err: any) {
      if (sessionIdRef.current !== currentSession) return;
      await stopSound(loadingSoundRef);
      console.warn("Caption error:", err.message);
      setCaption("Please Try Again");
      await speakText("Please Try Again");
      setIsCaptioning(false);
    } finally {
      if (sessionIdRef.current === currentSession) {
        // Prevent immediate recapture
        setTimeout(() => {
          setIsCapturing(false);
        }, 1000);
      }
    }
  };

  /**
   * Processes a recognized question with the captured image
   * Handles the VQA (Visual Question Answering) flow
   * @param question - The recognized question text
   * @param signal - Optional abort signal for cancellation
   */
  const handleRecognizedQuestion = async (
    question: string,
    signal?: AbortSignal
  ) => {
    if (!capturedPhoto) return;
    const currentSession = sessionIdRef.current;

    try {
      setRecognizedQuestion(question);
      setVqaResponse("Processing...");
      setIsDetecting(true);

      // Audio feedback for processing state
      await speakText("Processing...");

      // Start processing sound
      const { sound } = await Audio.Sound.createAsync(
        require("../assets/processing.mp3")
      );
      loadingSoundRef.current = sound;
      await sound.setIsLoopingAsync(true);
      setTimeout(() => {
        sound.playAsync();
      }, 300);

      // Get VQA response from API
      const vqaAnswer = await sendImageForVQA(capturedPhoto, question, signal);

      if (sessionIdRef.current !== currentSession) return;

      // Stop processing sound and update UI
      await stopSound(loadingSoundRef);
      setVqaResponse(vqaAnswer || "No answer found.");

      // Speak answer if available
      if (vqaAnswer && sessionIdRef.current === currentSession && isFocused) {
        await speakText(vqaAnswer);
      }
    } catch (err: any) {
      if (sessionIdRef.current !== currentSession) return;
      await stopSound(loadingSoundRef);
      console.warn("VQA error:", err.message);
      setVqaResponse("Please Try Again");
      await speakText("Please Try Again");
    } finally {
      if (sessionIdRef.current === currentSession) {
        setIsDetecting(false);
      }
    }
  };

  /**
   * Force stops the recording and starts processing
   */
  const forceStopRecording = async () => {
    if (!recording) return;
    
    try {
      // Stop any ongoing countdown
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      setRecordingTimeLeft(0);
      setStatusMessage(""); // Clear the Listening... message

      // Force stop the recording
      await recording.stopAndUnloadAsync();
      setRecording(null);
      
      // Start processing
      setIsDetecting(true);
      setIsWhisperProcessing(true);
      setVqaResponse("Processing...");

      // Get the recording URI
      const uri = recording.getURI();
      if (!uri) throw new Error("Recording failed");

      // Configure audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      // Play recording end sound
      const { sound: listeningOffSound } = await Audio.Sound.createAsync(
        require("../assets/listeningOFF.mp3")
      );
      await listeningOffSound.playAsync();
      await new Promise(resolve => setTimeout(resolve, 800));

      // Process audio and get transcription
      await speakText("Processing...");
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Start processing sound
      const { sound: processingSound } = await Audio.Sound.createAsync(
        require("../assets/processing.mp3")
      );
      loadingSoundRef.current = processingSound;
      await processingSound.setIsLoopingAsync(true);
      await processingSound.playAsync();

      // Get transcription from API
      const recognizedText = await sendAudioForTranscription(
        uri,
        abortControllerRef.current?.signal
      );

      if (recognizedText) {
        setRecognizedQuestion(recognizedText);
        if (capturedPhoto) {
          // Get VQA response for transcribed question
          const vqaAnswer = await sendImageForVQA(
            capturedPhoto,
            recognizedText,
            abortControllerRef.current?.signal
          );

          setVqaResponse(vqaAnswer || "No answer found.");

          // Speak answer if available
          if (vqaAnswer && isFocused) {
            await speakText(vqaAnswer);
          }
        }
      } else {
        setVqaResponse("No speech recognized");
      }
    } catch (error) {
      console.warn("Error force stopping recording:", error);
      // Reset states in case of error
      setRecording(null);
      setStatusMessage("");
      setIsDetecting(false);
      setIsWhisperProcessing(false);
      setVqaResponse("Recognition failed.");
    } finally {
      // Cleanup sounds
      if (loadingSoundRef.current) {
        await loadingSoundRef.current.stopAsync();
        await loadingSoundRef.current.unloadAsync();
        loadingSoundRef.current = null;
      }
      setIsDetecting(false);
      setIsWhisperProcessing(false);
    }
  };

  /**
   * Starts voice recording for question input
   * Handles audio setup and initial feedback
   */
  const handleLongPressStart = async () => {
    const currentSession = sessionIdRef.current;

    // Prevent listening if no image is captured, during processing, or already listening
    if (!capturedPhoto || 
        isCaptioning || 
        isDetecting || 
        isWhisperProcessing || 
        isCapturing || 
        vqaResponse === "Processing..." ||
        recording ||
        statusMessage === "Listening...") {
      return;
    }

    try {
      // Request audio permissions
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") return;

      setStatusMessage("Listening...");
      setRecordingTimeLeft(RECORDING_TIMEOUT / 1000); // Set initial countdown in seconds

      // Play listening sound and speak feedback
      const [listeningSound] = await Promise.all([
        Audio.Sound.createAsync(require("../assets/listeningON.mp3")),
        speakText("Listening...")
      ]);
      listeningSoundRef.current = listeningSound.sound;
      await listeningSound.sound.playAsync();
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Configure audio mode for recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Start recording with optimal settings
      const { recording: newRecording } = await Audio.Recording.createAsync({
        android: {
          extension: ".wav",
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: ".wav",
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: "audio/webm",
          bitsPerSecond: 128000,
        },
      });

      if (sessionIdRef.current !== currentSession) return;
      setRecording(newRecording);

      // Start countdown interval
      countdownIntervalRef.current = setInterval(() => {
        setRecordingTimeLeft(prev => {
          const newTime = prev - 1;
          if (newTime <= 0) {
            // Clear interval and force stop
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }
            // Force the gesture to end by updating state
            setForceGestureEnd(true);
            return 0;
          }
          return newTime;
        });
      }, 1000);

      // Set timeout to force stop recording after 10 seconds
      recordingTimeoutRef.current = setTimeout(() => {
        if (sessionIdRef.current === currentSession && recording) {
          // Force the gesture to end by updating state
          setForceGestureEnd(true);
        }
      }, RECORDING_TIMEOUT);

    } catch (error) {
      console.error("Failed to start recording:", error);
      setStatusMessage("");
      setRecordingTimeLeft(0);
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        recordingTimeoutRef.current = null;
      }
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    }
  };

  // Gesture handlers for camera interaction
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(async () => {
      const now = Date.now();
      if (now - lastCaptureTimeRef.current < CAPTURE_COOLDOWN) {
        return;
      }

      // Check if any audio is currently playing
      const isAnySoundPlaying = async () => {
        if (loadingSoundRef.current) {
          const status = await loadingSoundRef.current.getStatusAsync();
          if (status.isLoaded && status.isPlaying) return true;
        }
        if (listeningSoundRef.current) {
          const status = await listeningSoundRef.current.getStatusAsync();
          if (status.isLoaded && status.isPlaying) return true;
        }
        return false;
      };

      // Prevent capture during processing or audio playback
      if (
        isCaptioning || 
        isDetecting || 
        recording || 
        statusMessage || 
        vqaResponse === "Processing..." ||
        isPlayingAudioRef.current ||
        isCapturing ||
        await isAnySoundPlaying()
      ) {
        return;
      }

      // Additional safety check after delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (
        isCaptioning || 
        isDetecting || 
        recording || 
        statusMessage || 
        vqaResponse === "Processing..." ||
        isPlayingAudioRef.current ||
        isCapturing ||
        await isAnySoundPlaying()
      ) {
        return;
      }

      takePhoto();
    });

  // Navigation gestures
  const swipeLeft = Gesture.Fling()
    .direction(Directions.LEFT)
    .onEnd(() => navigation.navigate("Color" as never));

  const swipeRight = Gesture.Fling()
    .direction(Directions.RIGHT)
    .onEnd(() => navigation.navigate("Detect" as never));

  const swipeDown = Gesture.Fling()
    .direction(Directions.DOWN)
    .onEnd(() => {
      if (!isCaptioning && !isDetecting && !recording && statusMessage !== "Listening...") {
        setShowCamera(false);
        setTimeout(() => {
          setFacing(facing === "back" ? "front" : "back");
          setCameraKey((prev) => prev + 1);
          setShowCamera(true);
        }, 150);
      }
    });

  const swipeUp = Gesture.Fling()
    .direction(Directions.UP)
    .onEnd(async () => {
      if (isTutorialActive || isCaptioning || isDetecting || recording || isWhisperProcessing || isCapturing) return;
      await startTutorial();
    });

  // Update the gesture definition back to its previous state
  const longPressGesture = Gesture.LongPress()
    .minDuration(600)
    .enabled(!isCaptioning && !isDetecting && !isWhisperProcessing && !isCapturing && 
            vqaResponse !== "Processing..." && !!capturedPhoto && !forceGestureEnd)
    .onStart(() => {
      setIsLongPressActive(true);
      setForceGestureEnd(false);
      handleLongPressStart();
    })
    .onFinalize(() => {
      // This will be called both on natural end and when gesture is cancelled
      if (recording) {
        forceStopRecording();
      }
      setIsLongPressActive(false);
      setForceGestureEnd(false);
    });

  // Combine gestures based on tutorial state
  const gestures = Gesture.Race(
    isTutorialActive ? 
      // Tutorial mode: only allow exit gesture
      Gesture.Fling()
        .direction(Directions.UP)
        .onEnd(async () => {
          if (isTutorialActive) {
            await cancelSpeakText();
          }
        })
      : 
      // Normal mode: all gestures enabled
      Gesture.Race(
        doubleTap,
        swipeDown,
        swipeLeft,
        swipeRight,
        isTutorialActive ? 
          Gesture.Tap() 
          : 
          longPressGesture,
        swipeUp
      )
  );

  // Prevent navigation during tutorial
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    if (isTutorialActive) {
      unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
        e.preventDefault();
      });
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [isTutorialActive, navigation]);

  // Show empty view if no camera permission
  if (!permission || !permission.granted)
    return <View style={styles.container} />;

  return (
    <GestureDetector gesture={gestures}>
      <View style={styles.container}>
        {showCamera && (
          <>
            <CameraView
              key={cameraKey}
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              zoom={0}
              pointerEvents={isTutorialActive ? "none" : "box-none"}
            />

            {/* Camera mode label */}
            <View style={styles.cameraLabel}>
              <Text style={styles.cameraLabelText}>
                {facing === "front" ? "Camera Front" : "Camera Back"}
              </Text>
            </View>

            {/* Tutorial overlay */}
            {isTutorialActive && (
              <View style={styles.tutorialOverlay}>
                <Text style={styles.tutorialTitle}>Tutorial ON</Text>
                <Text style={styles.tutorialText}>{tutorialText}</Text>
              </View>
            )}

            {/* Captured photo thumbnail */}
            {capturedPhoto && (
              <Image
                source={{ uri: capturedPhoto }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
            )}

            {/* Results overlay */}
            {(caption ||
              recognizedQuestion ||
              vqaResponse ||
              isDetecting ||
              statusMessage ||
              recordingTimeLeft > 0) && (
              <View style={styles.resultOverlay}>
                {caption ? (
                  <Text style={styles.captionText}>{caption}</Text>
                ) : null}
                {recognizedQuestion ? (
                  <Text style={styles.questionText}>{recognizedQuestion}</Text>
                ) : null}
                {vqaResponse ? (
                  <Text style={styles.answerText}>{vqaResponse}</Text>
                ) : isDetecting ? (
                  <Text style={styles.answerText}>Processing...</Text>
                ) : null}
                {statusMessage ? (
                  <Text style={styles.statusText}>
                    {statusMessage}
                    {recordingTimeLeft > 0 && ` (${recordingTimeLeft}s)`}
                  </Text>
                ) : null}
              </View>
            )}
          </>
        )}
      </View>
    </GestureDetector>
  );
}

// Styles for the component
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  cameraLabel: {
    position: "absolute",
    top: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 12 : 40,
    alignSelf: "center",
    backgroundColor: "black",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
  },
  cameraLabelText: {
    color: "gray",
    fontSize: 15,
    fontWeight: "bold",
    textAlign: "center",
  },
  thumbnail: {
    position: "absolute",
    top: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 20 : 90,
    right: 20,
    width: 96,
    height: 96,
    borderRadius: 12,
    borderColor: "black",
    borderWidth: 5,
  },
  resultOverlay: {
    position: "absolute",
    bottom: 40,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 12,
    borderRadius: 10,
    maxWidth: "90%",
    alignItems: "center",
  },
  captionText: {
    color: "white",
    fontSize: 18,
    textAlign: "center",
  },
  questionText: {
    color: "#ff0",
    fontSize: 17,
    textAlign: "center",
    marginTop: 10,
  },
  answerText: {
    color: "#0f0",
    fontSize: 18,
    textAlign: "center",
    marginTop: 10,
  },
  statusText: {
    color: "#ff0",
    fontSize: 16,
    textAlign: "center",
    marginTop: 10,
  },
  tutorialOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  tutorialTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  tutorialText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    lineHeight: 24,
  },
});
