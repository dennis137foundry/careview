/* eslint-disable react-native/no-inline-styles */
import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
  Animated,
  Easing,
  Dimensions,
  StatusBar,
} from "react-native";
import LinearGradient from "react-native-linear-gradient";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import { useSelector, useDispatch } from "react-redux";
import { addReadingAndPersist } from "../../redux/readingSlice";
import { NativeModules, NativeEventEmitter } from "react-native";
import type { RootState, AppDispatch } from "../../redux/store";
import type { DeviceRecord } from "../../services/sqliteService";

const { IHealthDevices } = NativeModules;
const emitter = IHealthDevices ? new NativeEventEmitter(IHealthDevices) : null;
const { width: SCREEN_WIDTH } = Dimensions.get("window");

const deviceImages: Record<string, any> = {
  BP: require("../../assets/bp3l.png"),
  SCALE: require("../../assets/hs5s.png"),
  BG: require("../../assets/bg5.png"),
};

// Theme colors per device type
const deviceThemes: Record<string, { primary: string; secondary: string; gradient: string[]; icon: string }> = {
  BP: {
    primary: "#E53935",
    secondary: "#FF8A80",
    gradient: ["#E53935", "#C62828", "#B71C1C"],
    icon: "favorite",
  },
  SCALE: {
    primary: "#00ACC1",
    secondary: "#84FFFF",
    gradient: ["#00ACC1", "#0097A7", "#00838F"],
    icon: "fitness-center",
  },
  BG: {
    primary: "#43A047",
    secondary: "#B9F6CA",
    gradient: ["#43A047", "#388E3C", "#2E7D32"],
    icon: "water-drop",
  },
};

