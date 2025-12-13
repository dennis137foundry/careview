import { saveUser } from "./sqliteService";

const authService = {
  async sendCode(phone: string): Promise<string> {
    console.log("Sending SMS code to", phone);
    return "1234";
  },

  async verifyCode(phone: string, code: string) {
    if (code === "1234") {
      const user = {
        patientId: "PATIENT123",
        name: "John Doe",
        phone,
      };
      saveUser(user.patientId, user.name, user.phone);
      return user;
    }
    return null;
  },
};

export default authService;
