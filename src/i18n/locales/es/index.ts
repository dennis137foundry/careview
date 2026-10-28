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
import type { TKey } from "../en";

const es: Record<TKey, string> = {
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

export default es;
