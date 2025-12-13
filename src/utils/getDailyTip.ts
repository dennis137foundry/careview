// src/utils/getDailyTip.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { pregnancyTips } from "../constants/pregnancyTips";

const TIPS_KEY = "daily_tip_index";
const DATE_KEY = "daily_tip_date";

function cleanTip(tip: string) {
  return tip.replace(/^Day\s*\d+:\s*/i, "").trim();
}

export async function getDailyTip(): Promise<string> {
  try {
    const today = new Date().toDateString();
    const storedDate = await AsyncStorage.getItem(DATE_KEY);
    let index = 0;

    if (storedDate === today) {
      const savedIndex = await AsyncStorage.getItem(TIPS_KEY);
      if (savedIndex !== null) {
        index = parseInt(savedIndex, 10);
        return cleanTip(pregnancyTips[index]);
      }
    }

    const prevIndex = parseInt((await AsyncStorage.getItem(TIPS_KEY)) || "0", 10);
    index = (prevIndex + 1) % pregnancyTips.length;

    await AsyncStorage.setItem(TIPS_KEY, index.toString());
    await AsyncStorage.setItem(DATE_KEY, today);

    return cleanTip(pregnancyTips[index]);
  } catch {
    return cleanTip(pregnancyTips[0]);
  }
}
