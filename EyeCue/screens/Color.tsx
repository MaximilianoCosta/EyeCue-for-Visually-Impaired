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
  sendImageForColorVQA,
  speakText,
  cancelSpeakText,
} from "../services/huggingfaceApi";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";

/**
 * Color screen component for color analysis
 * Handles camera capture and color detection
 * Implements gesture controls for camera interaction
 */
export default function Color() {
  // Navigation and permission hooks
  const isFocused = useIsFocused();
  const navigation = useNavigation();
  const navigationState = useNavigationState(state => state);
  const [permission, requestPermission] = useCameraPermissions();

  // Camera and UI state management
  const [showCamera, setShowCamera] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [detectedColor, setDetectedColor] = useState("");
  const [isDetecting, setIsDetecting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // Refs for managing component lifecycle and state
  const sessionIdRef = useRef(0); // Tracks current session to prevent stale operations
  const abortControllerRef = useRef<AbortController | null>(null);
  const cameraRef = useRef<any>(null);
  const loadingSoundRef = useRef<Audio.Sound | null>(null);
  const lastCaptureTimeRef = useRef<number>(0);

  // Constants
  const CAPTURE_COOLDOWN = 2000; // Prevents rapid consecutive captures

  // Context values for camera and tutorial state
  const { facing, setFacing, isTutorialActive, startTutorial, tutorialText } = useCameraContext();

  /**
   * Resets component state to initial values
   * Called when switching modes or cleaning up
   */
  const resetState = () => {
    setCapturedPhoto(null);
    setDetectedColor("");
    setIsDetecting(false);
    setIsCapturing(false);
    lastCaptureTimeRef.current = 0;
  };

  /**
   * Stops and cleans up a sound reference
   */
  const stopLoadingSound = async () => {
    if (loadingSoundRef.current) {
      try {
        const status = await loadingSoundRef.current.getStatusAsync();
        if (status.isLoaded) {
          await loadingSoundRef.current.stopAsync();
          await loadingSoundRef.current.unloadAsync();
          loadingSoundRef.current = null;
        }
      } catch (error) {
        console.warn("Error stopping loading sound:", error);
        loadingSoundRef.current = null;
      }
    }
  };

  // Handle screen focus changes and cleanup
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const handleFocusChange = async () => {
      // Immediately stop any playing sounds and speech when focus changes
      cancelSpeakText();
      await stopLoadingSound();
      
      if (isFocused) {
        // Initialize new session
        sessionIdRef.current += 1;
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();
        resetState();

        // Reset camera state with small delay
        setShowCamera(false);
        setCameraKey((prev) => prev + 1);
        
        timeout = setTimeout(() => {
          setShowCamera(true);
        }, 300);
      } else {
        // Aggressive cleanup when leaving screen
        sessionIdRef.current += 1;
        
        // Immediately stop all audio and speech
        cancelSpeakText();
        await stopLoadingSound();
        
        // Abort any ongoing operations
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }

        // Reset all states immediately
        setShowCamera(false);
        setIsDetecting(false);
        setIsCapturing(false);
        setCapturedPhoto(null);
        setDetectedColor("");
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
      // Aggressive cleanup when component unmounts
      cancelSpeakText();
      stopLoadingSound();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [isFocused]);

  // Request camera permissions if not granted
  useEffect(() => {
    if (!permission) return;
    if (permission.status === "undetermined") {
      requestPermission();
    }
  }, [permission]);

  // Automatic capture interval for color detection
  useEffect(() => {
    let interval: ReturnType<typeof setTimeout>;

    if (isFocused && showCamera && !isTutorialActive && !isDetecting && !isCapturing) {
      interval = setInterval(() => {
        takePhoto();
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isFocused, showCamera, isTutorialActive, isDetecting, isCapturing]);

  /**
   * Captures and processes a photo for color analysis
   * Handles the complete flow from capture to analysis
   */
  const takePhoto = async () => {
    const now = Date.now();
    if (now - lastCaptureTimeRef.current < CAPTURE_COOLDOWN) {
      return; // Prevent rapid consecutive captures
    }

    if (!cameraRef.current || isDetecting || isCapturing || !isFocused) return;
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
      if (sessionIdRef.current !== currentSession || !isFocused) {
        await stopLoadingSound();
        return;
      }

      // Update UI and start processing
      setCapturedPhoto(photo.uri);
      setDetectedColor("");
      setIsDetecting(true);

      // Start both speech and sound together, but make them independently cancellable
      if (isFocused) {
        // Start speech first
        try {
          if (isFocused && sessionIdRef.current === currentSession) {
            await speakText("Processing...");
          }
        } catch (error) {
          console.warn("Error starting speech:", error);
          cancelSpeakText();
        }

        // Start processing sound after speech
        try {
          const { sound } = await Audio.Sound.createAsync(
            require("../assets/processing.mp3")
          );
          if (!isFocused || sessionIdRef.current !== currentSession) {
            await sound.unloadAsync();
            return;
          }
          loadingSoundRef.current = sound;
          await sound.setIsLoopingAsync(true);
          await sound.playAsync();
        } catch (error) {
          console.warn("Error starting processing sound:", error);
          await stopLoadingSound();
        }
      }

      // Get color detection from API
      const colorResp = await sendImageForColorVQA(
        photo.uri,
        abortControllerRef.current?.signal
      );

      // Stop both speech and sound before proceeding
      cancelSpeakText();
      await stopLoadingSound();

      if (sessionIdRef.current !== currentSession || !isFocused) {
        return;
      }

      // Update UI with results
      setDetectedColor(colorResp || "No color detected.");

      // Speak color if available and still focused
      if (colorResp && sessionIdRef.current === currentSession && isFocused) {
        try {
          await speakText(colorResp);
        } catch (error) {
          console.warn("Error speaking color:", error);
          cancelSpeakText();
        }
      }

      setIsDetecting(false);
    } catch (err: any) {
      // Ensure both speech and sound are stopped on error
      cancelSpeakText();
      await stopLoadingSound();

      if (sessionIdRef.current !== currentSession || !isFocused) {
        return;
      }

      console.warn("Color detection error:", err.message);
      setDetectedColor("Please Try Again");
      
      if (isFocused) {
        try {
          await speakText("Please Try Again");
        } catch (error) {
          console.warn("Error speaking retry message:", error);
          cancelSpeakText();
        }
      }
      
      setIsDetecting(false);
    } finally {
      // Always ensure both speech and sound are stopped
      cancelSpeakText();
      await stopLoadingSound();

      if (sessionIdRef.current === currentSession && isFocused) {
        // Prevent immediate recapture
        setTimeout(() => {
          setIsCapturing(false);
        }, 1000);
      } else {
        setIsCapturing(false);
      }
    }
  };

  // Navigation gestures
  const swipeLeft = Gesture.Fling()
    .direction(Directions.LEFT)
    .onEnd(() => navigation.navigate("Detect" as never));

  const swipeRight = Gesture.Fling()
    .direction(Directions.RIGHT)
    .onEnd(() => navigation.navigate("Describe" as never));

  const swipeDown = Gesture.Fling()
    .direction(Directions.DOWN)
    .onEnd(() => {
      if (!isDetecting) {
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

            {/* Captured photo thumbnail */}
            {capturedPhoto && (
              <Image
                source={{ uri: capturedPhoto }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
            )}

            {/* Results overlay */}
            {(detectedColor || isDetecting) && (
              <View style={styles.resultOverlay}>
                {detectedColor && !isDetecting ? (
                  <Text style={styles.captionText}>{detectedColor}</Text>
                ) : isDetecting ? (
                  <Text style={styles.captionText}>Processing...</Text>
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
