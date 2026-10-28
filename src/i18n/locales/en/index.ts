// English: the source text. Every other language is typed against these keys.
import common from "./common";
import nav from "./nav";
import auth from "./auth";
import dashboard from "./dashboard";
import capture from "./capture";
import devices from "./devices";
import history from "./history";
import profile from "./profile";
import modals from "./modals";
import urine from "./urine";
import services from "./services";

const en = {
  ...common,
  ...nav,
  ...auth,
  ...dashboard,
  ...capture,
  ...devices,
  ...history,
  ...profile,
  ...modals,
  ...urine,
  ...services,
};

export type TKey = keyof typeof en;
export default en as Record<TKey, string>;
