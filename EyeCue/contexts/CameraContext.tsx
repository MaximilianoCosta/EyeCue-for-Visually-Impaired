/**
 * Camera context provider for managing camera state and tutorial functionality
 * Handles camera orientation, audio feedback, and tutorial state across the application
 */

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { CameraType } from "expo-camera";
import { speakText, cancelSpeakText } from "../services/huggingfaceApi";

/**
 * Type definition for camera context
 * Provides camera orientation, tutorial state, and control functions
 */
type CameraContextType = {
  facing: CameraType;
  setFacing: (facing: CameraType | ((prev: CameraType) => CameraType)) => void;
  isTutorialActive: boolean;
  startTutorial: () => Promise<void>;
  tutorialText: string;
};

// Create context with initial null value
const CameraContext = createContext<CameraContextType | null>(null);

/**
 * Camera context provider component
 * Manages camera state and tutorial functionality for child components
 */
export const CameraProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Camera state management
  const [facing, _setFacing] = useState<CameraType>("back");
  const [hasFlippedOnce, setHasFlippedOnce] = useState(false);
  const [isTutorialActive, setIsTutorialActive] = useState(false);

  // Audio queue management
  const audioQueueRef = useRef<(() => Promise<void>)[]>([]);
  const isPlayingAudioRef = useRef(false);
  const tutorialInProgressRef = useRef(false);

  // Tutorial content
  const tutorialText = "Welcome to the EyeCue application! You can swipe left or right to switch between modes. To capture an image, simply double tap anywhere on the screen. In Color mode, the application will automatically capture an image every second to identify colors. To ask a question, first use the describe mode to receive a scene description, then long tap to record your voice and ask your question. To switch between the front and back camera, swipe down.";

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
   * Starts the application tutorial
   * Handles audio feedback and state management
   */
  const startTutorial = async () => {
    if (isTutorialActive || tutorialInProgressRef.current) return;
    
    tutorialInProgressRef.current = true;
    setIsTutorialActive(true);
    
    try {
      // Cancel any ongoing speech
      await cancelSpeakText();
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Play tutorial audio sequence
      await speakText("Tutorial ON");
      await new Promise(resolve => setTimeout(resolve, 200));
      await speakText(tutorialText);
      await new Promise(resolve => setTimeout(resolve, 200));
      await speakText("Tutorial OFF");
    } catch (error) {
      console.warn("Tutorial speech error:", error);
    } finally {
      tutorialInProgressRef.current = false;
      setIsTutorialActive(false);
    }
  };

  /**
   * Updates camera orientation and provides audio feedback
   * Only announces changes after initial setup
   */
  const setFacing = (
    value: CameraType | ((prev: CameraType) => CameraType)
  ) => {
    const newFacing = typeof value === "function" ? value(facing) : value;
    _setFacing(newFacing);
    
    // Announce camera change after initial setup
    if (hasFlippedOnce) {
      queueAudio(async () => {
        await speakText(`Camera ${newFacing === "front" ? "Front" : "Back"}`);
      });
    }
  };

  // Initialize camera orientation on mount
  useEffect(() => {
    let timeout1: ReturnType<typeof setTimeout>;
    let timeout2: ReturnType<typeof setTimeout>;

    if (!hasFlippedOnce) {
      // Brief camera orientation sequence
      timeout1 = setTimeout(() => {
        _setFacing("front");
        timeout2 = setTimeout(() => {
          _setFacing("back");
          setHasFlippedOnce(true);
        }, 300);
      }, 100);
    }

    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
    };
  }, [hasFlippedOnce]);

  return (
    <CameraContext.Provider value={{ facing, setFacing, isTutorialActive, startTutorial, tutorialText }}>
      {children}
    </CameraContext.Provider>
  );
};

/**
 * Hook for accessing camera context
 * @throws Error if used outside of CameraProvider
 */
export const useCameraContext = (): CameraContextType => {
  const context = useContext(CameraContext);
  if (!context)
    throw new Error("useCameraContext must be used within CameraProvider");
  return context;
};
