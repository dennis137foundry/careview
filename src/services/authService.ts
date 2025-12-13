// src/services/authService.ts
import { saveUser, LocalUser } from "./sqliteService";

const API_BASE = "https://trinityemr.com/api/careviewapp";

const authService = {
  /**
   * Send verification code via SMS
   * Returns true on success, false on failure
   */
  async sendCode(phone: string): Promise<boolean> {
    try {
      console.log("[Auth] Sending code to:", phone);

      const response = await fetch(`${API_BASE}/send_code.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone }),
      });

      const data = await response.json();
      console.log("[Auth] send_code response:", data);

      if (data.success) {
        return true;
      }

      // Handle specific errors
      if (data.error === "not_found") {
        throw new Error("Phone number not registered. Please contact your provider.");
      }
      if (data.error === "sms_failed") {
        throw new Error("Failed to send SMS. Please try again.");
      }

      throw new Error(data.error || "Failed to send code");
    } catch (e: any) {
      console.error("[Auth] sendCode error:", e);
      throw e;
    }
  },

  /**
   * Verify the 6-digit code
   * Returns LocalUser on success, null on failure
   */
  async verifyCode(phone: string, code: string): Promise<LocalUser | null> {
    try {
      console.log("[Auth] Verifying code for:", phone);

      const response = await fetch(`${API_BASE}/verify_code.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone, code }),
      });

      const data = await response.json();
      console.log("[Auth] verify_code response:", data);

      if (!data.success) {
        if (data.error === "invalid_or_expired_code") {
          throw new Error("Invalid or expired code. Please try again.");
        }
        if (data.error === "patient_not_found") {
          throw new Error("Patient record not found.");
        }
        throw new Error(data.error || "Verification failed");
      }

      // Build LocalUser from response
      const user: LocalUser = {
        patientId: String(data.patient.patientId),
        firstName: data.patient.firstName || "",
        lastName: data.patient.lastName || "",
        phone: data.patient.phone || phone,
        providerFirstName: data.provider?.firstName || "",
        providerLastName: data.provider?.lastName || "",
        providerPracticeName: data.provider?.practiceName || "",
      };

      // Persist to SQLite
      saveUser(user);
      console.log("[Auth] User saved to SQLite:", user.patientId);

      return user;
    } catch (e: any) {
      console.error("[Auth] verifyCode error:", e);
      throw e;
    }
  },
};

export default authService;