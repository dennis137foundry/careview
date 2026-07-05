// src/components/DueDateForm.tsx
// Inline due-date entry rendered inside the Dashboard navy hero card when
// no EDD is known. Fallback path only — an EMR-provided EDD (login or the
// daily profile refresh) bypasses and later overwrites whatever is
// entered here. Built with a plain Modal list picker so no native
// date-picker dependency is needed.

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
} from "react-native";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// A due date can reasonably be a bit in the past (overdue / postpartum
// signup) or up to ~10 months out.
const MIN_PAST_DAYS = 56; // 8 weeks past due
const MAX_FUTURE_DAYS = 300;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type Field = "month" | "day" | "year" | null;

interface Props {
  /** Called with the chosen date as "YYYY-MM-DD". */
  onSave: (edd: string) => void;
}

export default function DueDateForm({ onSave }: Props) {
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  const [month, setMonth] = useState<number | null>(null); // 0-based
  const [day, setDay] = useState<number | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [openField, setOpenField] = useState<Field>(null);
  const [error, setError] = useState<string | null>(null);

  const daysInMonth =
    month !== null && year !== null
      ? new Date(year, month + 1, 0).getDate()
      : 31;
  const dayOptions = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const handleSave = () => {
    if (month === null || day === null || year === null) return;

    // A day picked before the month can exceed that month's length.
    if (day > new Date(year, month + 1, 0).getDate()) {
      setError("That day doesn't exist in the chosen month.");
      return;
    }

    const chosen = new Date(year, month, day);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((chosen.getTime() - today.getTime()) / MS_PER_DAY);

    if (diffDays < -MIN_PAST_DAYS || diffDays > MAX_FUTURE_DAYS) {
      setError("Please double-check the date — it doesn't look like a due date for this pregnancy.");
      return;
    }

    setError(null);
    const mm = String(month + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    onSave(`${year}-${mm}-${dd}`);
  };

  const fieldLabel = (field: Exclude<Field, null>): string => {
    if (field === "month") return month !== null ? MONTHS[month] : "Month";
    if (field === "day") return day !== null ? String(day) : "Day";
    return year !== null ? String(year) : "Year";
  };

  const options: Array<string | number> =
    openField === "month" ? MONTHS : openField === "day" ? dayOptions : years;

  const handlePick = (index: number) => {
    if (openField === "month") setMonth(index);
    else if (openField === "day") setDay(dayOptions[index]);
    else if (openField === "year") setYear(years[index]);
    setError(null);
    setOpenField(null);
  };

  const complete = month !== null && day !== null && year !== null;

  return (
    <View>
      <Text style={styles.title}>To get started, enter your due date</Text>
      <Text style={styles.subtitle}>
        Your daily facts will match where you are in your pregnancy.
      </Text>

      <View style={styles.row}>
        {(["month", "day", "year"] as const).map((field) => (
          <TouchableOpacity
            key={field}
            style={[styles.field, field === "month" && styles.fieldWide]}
            onPress={() => setOpenField(field)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.fieldText,
                ((field === "month" && month === null) ||
                  (field === "day" && day === null) ||
                  (field === "year" && year === null)) &&
                  styles.fieldPlaceholder,
              ]}
            >
              {fieldLabel(field)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.saveBtn, !complete && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={!complete}
        activeOpacity={0.8}
      >
        <Text style={styles.saveBtnText}>Show My Daily Facts</Text>
      </TouchableOpacity>

      <Modal
        visible={openField !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenField(null)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpenField(null)}
        >
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {openField === "month"
                ? "Select month"
                : openField === "day"
                ? "Select day"
                : "Select year"}
            </Text>
            <FlatList
              data={options}
              keyExtractor={(item) => String(item)}
              style={styles.sheetList}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => handlePick(index)}
                >
                  <Text style={styles.optionText}>{String(item)}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: "#9dc2ec",
    marginBottom: 14,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  field: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  fieldWide: {
    flex: 1.6,
  },
  fieldText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  fieldPlaceholder: {
    color: "#9dc2ec",
    fontWeight: "500",
  },
  error: {
    fontSize: 13,
    color: "#ffcdd2",
    marginBottom: 10,
  },
  saveBtn: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#002040",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingVertical: 12,
    maxHeight: 420,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f1b2d",
    textAlign: "center",
    paddingVertical: 8,
  },
  sheetList: {
    paddingHorizontal: 8,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  optionText: {
    fontSize: 16,
    color: "#0f1b2d",
    textAlign: "center",
  },
});