export default function CaptureScreen({ route, navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { deviceId } = route.params ?? {};

  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'auth' | 'scan' | 'connect' | 'measure' | 'success'>('idle');
  const [statusText, setStatusText] = useState<string>("");
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [lastReading, setLastReading] = useState<any>(null);
  const scrollRef = useRef<ScrollView>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetMacRef = useRef<string>("");

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const ringRotate = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const waveAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const devices = useSelector((state: RootState) => state.devices.devices);
  const device: DeviceRecord | undefined = useMemo(
    () => devices.find((d) => d.id === deviceId),
    [devices, deviceId]
  );

  const theme = deviceThemes[device?.type || 'BP'];

  const addLog = useCallback((msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev.slice(-100), `[${timestamp}] ${msg}`]);
    console.log(`[Capture] ${msg}`);
  }, []);

  // Entry animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pulse animation when busy
  useEffect(() => {
    if (busy && phase !== 'success') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [busy, phase, pulseAnim]);

  // Ring rotation animation
  useEffect(() => {
    if (busy && phase !== 'success') {
      const rotate = Animated.loop(
        Animated.timing(ringRotate, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      rotate.start();
      return () => rotate.stop();
    } else {
      ringRotate.setValue(0);
    }
  }, [busy, phase, ringRotate]);

  // Wave animation for measuring phase
  useEffect(() => {
    if (phase === 'measure') {
      const wave = Animated.loop(
        Animated.timing(waveAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      wave.start();
      return () => wave.stop();
    }
  }, [phase, waveAnim]);

  // Progress animation
  useEffect(() => {
    if (busy) {
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 90000, // 90 seconds timeout
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();
    } else {
      progressAnim.setValue(0);
    }
  }, [busy, progressAnim]);

  // Success animation
  const playSuccessAnimation = useCallback(() => {
    setPhase('success');
    Animated.spring(successScale, {
      toValue: 1,
      friction: 4,
      tension: 50,
      useNativeDriver: true,
    }).start();
  }, [successScale]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      IHealthDevices?.stopScan?.().catch(() => {});
    };
  }, []);

  // Listen for native debug logs
  useEffect(() => {
    if (!emitter) return;
    const sub = emitter.addListener('onDebugLog', (data: any) => {
      addLog(`[Native] ${data.message}`);
    });
    return () => sub.remove();
  }, [addLog]);

  // Listen for device discovery
  useEffect(() => {
    if (!emitter) return;
    const sub = emitter.addListener('onDeviceFound', async (data: any) => {
      addLog(`[Found] ${data.name} (${data.type}) MAC=${data.mac}`);
      
      const targetMac = targetMacRef.current;
      if (targetMac && data.mac && 
          data.mac.toUpperCase() === targetMac.toUpperCase()) {
        addLog(`🎯 TARGET DEVICE FOUND! Connecting...`);
        setPhase('connect');
        setStatusText("Found you! Connecting...");
        
        try {
          await IHealthDevices.stopScan();
          const result = await IHealthDevices.connectDevice(data.mac, data.type);
          addLog(`Connect initiated: ${result}`);
        } catch (e: any) {
          addLog(`Connect error: ${e.message}`);
        }
      }
    });
    return () => sub.remove();
  }, [addLog]);

  // Listen for connection state
  useEffect(() => {
    if (!emitter) return;
    const sub = emitter.addListener('onConnectionStateChanged', (data: any) => {
      addLog(`[Connection] ${data.mac} connected=${data.connected} type=${data.type}`);
      
      if (data.connected) {
        setPhase('measure');
        if (device?.type === 'SCALE') {
          setStatusText("Step on the scale");
        } else if (device?.type === 'BG') {
          setStatusText("Insert test strip");
        } else {
          setStatusText("Keep still, measuring...");
        }
      } else if (busy) {
        addLog("Device disconnected!");
        setStatusText("Disconnected");
      }
    });
    return () => sub.remove();
  }, [addLog, device, busy]);

  // Save functions defined before the listener useEffect
  const saveBPReading = useCallback((data: any) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dispatch(addReadingAndPersist({
      type: 'BP',
      deviceId: device?.id || '',
      deviceName: device?.name || 'BP Monitor',
      value: data.systolic,
      value2: data.diastolic,
      heartRate: data.pulse,
      unit: 'mmHg',
    }));
    setLastReading({ systolic: data.systolic, diastolic: data.diastolic, pulse: data.pulse });
    setStatusText(`${data.systolic}/${data.diastolic}`);
    setBusy(false);
    playSuccessAnimation();
  }, [device, dispatch, playSuccessAnimation]);

  const saveWeightReading = useCallback((data: any) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const kg = parseFloat(data.weight) || 0;
    const lbs = Math.round(kg * 2.20462 * 10) / 10;
    dispatch(addReadingAndPersist({
      type: 'SCALE',
      deviceId: device?.id || '',
      deviceName: device?.name || 'Scale',
      value: lbs,
      unit: 'lbs',
    }));
    setLastReading({ weight: lbs, kg });
    setStatusText(`${lbs} lbs`);
    setBusy(false);
    playSuccessAnimation();
  }, [device, dispatch, playSuccessAnimation]);

  const saveGlucoseReading = useCallback((data: any) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dispatch(addReadingAndPersist({
      type: 'BG',
      deviceId: device?.id || '',
      deviceName: device?.name || 'Glucose Meter',
      value: data.value,
      unit: data.unit || 'mg/dL',
    }));
    setLastReading({ value: data.value, unit: data.unit || 'mg/dL' });
    setStatusText(`${data.value}`);
    setBusy(false);
    playSuccessAnimation();
  }, [device, dispatch, playSuccessAnimation]);

  // Listen for readings
  useEffect(() => {
    if (!emitter) return;
    
    const subs = [
      emitter.addListener('onBloodPressureReading', (data: any) => {
        addLog(`🎉 BP: ${data.systolic}/${data.diastolic} pulse=${data.pulse}`);
        saveBPReading(data);
      }),
      emitter.addListener('onWeightReading', (data: any) => {
        addLog(`🎉 Weight: ${data.weight} ${data.unit}`);
        saveWeightReading(data);
      }),
      emitter.addListener('onBloodGlucoseReading', (data: any) => {
        addLog(`🎉 Glucose: ${data.value} ${data.unit}`);
        saveGlucoseReading(data);
      }),
      emitter.addListener('onError', (data: any) => {
        addLog(`❌ Error: ${data.message || JSON.stringify(data)}`);
      }),
    ];
    
    return () => subs.forEach(s => s.remove());
  }, [addLog, saveBPReading, saveWeightReading, saveGlucoseReading]);

  const start = useCallback(async () => {
    if (!device) {
      Alert.alert("Error", "Device not found");
      return;
    }
    if (!IHealthDevices || !emitter) {
      Alert.alert("Error", "Native module not available");
      return;
    }

    setDebugLogs([]);
    setBusy(true);
    setLastReading(null);
    successScale.setValue(0);
    
    const mac = device.mac || device.id;
    targetMacRef.current = mac;
    addLog(`Starting for ${device.name}, MAC: ${mac}`);

    setPhase('auth');
    setStatusText("Initializing...");
    
    try {
      addLog("Authenticating SDK...");
      await IHealthDevices.authenticate('license.pem');
      addLog("✅ Authenticated");
    } catch (e: any) {
      addLog(`Auth note: ${e.message}`);
    }

    setPhase('scan');
    if (device.type === 'SCALE') {
      setStatusText("Step on scale to wake it");
    } else if (device.type === 'BG') {
      setStatusText("Turn on your meter");
    } else {
      setStatusText("Press start on device");
    }

    try {
      addLog("Starting scan for all device types...");
      await IHealthDevices.startScan(['BP3L', 'BP5', 'BP5S', 'BG5', 'BG5S', 'HS2S', 'HS2', 'HS4S']);
      addLog("✅ Scan started");
    } catch (e: any) {
      addLog(`Scan error: ${e.message}`);
      Alert.alert("Scan Error", e.message);
      setBusy(false);
      setPhase('idle');
      return;
    }

    timeoutRef.current = setTimeout(() => {
      addLog("⏰ Timeout - no reading received");
      IHealthDevices.stopScan?.().catch(() => {});
      setBusy(false);
      setPhase('idle');
      setStatusText("");
      Alert.alert("Timeout", "No reading received. Make sure device is awake and try again.");
    }, 90000);

  }, [device, addLog, successScale]);

  const cancel = useCallback(async () => {
    addLog("Cancelled by user");
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    targetMacRef.current = "";
    try {
      await IHealthDevices?.stopScan?.();
      await IHealthDevices?.disconnectAll?.();
    } catch (e) {}
    setBusy(false);
    setPhase('idle');
    setStatusText("");
  }, [addLog]);

  const done = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  if (!device) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={['#1a1a2e', '#16213e']} style={StyleSheet.absoluteFill} />
        <Text style={styles.errorText}>Device not found</Text>
        <TouchableOpacity style={styles.backButtonAlt} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const ringInterpolate = ringRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const getPhaseMessage = () => {
    switch (phase) {
      case 'auth': return 'Initializing...';
      case 'scan': 
        if (device.type === 'SCALE') return '👆 Step on scale to wake it';
        if (device.type === 'BG') return '👆 Turn on your meter';
        return '👆 Press start on your device';
      case 'connect': return '🔗 Connecting...';
      case 'measure':
        if (device.type === 'SCALE') return '🦶 Hold still...';
        if (device.type === 'BG') return '🩸 Apply blood sample';
        return '💪 Keep arm relaxed...';
      case 'success': return '✨ Reading saved!';
      default: return 'Ready to measure';
    }
  };

  const renderReadingDisplay = () => {
    if (phase === 'success' && lastReading) {
      if (device.type === 'BP') {
        return (
          <Animated.View style={[styles.readingContainer, { transform: [{ scale: successScale }] }]}>
            <View style={styles.bpReading}>
              <Text style={styles.bpValue}>{lastReading.systolic}</Text>
              <Text style={styles.bpSeparator}>/</Text>
              <Text style={styles.bpValue}>{lastReading.diastolic}</Text>
            </View>
            <Text style={styles.readingUnit}>mmHg</Text>
            <View style={styles.pulseContainer}>
              <MaterialIcons name="favorite" size={18} color={theme.secondary} />
              <Text style={styles.pulseText}>{lastReading.pulse} bpm</Text>
            </View>
          </Animated.View>
        );
      } else if (device.type === 'SCALE') {
        return (
          <Animated.View style={[styles.readingContainer, { transform: [{ scale: successScale }] }]}>
            <Text style={styles.weightValue}>{lastReading.weight}</Text>
            <Text style={styles.readingUnit}>lbs</Text>
            <Text style={styles.subReading}>{lastReading.kg} kg</Text>
          </Animated.View>
        );
      } else if (device.type === 'BG') {
        return (
          <Animated.View style={[styles.readingContainer, { transform: [{ scale: successScale }] }]}>
            <Text style={styles.glucoseValue}>{lastReading.value}</Text>
            <Text style={styles.readingUnit}>{lastReading.unit}</Text>
          </Animated.View>
        );
      }
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient 
        colors={['#1a1a2e', '#16213e', '#0f0f23']} 
        style={StyleSheet.absoluteFill} 
      />
      
      {/* Header */}
      <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Capture Reading</Text>
        <TouchableOpacity onPress={() => setShowDebug(!showDebug)} style={styles.debugBtn}>
          <MaterialIcons name="bug-report" size={22} color={showDebug ? theme.primary : "#666"} />
        </TouchableOpacity>
      </Animated.View>

      {/* Main Content */}
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
          
          {/* Device Visual */}
          <View style={styles.deviceSection}>
            <Animated.View style={[
              styles.deviceRing,
              { 
                borderColor: theme.primary,
                transform: [
                  { scale: pulseAnim },
                  { rotate: busy && phase !== 'success' ? ringInterpolate : '0deg' }
                ] 
              }
            ]}>
              {busy && phase !== 'success' && (
                <>
                  <View style={[styles.ringDot, styles.ringDot1, { backgroundColor: theme.primary }]} />
                  <View style={[styles.ringDot, styles.ringDot2, { backgroundColor: theme.secondary }]} />
                </>
              )}
            </Animated.View>
            
            <View style={styles.deviceImageContainer}>
              <Image source={deviceImages[device.type]} style={styles.deviceImage} />
              {phase === 'success' && (
                <View style={[styles.successBadge, { backgroundColor: theme.primary }]}>
                  <MaterialIcons name="check" size={24} color="#fff" />
                </View>
              )}
            </View>
          </View>

          {/* Device Info */}
          <Text style={styles.deviceName}>{device.name}</Text>
          <Text style={styles.deviceType}>
            {device.type === 'BP' ? 'Blood Pressure Monitor' : 
             device.type === 'SCALE' ? 'Smart Scale' : 'Glucose Meter'}
          </Text>

          {/* Reading Display or Status */}
          {phase === 'success' && lastReading ? (
            renderReadingDisplay()
          ) : (
            <View style={styles.statusSection}>
              {busy && (
                <View style={styles.waveContainer}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.waveLine,
                        { backgroundColor: theme.primary },
                        {
                          transform: [{
                            scaleY: waveAnim.interpolate({
                              inputRange: [0, 0.5, 1],
                              outputRange: [
                                0.3 + Math.sin(i * 0.8) * 0.3,
                                0.8 + Math.cos(i * 0.5) * 0.2,
                                0.3 + Math.sin(i * 0.8) * 0.3,
                              ],
                            }),
                          }],
                        },
                      ]}
                    />
                  ))}
                </View>
              )}
              <Text style={[styles.statusText, { color: busy ? theme.secondary : '#888' }]}>
                {getPhaseMessage()}
              </Text>
              {busy && statusText && (
                <Text style={styles.statusSubtext}>{statusText}</Text>
              )}
            </View>
          )}

          {/* Progress Bar */}
          {busy && phase !== 'success' && (
            <View style={styles.progressContainer}>
              <Animated.View 
                style={[
                  styles.progressBar, 
                  { 
                    backgroundColor: theme.primary,
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  }
                ]} 
              />
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            {phase === 'idle' && (
              <TouchableOpacity 
                style={styles.buttonTouchable}
                onPress={start} 
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={theme.gradient}
                  style={styles.gradientButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <MaterialIcons name="play-arrow" size={28} color="#fff" />
                  <Text style={styles.buttonText}>Start Capture</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
            
            {busy && phase !== 'success' && (
              <TouchableOpacity 
                style={styles.cancelTouchable} 
                onPress={cancel} 
                activeOpacity={0.8}
              >
                <MaterialIcons name="close" size={24} color="#fff" />
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
            
            {phase === 'success' && (
              <TouchableOpacity 
                style={styles.buttonTouchable}
                onPress={done} 
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={theme.gradient}
                  style={styles.gradientButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <MaterialIcons name="check-circle" size={24} color="#fff" />
                  <Text style={styles.buttonText}>Done</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </ScrollView>

      {/* Debug Panel */}
      {showDebug && (
        <View style={styles.debugPanel}>
          <View style={styles.debugHeader}>
            <Text style={styles.debugTitle}>Debug Log</Text>
            <TouchableOpacity onPress={() => setShowDebug(false)}>
              <MaterialIcons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView 
            ref={scrollRef} 
            style={styles.debugScroll}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd()}
          >
            {debugLogs.length === 0 ? (
              <Text style={styles.logLine}>Tap Start to begin...</Text>
            ) : (
              debugLogs.map((log, i) => (
                <Text key={i} style={[
                  styles.logLine,
                  log.includes('🎉') && styles.logSuccess,
                  log.includes('❌') && styles.logError,
                  log.includes('🎯') && styles.logTarget,
                  log.includes('[Native]') && styles.logNative,
                  log.includes('[Found]') && styles.logFound,
                ]}>{log}</Text>
              ))
            )}
          </ScrollView>
          <TouchableOpacity 
            style={styles.copyBtn} 
            onPress={() => Alert.alert("Log", debugLogs.join('\n'))}
          >
            <Text style={styles.copyBtnText}>Copy Log</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: "#1a1a2e",
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  debugBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  deviceSection: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  deviceRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 3,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  ringDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  ringDot1: {
    top: -6,
    left: '50%',
    marginLeft: -6,
  },
  ringDot2: {
    bottom: -6,
    left: '50%',
    marginLeft: -6,
  },
  deviceImageContainer: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceImage: { 
    width: 100, 
    height: 100, 
    resizeMode: "contain",
  },
  successBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#1a1a2e',
  },
  deviceName: { 
    fontSize: 24, 
    fontWeight: "700", 
    color: "#fff",
    marginBottom: 4,
    textAlign: 'center',
  },
  deviceType: { 
    fontSize: 14, 
    color: "#888",
    marginBottom: 32,
    textAlign: 'center',
  },
  statusSection: {
    alignItems: 'center',
    minHeight: 120,
    justifyContent: 'center',
  },
  waveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    marginBottom: 16,
  },
  waveLine: {
    width: 6,
    height: 40,
    borderRadius: 3,
    marginHorizontal: 4,
  },
  statusText: { 
    fontSize: 18, 
    fontWeight: '500',
    textAlign: "center",
    marginBottom: 8,
  },
  statusSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  readingContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  bpReading: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  bpValue: {
    fontSize: 64,
    fontWeight: '300',
    color: '#fff',
  },
  bpSeparator: {
    fontSize: 48,
    fontWeight: '200',
    color: '#666',
    marginHorizontal: 4,
  },
  readingUnit: {
    fontSize: 18,
    color: '#888',
    marginTop: 4,
  },
  pulseContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
  },
  pulseText: {
    fontSize: 16,
    color: '#fff',
    marginLeft: 8,
  },
  weightValue: {
    fontSize: 72,
    fontWeight: '200',
    color: '#fff',
  },
  subReading: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  glucoseValue: {
    fontSize: 72,
    fontWeight: '200',
    color: '#fff',
  },
  progressContainer: {
    width: '80%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginTop: 24,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  buttonContainer: {
    width: '100%',
    marginTop: 40,
    paddingHorizontal: 0,
  },
  buttonTouchable: {
    width: SCREEN_WIDTH - 48,
    alignSelf: 'center',
    borderRadius: 30,
    overflow: 'hidden',
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 32,
    minHeight: 60,
  },
  buttonText: { 
    color: "#fff", 
    fontSize: 18, 
    fontWeight: "600", 
    marginLeft: 10,
  },
  cancelTouchable: {
    width: SCREEN_WIDTH - 48,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 32,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    minHeight: 60,
  },
  cancelText: { 
    color: "#fff", 
    fontSize: 18, 
    fontWeight: "500", 
    marginLeft: 10,
  },
  debugPanel: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.95)",
    padding: 16,
    paddingTop: 60,
  },
  debugHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  debugTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  debugScroll: { flex: 1, marginBottom: 10 },
  logLine: { color: "#0f0", fontFamily: "monospace", fontSize: 11, marginBottom: 3 },
  logSuccess: { color: "#4caf50", fontWeight: "bold" },
  logError: { color: "#f44336" },
  logTarget: { color: "#ffeb3b", fontWeight: "bold" },
  logNative: { color: "#666" },
  logFound: { color: "#03a9f4" },
  copyBtn: { backgroundColor: "#333", padding: 12, borderRadius: 8, alignItems: "center" },
  copyBtnText: { color: "#fff" },
  errorText: { fontSize: 18, color: "#ff5252", textAlign: "center", marginBottom: 20 },
  backButtonAlt: { 
    backgroundColor: "rgba(255,255,255,0.1)", 
    padding: 14, 
    borderRadius: 8, 
    alignItems: "center",
    marginHorizontal: 40,
  },
  backButtonText: { color: "#fff", fontSize: 16 },
});
