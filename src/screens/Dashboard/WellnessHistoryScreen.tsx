// src/screens/Dashboard/WellnessHistoryScreen.tsx
//
// "Maternal Wellness Daily" history. Opened by tapping the wellness hero on
// the dashboard. Today's fact sits on top; below it, one card per earlier
// day, newest first, back to day 1 of the pregnancy. Facts are a pure
// function of (EDD, date), so nothing is stored — the list is generated a
// page at a time as the patient scrolls.

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
} from "react-native";
import { useSelector } from "react-redux";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";
import type { RootState } from "../../redux/store";
import {
  getDailyFact,
  getRawDayOfPregnancy,
  type DailyFact,
} from "../../utils/getDailyFact";
import { useStatusBarStyle } from "../../hooks/useStatusBarStyle";
import { BTN } from "../../constants/buttons";

const NAVY = "#002040";
const PAGE_SIZE = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface HistoryItem {
  key: string;
  date: Date;
  daysAgo: number;
  fact: DailyFact;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dateLabel(date: Date, daysAgo: number): string {
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function weekLabel(fact: DailyFact): string {
  return fact.isPostpartum
    ? "After Delivery"
    : `Week ${fact.week} • Day ${fact.dayOfWeek}`;
}

export default function WellnessHistoryScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const edd = useSelector((state: RootState) => state.user.edd);
  useStatusBarStyle("light-content");

  // How many days back the list currently reaches. Grows as the patient
  // scrolls; capped at the first day of the pregnancy.
  const [visibleDays, setVisibleDays] = useState(PAGE_SIZE);

  const today = useMemo(() => startOfToday(), []);

  // Days available = days since pregnancy day 1 (inclusive of today).
  const maxDays = useMemo(() => {
    if (!edd) return 0;
    const raw = getRawDayOfPregnancy(edd, today);
    if (raw === null) return 0;
    return Math.max(1, raw);
  }, [edd, today]);

  const items = useMemo<HistoryItem[]>(() => {
    if (!edd) return [];
    const count = Math.min(visibleDays, maxDays);
    const out: HistoryItem[] = [];
    for (let daysAgo = 0; daysAgo < count; daysAgo++) {
      const date = new Date(today.getTime() - daysAgo * MS_PER_DAY);
      const fact = getDailyFact(edd, date);
      if (!fact) break;
      out.push({ key: String(daysAgo), date, daysAgo, fact });
    }
    return out;
  }, [edd, visibleDays, maxDays, today]);

  const hasMore = items.length < maxDays;

  const loadMore = useCallback(() => {
    if (!hasMore) return;
    setVisibleDays((n) => Math.min(n + PAGE_SIZE, maxDays));
  }, [hasMore, maxDays]);

  const renderItem = useCallback(({ item }: { item: HistoryItem }) => {
    const isToday = item.daysAgo === 0;
    return (
      <View style={[styles.card, isToday && styles.cardToday]}>
        <View style={styles.cardMeta}>
          <Text style={[styles.cardDate, isToday && styles.cardDateToday]}>
            {dateLabel(item.date, item.daysAgo)}
          </Text>
          <View style={[styles.weekPill, isToday && styles.weekPillToday]}>
            <Text style={[styles.weekPillText, isToday && styles.weekPillTextToday]}>
              {weekLabel(item.fact)}
            </Text>
          </View>
        </View>
        <Text style={[styles.cardFact, isToday && styles.cardFactToday]}>
          {item.fact.fact}
        </Text>
      </View>
    );
  }, []);

  return (
    <View style={styles.root}>
      {/* Header with back button. The app-wide navy CareView banner above
          already consumes the safe-area top, so no inset is added here. */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="arrow-back" size={22} color="#fff" />
          <Text style={styles.backText}>Home</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Maternal Wellness Daily
        </Text>
      </View>

      {!edd ? (
        <View style={styles.empty}>
          <MaterialIcons name="event-note" size={48} color="#b7c2d0" />
          <Text style={styles.emptyTitle}>No due date yet</Text>
          <Text style={styles.emptyText}>
            Add your due date on the home screen and your daily facts will
            line up with your pregnancy.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 24 },
          ]}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            hasMore ? (
              <Text style={styles.footerNote}>Loading earlier days…</Text>
            ) : items.length > 0 ? (
              <Text style={styles.footerNote}>
                That's the first day of your pregnancy.
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#eef3f9",
  },
  header: {
    backgroundColor: NAVY,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 14,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingRight: 8,
  },
  backText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginTop: 4,
    paddingHorizontal: 6,
  },
  list: {
    padding: 18,
    gap: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e7ecf2",
    padding: 16,
  },
  cardToday: {
    backgroundColor: "#00325f",
    borderColor: "#00325f",
    borderLeftWidth: 4,
    borderLeftColor: BTN.primary,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  cardDate: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#5b6b7f",
  },
  cardDateToday: {
    color: "#9dc2ec",
  },
  weekPill: {
    backgroundColor: "#eef2f6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  weekPillToday: {
    backgroundColor: "rgba(5, 110, 120, 0.45)",
  },
  weekPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#5b6b7f",
    letterSpacing: 0.3,
  },
  weekPillTextToday: {
    color: "#9fdce2",
  },
  cardFact: {
    fontSize: 15,
    lineHeight: 22,
    color: "#0f1b2d",
  },
  cardFactToday: {
    fontSize: 16,
    lineHeight: 23,
    color: "#eaf2fb",
    fontWeight: "500",
  },
  footerNote: {
    textAlign: "center",
    color: "#8a97a6",
    fontSize: 13,
    paddingVertical: 16,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: NAVY,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#5b6b7f",
    textAlign: "center",
  },
});
