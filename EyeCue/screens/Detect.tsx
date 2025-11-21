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
} from "react-native";
import {
  GestureDetector,
  Gesture,
  Directions,
} from "react-native-gesture-handler";
import { useCameraContext } from "../contexts/CameraContext";
import {
  sendImageForObjectDetection,
  speakText,
  cancelSpeakText,
} from "../services/huggingfaceApi";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system";
import { Audio } from "expo-av";

/**
 * Detect screen component for object detection functionality
 * Handles camera capture, image processing, and object detection
 * Implements gesture controls for camera interaction
 */
export default function Detect() {
  // Navigation and permission hooks
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const navigationState = useNavigationState(state => state);
  const [permission, requestPermission] = useCameraPermissions();

  // Camera and UI state management
  const [showCamera, setShowCamera] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [detectionResults, setDetectionResults] = useState<string>("");
  const [isDetecting, setIsDetecting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // Refs for managing component lifecycle and state
  const cameraRef = useRef<any>(null);
  const sessionIdRef = useRef(0); // Tracks current session to prevent stale operations
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastResizedUriRef = useRef<string | null>(null);
  const loadingSoundRef = useRef<Audio.Sound | null>(null);
  const audioQueueRef = useRef<(() => Promise<void>)[]>([]);
  const isPlayingAudioRef = useRef(false);
  const lastCaptureTimeRef = useRef<number>(0);
  
  // Constants
  const CAPTURE_COOLDOWN = 2000; // Prevents rapid consecutive captures

  // Context values for camera and tutorial state
  const { facing, setFacing, isTutorialActive, startTutorial, tutorialText } = useCameraContext();

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
   * Resets component state to initial values
   * Called when switching modes or cleaning up
   */
  const resetState = () => {
    setCapturedPhoto(null);
    setDetectionResults("");
    setIsDetecting(false);
    setIsCapturing(false);
    lastCaptureTimeRef.current = 0;
  };

  /**
   * Stops and cleans up the loading sound
   * Ensures proper resource cleanup
   */
  const stopLoadingSound = async () => {
    if (loadingSoundRef.current) {
      try {
        const status = await loadingSoundRef.current.getStatusAsync();
        if (status.isLoaded) {
          await loadingSoundRef.current.stopAsync();
          await loadingSoundRef.current.unloadAsync();
        }
      } catch (error) {
        console.warn("Error stopping loading sound:", error);
      } finally {
        loadingSoundRef.current = null;
      }
    }
  };

  // Handle screen focus changes and cleanup
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const handleFocusChange = async () => {
      // Stop any playing sounds when focus changes
      await stopLoadingSound();
      
      if (isFocused) {
        // Initialize new session
        sessionIdRef.current += 1;
        abortControllerRef.current?.abort();
        cancelSpeakText();
        abortControllerRef.current = new AbortController();
        resetState();

        // Small delay before showing camera to ensure clean state
        timeout = setTimeout(() => {
          setCameraKey((prev) => prev + 1);
          setShowCamera(true);
        }, 300);
      } else {
        // Cleanup when leaving screen
        sessionIdRef.current += 1;
        
        // Stop all audio and abort ongoing operations
        await stopLoadingSound();
        cancelSpeakText();
        
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        
        // Reset UI state
        setShowCamera(false);
        setIsDetecting(false);
        setIsCapturing(false);
        setDetectionResults("");
        lastCaptureTimeRef.current = 0;

        // Clean up temporary files
        if (capturedPhoto) {
          try {
            await FileSystem.deleteAsync(capturedPhoto, { idempotent: true });
          } catch (err) {
            console.warn("Failed to delete photo:", err);
          }
        }

        if (lastResizedUriRef.current) {
          try {
            await FileSystem.deleteAsync(lastResizedUriRef.current, {
              idempotent: true,
            });
          } catch (err) {
            console.warn("Failed to delete resized image:", err);
          }
        }
      }
    };

    handleFocusChange();

    return () => {
      clearTimeout(timeout);
      stopLoadingSound();
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
   * Toggles between front and back camera
   * Includes a small delay to ensure smooth transition
   */
  const toggleCameraFacing = () => {
    setShowCamera(false);
    setTimeout(() => {
      setFacing(facing === "back" ? "front" : "back");
      setCameraKey((prev) => prev + 1);
      setShowCamera(true);
    }, 150);
  };

  /**
   * Captures and processes a photo for object detection
   * Handles the complete flow from capture to result
   */
  const takePhoto = async () => {
    const now = Date.now();
    if (now - lastCaptureTimeRef.current < CAPTURE_COOLDOWN) {
      return; // Prevent rapid consecutive captures
    }

    if (!cameraRef.current || isDetecting || isCapturing) return;
    const currentSession = sessionIdRef.current;

    try {
      lastCaptureTimeRef.current = now;
      setIsCapturing(true);
      
      // Capture photo
      const takenPhoto = await cameraRef.current.takePictureAsync({
        quality: 1,
        base64: false,
        exif: false,
      });

      if (!takenPhoto?.uri) throw new Error("Photo capture failed");
      if (sessionIdRef.current !== currentSession) return;

      // Update UI and start processing
      setCapturedPhoto(takenPhoto.uri);
      setIsDetecting(true);
      setDetectionResults("Processing...");

      // Audio feedback for processing state
      await speakText("Processing...");
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Start processing sound
      const { sound } = await Audio.Sound.createAsync(
        require("../assets/processing.mp3")
      );
      loadingSoundRef.current = sound;
      await sound.setIsLoopingAsync(true);
      await sound.playAsync();

      // Resize image for API
      const resized = await ImageManipulator.manipulateAsync(
        takenPhoto.uri,
        [{ resize: { width: 224, height: 224 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );

      lastResizedUriRef.current = resized.uri;

      // Send to API for detection
      const result = await sendImageForObjectDetection(
        resized.uri,
        abortControllerRef.current?.signal
      );

      if (sessionIdRef.current !== currentSession) return;

      // Stop processing sound and update UI
      await stopLoadingSound();
      const output = result || "No objects found";
      setDetectionResults(output);

      // Speak results after a short delay
      await new Promise(resolve => setTimeout(resolve, 500));
      if (typeof output === "string" && isFocused) {
        await speakText(output);
      }

      // Cleanup temporary files
      await FileSystem.deleteAsync(resized.uri, { idempotent: true });
      lastResizedUriRef.current = null;
    } catch (error: any) {
      if (sessionIdRef.current !== currentSession) return;
      console.warn("Object detection error:", error.message);
      await stopLoadingSound();
      setDetectionResults("Please Try Again");
      await speakText("Please Try Again");
    } finally {
      if (sessionIdRef.current !== currentSession) return;
      setIsDetecting(false);
      // Prevent immediate recapture
      setTimeout(() => {
        setIsCapturing(false);
      }, 1000);
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
        return false;
      };

      // Prevent capture during processing or audio playback
      if (
        isDetecting || 
        isCapturing ||
        isPlayingAudioRef.current ||
        await isAnySoundPlaying()
      ) {
        return;
      }

      // Additional safety check after delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
      if (
        isDetecting || 
        isCapturing ||
        isPlayingAudioRef.current ||
        await isAnySoundPlaying()
      ) {
        return;
      }

      takePhoto();
    });

  // Navigation gestures
  const swipeDown = Gesture.Fling()
    .direction(Directions.DOWN)
    .onEnd(() => {
      if (!isDetecting) {
        toggleCameraFacing();
      }
    });

  const swipeLeft = Gesture.Fling()
    .direction(Directions.LEFT)
    .onEnd(() => navigation.navigate("Describe" as never));

  const swipeRight = Gesture.Fling()
    .direction(Directions.RIGHT)
    .onEnd(() => navigation.navigate("Color" as never));

  const swipeUp = Gesture.Fling()
    .direction(Directions.UP)
    .onEnd(async () => {
      if (isTutorialActive || isDetecting || isCapturing) return;
      await startTutorial();
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

            {/* Detection results overlay */}
            {detectionResults !== "" && (
              <View style={styles.resultOverlay}>
                <Text style={styles.resultText}>{detectionResults}</Text>
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
  },

  resultText: {
    color: "white",
    fontSize: 18,
    textAlign: "center",
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
