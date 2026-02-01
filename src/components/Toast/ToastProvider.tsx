import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

// =============================================================================
// Types
// =============================================================================
type ToastType = "success" | "error" | "warning" | "info";

interface ToastConfig {
  message: string;
  type?: ToastType;
  duration?: number;
  action?: {
    label: string;
    onPress: () => void;
  };
}

interface ToastContextValue {
  showToast: (config: ToastConfig | string) => void;
  hideToast: () => void;
}

// =============================================================================
// Context
// =============================================================================
const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

// =============================================================================
// Theme
// =============================================================================
const toastThemes: Record<ToastType, { bg: string; icon: string; iconColor: string }> = {
  success: {
    bg: "#1B5E20",
    icon: "check-circle",
    iconColor: "#81C784",
  },
  error: {
    bg: "#B71C1C",
    icon: "error",
    iconColor: "#EF9A9A",
  },
  warning: {
    bg: "#E65100",
    icon: "warning",
    iconColor: "#FFB74D",
  },
  info: {
    bg: "#0D47A1",
    icon: "info",
    iconColor: "#90CAF9",
  },
};

// =============================================================================
// Provider
// =============================================================================
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<ToastConfig>({ message: "" });
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
    });
  }, [translateY, opacity]);

  const showToast = useCallback(
    (input: ToastConfig | string) => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Normalize input
      const newConfig: ToastConfig =
        typeof input === "string"
          ? { message: input, type: "info", duration: 3000 }
          : { type: "info", duration: 3000, ...input };

      setConfig(newConfig);
      setVisible(true);

      // Animate in
      translateY.setValue(-100);
      opacity.setValue(0);

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-hide after duration
      timeoutRef.current = setTimeout(() => {
        hideToast();
      }, newConfig.duration);
    },
    [translateY, opacity, hideToast]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const theme = toastThemes[config.type || "info"];

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {visible && (
        <Animated.View
          style={[
            styles.container,
            {
              top: insets.top + 10,
              backgroundColor: theme.bg,
              transform: [{ translateY }],
              opacity,
            },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={styles.content}
            onPress={hideToast}
            activeOpacity={0.9}
          >
            <MaterialIcons
              name={theme.icon}
              size={22}
              color={theme.iconColor}
              style={styles.icon}
            />
            <Text style={styles.message} numberOfLines={2}>
              {config.message}
            </Text>
            {config.action && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => {
                  config.action?.onPress();
                  hideToast();
                }}
              >
                <Text style={styles.actionText}>{config.action.label}</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

// =============================================================================
// Styles
// =============================================================================
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  icon: {
    marginRight: 12,
  },
  message: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: "#fff",
    lineHeight: 20,
  },
  actionButton: {
    marginLeft: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 6,
  },
  actionText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
});

export default ToastProvider;