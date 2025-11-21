/**
 * Main application component
 * Sets up navigation, camera context, and gesture handling
 */

import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Detect from "./screens/Detect";
import Describe from "./screens/Describe";
import Color from "./screens/Color";
import { CameraProvider, useCameraContext } from "./contexts/CameraContext";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import React, { useRef, useEffect } from "react";
import { speakText, cancelSpeakText } from "./services/huggingfaceApi";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from '@expo/vector-icons';

// Create tab navigator
const Tab = createBottomTabNavigator();

/**
 * Tutorial prompt component
 * Displays a text prompt for accessing the tutorial
 */
function TutorialPrompt() {
  return (
    <View style={styles.tutorialPrompt}>
      <Text style={styles.tutorialPromptText}>Swipe up for tutorial</Text>
    </View>
  );
}

/**
 * Custom tab bar component
 * Handles navigation and tutorial state
 * Provides visual feedback for active tab
 */
function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { isTutorialActive } = useCameraContext();

  return (
    <View style={styles.tabBar}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = typeof options.tabBarLabel === 'string' 
          ? options.tabBarLabel 
          : options.title || route.name;
        const isFocused = state.index === index;

        // Map route names to icon names
        let iconName = '';
        if (route.name === 'Detect') {
          iconName = isFocused ? 'scan' : 'scan-outline';
        } else if (route.name === 'Describe') {
          iconName = isFocused ? 'eye' : 'eye-outline';
        } else if (route.name === 'Color') {
          iconName = isFocused ? 'color-palette' : 'color-palette-outline';
        }

        // Handle tab press with tutorial state check
        const onPress = () => {
          if (isTutorialActive) {
            return; // Disable navigation during tutorial
          }

          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={onPress}
            style={styles.tabItem}
            disabled={isTutorialActive}
          >
            <Ionicons 
              name={iconName as any} 
              size={24} 
              color={isFocused ? '#00BFFF' : 'gray'} 
            />
            <Text style={[
              styles.tabLabel,
              isFocused ? styles.tabLabelActive : styles.tabLabelInactive
            ]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * Tab navigator component with audio feedback
 * Manages navigation state and mode announcements
 */
function TabNavigator() {
  const { isTutorialActive } = useCameraContext();
  const audioQueueRef = useRef<(() => Promise<void>)[]>([]);
  const isPlayingAudioRef = useRef(false);
  const hasAnnouncedTutorialRef = useRef(false);
  const isInitialMountRef = useRef(true);

  // Announce initial mode and tutorial prompt on mount
  useEffect(() => {
    if (!hasAnnouncedTutorialRef.current) {
      queueAudio(async () => {
        await speakText("Detect");
        await new Promise(resolve => setTimeout(resolve, 500)); // Small pause between announcements
        await speakText("Swipe up for tutorial");
      });
      hasAnnouncedTutorialRef.current = true;
    }
  }, []);

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

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        tabBar={props => (
          <View>
            <TutorialPrompt />
            <CustomTabBar {...props} />
          </View>
        )}
        screenOptions={{
          headerShown: false,
        }}
        screenListeners={{
          state: (e) => {
            // Prevent navigation during tutorial
            if (isTutorialActive) {
              return;
            }
            
            // Skip the initial mode announcement since we handle it in useEffect
            if (isInitialMountRef.current) {
              isInitialMountRef.current = false;
              return;
            }
            
            // Handle navigation state changes
            cancelSpeakText();
            const currentRoute = e.data.state.routes[e.data.state.index];
            const routeName = currentRoute.name;

            // Announce mode change (without tutorial prompt)
            queueAudio(async () => {
              await speakText(routeName);
            });
          },
        }}
      >
        <Tab.Screen name="Detect" component={Detect} />
        <Tab.Screen name="Describe" component={Describe} />
        <Tab.Screen name="Color" component={Color} />
      </Tab.Navigator>
    </View>
  );
}

// Tab bar styles
const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'black',
    borderTopColor: 'black',
    height: 100,
    paddingBottom: 20,
  },
  tabItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 4,
  },
  tabLabelActive: {
    color: '#00BFFF',
  },
  tabLabelInactive: {
    color: 'gray',
  },
  tutorialPrompt: {
    position: 'absolute',
    bottom: 120, // Increased space above tab bar
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1,
  },
  tutorialPromptText: {
    color: 'rgba(255, 255, 255, 0.7)', // Semi-transparent white
    fontSize: 12, // Smaller font size
    fontFamily: 'System', // System font for a clean look
    fontWeight: '300', // Lighter font weight
    letterSpacing: 0.5, // Slight letter spacing for elegance
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0.5, height: 0.5 },
    textShadowRadius: 1,
  },
});

/**
 * Root application component
 * Wraps the application with necessary providers
 */
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <CameraProvider>
        <NavigationContainer>
          <TabNavigator />
        </NavigationContainer>
      </CameraProvider>
    </GestureHandlerRootView>
  );
}
