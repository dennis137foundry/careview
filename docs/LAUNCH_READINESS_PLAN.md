# Trinity CareView — Launch Readiness Execution Plan

**Status:** Pre-submission. Not ready to ship as-is. This plan closes the gap.
**Last updated:** 2026-04-24

---

## Source Paths

| Area | Path |
|---|---|
| App (React Native) | `C:\Apps\careview` |
| Server API (PHP) | `C:\Users\denni\Dropbox\Business\Websites\trinityemr.com\public_html\api\careviewapp` |
| iOS native module | `C:\Apps\careview\modules\react-native-ihealth-devices\ios` |
| Android native module | `C:\Apps\careview\modules\react-native-ihealth-devices\android` |
| Xcode project | `C:\Apps\careview\ios\cvdemo.xcodeproj\project.pbxproj` |
| Android gradle | `C:\Apps\careview\android\app\build.gradle` |

Every server-side fix below edits files under the **Server API** path. Every app-side fix edits files under the **App** path.

---

## Scope Fence

**In scope for this plan:**
- App code (React Native, TypeScript, native iHealth module — surgical fixes only)
- API PHP files under `C:\Users\denni\Dropbox\Business\Websites\trinityemr.com\public_html\api\careviewapp`
- **New** EMR database tables (e.g., `refresh_tokens` for JWT) — additive only
- One-off EMR schema fixes that unblock API behavior (case-by-case, must be trivial and non-destructive)

**Out of scope:**
- Modifications to existing EMR database tables (adding/dropping/renaming columns on tables already in production use)
- Core EMR application code (non-API PHP, admin UI, authentication flows outside the app's API surface)
- iHealth SDK version alignment — normal per-platform vendor versioning, not a bug
- Non-surgical refactors to `modules/react-native-ihealth-devices/` — working code, months of debugging
- Native module style cleanup / "simplification" — do not touch

---

## Execution Sequence

Nine phases, mostly PR-sized. Phases 1–3 are cheap and high-impact. Phase 4 is the submission blocker. Phase 9 is the biggest (JWT migration) but can begin while earlier phases land.

### Phase Dependencies

```
P1 (SMS auth)  ──────────────── ships independently
P2 (dead URL)  ──────────────── ships independently
P3 (bpThresholds) ─────────────── ships independently
P4 (submission) ─────────────── ships independently (legal blocker)
P5 (SQLite throw) ────────┐
P6 (native fixes) ─────── ├─ all independent, ship as separate PRs
P7 (PHI logs) ─────────── │
P8 (CI green) ─────────── ┘
P9 (JWT) ────────────────────── largest; starts after P1; rotates key at end
```

---

## PHASE 1 — Lock down + route `app_messenger.php`

**Why first:** (1) Unauthenticated endpoint is the only issue a stranger can exploit today — public URL → trigger SMS to staff phone. (2) Currently all messages go to one hardcoded phone (`+17723492553`) with no care-note audit trail; routing to the patient's assigned nurse + recording as a care note makes the feature clinically usable.

### App payload — unchanged

The mobile app keeps sending the same body:
```json
{ patientId, patientName, patientPhone, message, timestamp }
```
No app-side changes beyond adding the `X-API-Key` header (→ Bearer JWT after Phase 9). Forward-compatible: future app versions can surface the richer response fields; current version just checks `success`.

### Server logic (`app_messenger.php`)

1. `validateApiKey()` at top of handler (copy pattern from `vitals_sync.php:399-404`). Return 401 on missing/invalid key.
2. Rate limit: max N per patient_id per hour, max M per IP per hour. File-based counter is fine for v1.
3. Validate input shape + message length ≤ 500 (existing).
4. **Resolve recipient nurse** (tiered fallback):
   - **Tier 1 — primary nurse:** `SELECT user_id FROM patient_nurse_assignments WHERE patient_id=? AND is_primary=1 LIMIT 1`
   - **Tier 2 — any assigned nurse:** `WHERE patient_id=? ORDER BY assigned_at DESC LIMIT 1`
   - **Tier 3 — configured fallback user:** read `system_settings` row where `setting_group='notifications' AND setting_key='app_message_fallback_user_id'`
   - **Tier 4 — last resort:** the historical hardcoded `+17723492553` (safety net; should rarely fire)
   - For tiers 1-3, also check the resolved user has `status='Active'` and a non-empty `phone` column. If not, fall through to the next tier.
   - Ignore `day_of_week` column on `patient_nurse_assignments` for now. Rotation support is a future EMR-project enhancement; the API can add it without changing the contract.
   - **Do not apply `sms_quiet_hours_start/end` settings to this flow.** Those are for patient-facing notifications. A patient reporting symptoms at 11pm is exactly when the nurse needs to be reached.
5. **INSERT `patient_care_notes`:**
   ```sql
   INSERT INTO patient_care_notes (
     patient_id, author_user_id, note, note_date,
     category_id, created_at
   ) VALUES (
     ?, 37, '[CareView App Message]\n' || {message}, NOW(),
     10, NOW()    -- category 10 = 'Patient Contact'
   )
   ```
   `author_user_id = 37` is the pre-seeded "Mobile App (system)" user — makes it clear this note came from the patient via the app, not a staff member.
6. INSERT `app_messages` (existing — keep as audit log with SMS delivery status).
7. `SmsHelper::send(recipient.phone, formatted_body)` where formatted_body contains patient name, patient phone, timestamp, message.
8. UPDATE `app_messages SET sms_status, clicksend_message_id` based on ClickSend result.

### Richer response (forward-compatible — current app ignores new fields)

```json
{
  "success": true,
  "messageId": "msg_abc123",
  "careNoteId": 456,
  "recipient": {
    "tier": "primary_nurse" | "any_nurse" | "fallback_user" | "last_resort",
    "name": "Jane Smith"
  }
}
```

### Data insertion (not schema change)

Add one row to `system_settings` to make the fallback user ID configurable via the existing Settings UI:
```sql
INSERT INTO system_settings (
  setting_group, setting_key, setting_value, display_name, description,
  field_type, default_value, sort_order, is_sensitive, is_readonly
) VALUES (
  'notifications', 'app_message_fallback_user_id', NULL,
  'App Message Fallback User',
  'User who receives patient app messages when no nurse is assigned. Must be an Active user with a phone number.',
  'number', NULL, 100, 0, 0
);
```
This is a data insert into an existing table (not a schema change — in scope).

### App changes

`src/components/SendMessageModal.tsx:136` — add `X-API-Key` header (use the same constant as `vitalsSyncService.ts:43`; replaced by Bearer JWT in Phase 9). No UX change.

### Companion requirement

Server + app must deploy together. If server goes first, app messaging 401s. If app goes first, nothing breaks (extra header ignored).

### Verification

1. `curl -X POST .../app_messenger.php -d '{...}'` without key → expect 401
2. Assign a test nurse to test patient (`is_primary=1`), give them a phone number. Send message from app. Confirm:
   - SMS arrives on nurse's phone (not the hardcoded number)
   - New row in `patient_care_notes` with `author_user_id=37, category_id=10, note` includes "[CareView App Message]"
   - New row in `app_messages` with `sms_status='sent'`
3. Remove the primary assignment, leave a non-primary assignment. Send message. Confirm SMS routes to the non-primary nurse.
4. Remove all nurse assignments. Configure fallback via `system_settings`. Send message. Confirm SMS routes to fallback user. Care note still created.
5. Unset fallback setting and remove all assignments. Send message. Confirm SMS falls through to `+17723492553` last-resort path.
6. Send 20 messages in quick succession from one IP → rate limit response.

**Risk:** Low-Medium. More moving pieces than the original auth-only plan, but every piece uses existing tables/patterns. Nothing is novel infrastructure.

---

## PHASE 2 — Delete dead-URL screening service

**Why:** `screeningSyncService.ts:10` posts to `appapi.trinityhhs.com` — DNS doesn't resolve. Every modal submission silently fails. Actual sync only happens via `vitalsSyncService` background sweep 0–60s later.

**App:**
- `src/components/DailyHealthCheckModal.tsx:17, 86` — replace `syncScreeningResponses()` import+call with `vitalsSyncService.syncAllPending()` (or a narrower `syncPendingScreening()` export if you don't want the vitals sweep on every health-check submit)
- `src/components/UrineProteinModal.tsx:16, 61, 74` — same
- Delete `src/services/screeningSyncService.ts`

**Docs:**
- Remove all `trinityhhs.com` / `appapi.trinityhhs.com` references from `.claude/CLAUDE.md` and `AGENTS.md`

**No server changes.**

**Verification:**
1. Submit daily health check → check `screening_sync.php` server log (`screening_sync_log.txt`) for the request
2. Submit urine protein → same
3. Grep codebase for `trinityhhs` → zero matches

**Risk:** Low. Single failure path replaced with the one that already works.

---

## PHASE 3 — Server clinical-correctness fixes

Two small server-side changes that affect clinical data correctness. App side unchanged for both.

### 3a — `verify_code.php`: return `bpThresholds`

**Why:** Server never sends thresholds; app defaults to 140/90 for every patient. Physician-set thresholds are non-functional.

**Data source (confirmed):** `providers_vital_thresholds` table stores BP as two rows per provider:
- `vital_sign_id=1, notes='sys', high_threshold=140` (systolic)
- `vital_sign_id=1, notes='dia', high_threshold=90` (diastolic)

Patient's provider comes from `patient_providers WHERE is_primary=1`. Table conflict that blocked this (`uniq_provider_vital` unique index) was dropped on 2026-04-24.

**Server:** `verify_code.php` — use the existing `ThresholdHelper::getForPatient()` helper (it already handles the full lookup + fallback chain):

```php
use App\Helpers\ThresholdHelper;

// ...after loading $patient...
$thresholds = ThresholdHelper::getForPatient((int)$patient->id);

// In the response array:
'bpThresholds' => [
    'systolicHigh'  => (int)$thresholds['bp_sys_high'],
    'diastolicHigh' => (int)$thresholds['bp_dia_high'],
],
```

Three lines + one `use` statement. No duplicated logic — the helper is the EMR's canonical threshold resolver.

**App end-to-end flow (already built):**
1. `authService.verifyCode` reads `data.bpThresholds` from response → saves to SQLite `user.systolicHigh` / `user.diastolicHigh`
2. Redux `userSlice` loads thresholds into state on boot
3. `isBPHigh(systolic, diastolic, thresholds)` selector uses them for Dashboard coloring, History chart thresholds, and any "high" flag in the UI

No app changes needed.

**Verification:**
1. Insert two rows into `providers_vital_thresholds` for a test patient's primary provider: `(provider_id=X, vital_sign_id=1, notes='sys', high_threshold=135)` and `(..., notes='dia', high_threshold=85)`
2. Log in on app with that patient's phone
3. A BP reading of 138/88 shows as high (above 135/85); a reading of 130/80 shows normal

### 3b — `screening_sync.php`: persist asymptomatic daily health checks

**Why:** Today the server skips storing a `daily_health_check` when both `hasHeadaches` and `hasVisualDisturbances` are false (`screening_sync.php:188–194`). Result: no compliance/check-in log for patients who answer "no symptoms" every day. Trinity needs proof of engagement regardless of symptoms; it only needs to *triage* symptomatic ones.

**Server:** `screening_sync.php:188–194`
- Remove the early-return skip branch. Always `INSERT INTO patient_app_alerts`.
- `has_headaches` and `has_visual_disturbances` flags are already stored — the care team UI will filter alerts via `WHERE has_headaches=1 OR has_visual_disturbances=1 AND acknowledged=0`.
- Table remains named `patient_app_alerts` (acknowledged quirk: it now stores non-alerts too). Not renaming — too much blast radius for a cosmetic point.

**Care team UI (EMR side):** Update any query that assumed the old "symptoms-only" semantics. Triage/alert queues must filter by symptom flags, not by row existence.

**App:** No change.

**Verification:**
1. Submit a daily health check with both answers "No" → check `patient_app_alerts`: row exists, `has_headaches=0`, `has_visual_disturbances=0`
2. Submit one with headache "Yes" → new row with `has_headaches=1`
3. Care team alert dashboard shows only the second row

**Risk:** Low on server. Medium on EMR UI if existing queries treat row presence as a symptom signal — audit first.

---

## PHASE 4 — Submission Blockers (signing, bundle ID, privacy)

**Why:** Cannot ship to App Store or Play Store without these. Legal review required.

### 4a — iOS Release config

**File:** `ios/cvdemo.xcodeproj/project.pbxproj` (edit in Xcode GUI, not direct)

Open `ios/cvdemo.xcworkspace` → target `cvdemo` → Signing & Capabilities → Release:
- Bundle Identifier: `com.trinitycareview.demo` → `com.trinitycareview.app`
- Code Signing Identity: `Apple Development` → `Apple Distribution`
- Provisioning Profile: set to real App Store profile (currently blank at line 375)
- Team: keep `3VN4ZKZSLL`

**Verify:** Archive build in Xcode → validate against App Store Connect → no identity/signing errors.

### 4b — Android release signing

**File:** `android/app/build.gradle:57`

- Generate real release keystore: `keytool -genkey -v -keystore trinity-careview-release.keystore -alias trinity-careview -keyalg RSA -keysize 2048 -validity 10000`
- Store keystore password + key password in CI secrets / local `~/.gradle/gradle.properties` (NOT committed)
- Add `release` signingConfig in `build.gradle`:
  ```groovy
  signingConfigs {
      release {
          storeFile file(System.getenv("TRINITY_RELEASE_KEYSTORE") ?: "trinity-careview-release.keystore")
          storePassword System.getenv("TRINITY_STORE_PASSWORD")
          keyAlias "trinity-careview"
          keyPassword System.getenv("TRINITY_KEY_PASSWORD")
      }
  }
  ```
- Change `buildTypes.release.signingConfig` from `signingConfigs.debug` to `signingConfigs.release`

**Verify:** `./gradlew bundleRelease` produces a signed AAB → `jarsigner -verify` confirms the release key, not androiddebugkey.

### 4c — iOS Privacy Manifest

**File:** `ios/cvdemo/PrivacyInfo.xcprivacy:34`

Populate `NSPrivacyCollectedDataTypes` with entries for:
- Health & Fitness (vitals readings, screening answers)
- Contact Info (phone number)
- User ID (patientId)
- Sensitive Info (pregnancy-related health data)

Each with `NSPrivacyCollectedDataTypeLinked: true`, `NSPrivacyCollectedDataTypeTracking: false`, `NSPrivacyCollectedDataTypePurposes: [NSPrivacyCollectedDataTypePurposeAppFunctionality]`.

**Legal review required before committing.**

### 4d — Store privacy disclosures

- App Store Connect → App Privacy questionnaire — match PrivacyInfo.xcprivacy
- Google Play Console → Data Safety form — match iOS disclosure
- Both need to be accurate (not just "matching") for HIPAA compliance

**Legal sign-off required.**

**Risk:** High blast radius if wrong (App Store rejection). Low technical difficulty.

---

## PHASE 5 — SQLite writes must fail loudly

**Why:** `saveReading`, `saveScreeningResponse`, `saveUser` currently `catch { console.error }`. Capture flow shows success on failed clinical writes.

**App:** `src/services/sqliteService.ts`
- `saveReading` (line 451): remove `catch`, let SQLite errors propagate
- `saveScreeningResponse`: same
- `saveUser`: same
- `wipeAllPatientData` (line 768): also `DELETE FROM user;` — currently leaves old patient row

**App callers:**
- `src/screens/Capture/CaptureScreen.tsx` `saveBPReading` / `saveWeightReading`: wrap in try/catch, show toast on failure, do NOT proceed to sync
- `src/components/DailyHealthCheckModal.tsx` + `UrineProteinModal.tsx`: try/catch around `saveScreeningResponse`, show error, keep modal open
- `src/services/authService.ts` `verifyCode`: wrap `wipeAllPatientData()` + `saveUser(user)` in try/catch; if it throws, `throw new Error("Unable to complete sign-in. Please try again.")` — never advance to "Main" navigator on failure

**Verification:**
1. Temporarily break the `readings` table (rename in dev DB) → capture reading → expect toast error, no "Synced" UI state
2. Log in as different patient with wipe broken → expect blocked login, old data preserved (never half-wiped)

**Risk:** Medium. Changes error-handling behavior in hot paths. Test carefully on Android + iOS.

---

## PHASE 6 — Native module surgical fixes

**Three independent fixes. Each is a single small edit. Do not refactor anything else.**

### 6a — iHealth auth must reject on failure

- `src/services/deviceService.ts:100`: remove the `return true` fallback; rethrow / reject
- `modules/react-native-ihealth-devices/android/.../IHealthDevicesModule.kt`: remove the `catch (e: Exception) { isAuthenticatedFlag = true; promise.resolve(true) }` — let `promise.reject` happen

**Verify:** Remove `license.pem` from app bundle → launch → expect clear error, no BLE scanning.

### 6b — HS2S duplicate weight reading

- `modules/react-native-ihealth-devices/ios/IHealthDevices.m:843-857`: in `handleHS2SConnected:`, emit `onWeightReading` only from the `weightAndBodyInfo:` callback. Either remove the emission from `stableWeight:` or gate with a per-measurement flag.
- `src/screens/Capture/CaptureScreen.tsx` `saveWeightReading`: add `if (readingReceivedRef.current) return;` as first line (belt-and-braces dedup guard)

**Verify:** Step on HS2S scale → count readings in SQLite → exactly one row per weigh-in.

### 6c — Native module package.json BOM

- `modules/react-native-ihealth-devices/package.json`: resave as UTF-8 **without** BOM (first 3 bytes currently `EF BB BF`)

**Verify:** `npx jest` starts without JSON parse error.

**Risk:** 6a can break device pairing if license is actually invalid in prod — validate before ship. 6b is the scariest change in this phase; reproduce on hardware first. 6c is one-byte-level safe.

---

## PHASE 7 — PHI log hygiene

### 7a — App

- Grep: `grep -rn "console\." src/ modules/react-native-ihealth-devices/src/`
- Any log containing patient data (readings, patientId, phone, screening data, names): wrap in `if (__DEV__) { ... }`
- Key offenders: `vitalsSyncService.ts:223`, `authService.ts:147, 164, 186, 193`, `sqliteService.ts:445`
- Add ESLint rule (optional): `no-console` with `allow: ['warn', 'error']` and review remaining sites

**Verify:** Build release APK → `adb logcat` during a reading capture → no patient identifiers in output.

### 7b — Server

- `vitals_sync.php`, `screening_sync.php`, `device_register.php`: `logIncomingRequest()` functions write full raw body to `.txt` logs in a web-accessible directory
- Redact: strip `vitals[].value`, `vitals[].value2`, `responses[].data`, any name/phone fields before writing
- Move logs off web root (e.g., `/var/log/careview/` outside `public_html`)
- Add logrotate config: daily rotation, 90-day retention, compressed
- Block direct access via `.htaccess` as defense-in-depth

**Verify:** Hit endpoint → check logs are written to new location, redacted. Existing `vsl.txt` / `screening_sync_log.txt` / `device_register.log` → archive or delete (they contain historical PHI).

**Risk:** Low technical. HIPAA compliance consideration on handling the existing log files.

---

## PHASE 8 — CI green

- **BOM fix** (Phase 6c already covers)
- **ESLint**: fix unused variable in `modules/react-native-ihealth-devices/src/IHealthDevicesManager.ts` → `npm run lint --quiet` should pass
- **npm audit**: `npm audit fix` in `C:\Apps\careview`; manually review transitive-dep advisories; bump RN patch releases if needed
- Add CI workflow (if not present): on PR, run `tsc --noEmit`, `npm run lint`, `npx jest`, `npm audit --omit=dev --audit-level=high`

**Verify:** PR check status all green.

**Risk:** Low. Some npm audit fixes may require minor version bumps — test RN build on both platforms after.

---

## PHASE 9 — Auth architecture (JWT migration + key rotation)

**Biggest phase. Can start in parallel with Phase 1 but ships last.**

### 9a — Server: JWT issuance + validation

**DB constraint (per scope fence):** only NEW tables. No modifications to existing tables.

- **New table `refresh_tokens`** (id, patient_id FK, token_hash, expires_at, revoked_at, created_at) — stores refresh tokens only; JWTs themselves are stateless and not persisted
- JWT signing secret in `.env` (`CAREVIEW_JWT_SECRET`); no DB storage for the secret
- `verify_code.php`: on success, generate signed JWT (HS256, 1-hour lifetime) with claims `{ patient_id, iat, exp, jti }`. Also generate + store a refresh token (30-day lifetime). Include both in response: `'token' => $jwt, 'refreshToken' => $refresh`
- New endpoint `refresh_token.php`: accepts refresh token, rotates it (marks old `revoked_at`, issues new pair)
- New helper `validate_jwt()` — replaces `validate_api_key()` in vitals_sync, screening_sync, app_messenger, device_register
- Verify `patient_id` in request body matches `patient_id` claim in token; reject mismatch with 403
- Keep static `X-API-Key` as fallback during a transition window, then remove

### 9b — App: token storage + header

- `authService.verifyCode`: save returned token to SQLite (new `auth_token` column on `user`, or a dedicated `auth` table)
- Create `src/services/authToken.ts`: get/set/refresh token
- `vitalsSyncService`, `screeningSyncService` (deleted by Phase 2), `SendMessageModal`: send `Authorization: Bearer <token>` instead of `X-API-Key`
- Handle 401 → attempt refresh → if refresh fails, force re-login
- Remove hardcoded API key constants

### 9c — Key rotation

- After JWT is live and Phase 1-8 have shipped, rotate the static `dc9a8e0f68…c3ba85` key server-side
- Verify no production traffic using the old key (via logs) before final removal

### 9d — CORS tightening

- Once JWT replaces the static key, remove `Access-Control-Allow-Origin: *` from all endpoints (mobile apps don't need CORS)
- Or restrict to known app origins if any web surface emerges later

**Verification:**
1. Log in → JWT stored, patientId in decoded token matches
2. Post vitals with mismatched `patient_id` in body → 403
3. Force token expiry → app silently refreshes or re-logs in
4. After rotation, attempt with old static key → 401

**Risk:** Highest in this plan. Touches every write path. Do after all P0/P1 items are stable. Consider deploying behind a feature flag on the server (accept both JWT and legacy key for N days) to allow rollback.

---

## PHASE 10 — EMR inventory integration (`device_register.php`)

**Why:** The EMR has a serialized inventory system keyed to BLE MACs. The app currently adds devices to local SQLite only and never registers them with the EMR. The server's vitals-sync assignment gate (`isUnitAssignedToPatient()`) is therefore dormant — it can't validate that a reading came from a device actually assigned to that patient. Closing this loop enables: (a) EMR inventory visibility into paired devices, (b) server-authoritative device lifecycle (admin returns/decommissions via EMR UI, app stops being a source of truth), (c) cuff-size tracking for BP monitors.

**Not a ship blocker.** The server accepts vitals with `unit_id = NULL` (legacy path). Nothing breaks today. This phase unlocks EMR-side functionality.

### Design briefs (already written — use these as spec)

| File | Role |
|---|---|
| `docs/APP_CUFF_SELECTION.md` | **Canonical.** Current v2 response shape (cuff_size field, `units` array), cuff-size picker UI, schema with `emrUnitId` + `emrAccessoryUnitId` + `cuffSize` columns, all register-flow specifics. |
| `docs/EMR_AUTOREGISTER_INTEGRATION.md` | Older v1 doc. Outdated on response shape (single `unit_id` vs new `units` array). Still accurate on: SQLite migration pattern, background retry sweep design, vitals-sync `unit_id` inclusion, legacy compat rules. Use Section D (background retry), Section E (vitals payload), Section F (Redux) from this doc. |

**Before executing: reconcile the two docs.** Either update `EMR_AUTOREGISTER_INTEGRATION.md` to reference v2 response shape, or mark it superseded. Don't let a future session implement the v1 contract by accident.

### Server reverse-engineering — confirmed

Verified against `C:\Users\denni\Dropbox\Business\Websites\trinityemr.com\public_html\api\careviewapp\device_register.php`:

- **Endpoint:** `POST /api/careviewapp/device_register.php`
- **Auth:** `X-API-Key` (same key as vitals_sync; will migrate to JWT per Phase 9)
- **Request body:** `patient_id` (int), `mac` (12-char hex), `category` (`BP`|`SCALE`), `cuff_size` (`STANDARD`|`LARGE`|`XXL` — required for BP, ignored for SCALE), plus optional `model`, `name`, `friendly_name`, `source`
- **Response 200:** `{success, units: [{unit_id, equipment, role: "monitor"|"accessory"|"scale", parent_unit_id?, idempotent}]}` — always an array; XXL returns 2 units (monitor + accessory with `parent_unit_id` pointing at the monitor)
- **Response 409:** conflicts — "assigned to another patient", "out of service", "cuff size mismatch" — all rolled back locally, alert shown
- **Response 422:** validation errors
- **Idempotent by `(bluetooth_mac, patient_id)`:** same MAC + same patient + same cuff size returns existing `unit_id`s

### Add-device flow (per `APP_CUFF_SELECTION.md`)

1. User scans / selects device via BLE
2. **If category === "BP"**: navigate to new `CuffSizeScreen` → user picks Standard / Large / XXL
3. Friendly-name modal (existing)
4. `confirmAddDevice()`: save to SQLite locally with `cuffSize` on the row
5. POST to `device_register.php` with `cuff_size` field populated for BP
6. On 200: store `emrUnitId` (monitor) and `emrAccessoryUnitId` (XXL cuff if returned) on the local devices row; dispatch Redux update
7. On 409: roll back local save, alert user with the server's error message verbatim
8. On 5xx / network: keep local pairing, schedule background retry; vitals can still sync (with `unit_id = NULL`) until registration succeeds

### Lifecycle model: Add-only, auto-reassign

No Delete flow. The app only handles **Add**, and Add is always "this device (Serial Number) belongs to *this* patient now." Four cases, all resolve at the server via `device_register.php`:

| State before pairing | Action |
|---|---|
| Serial Number unknown to inventory | Server creates new `inventory_units` row, assigns to patient |
| Known, currently unassigned | Server assigns to patient |
| Known, assigned to a **different** patient | Server **auto-reassigns** to current patient (writes "Returned" + "Dispensed" transactions for audit) |
| Known, assigned to the **same** patient | No-op (idempotent) |

No nurse intervention, no "contact Trinity" friction for hand-offs between patients. The old patient's historical vitals stay attributed to them (immutable — `patient_vitals.patient_id` is never rewritten). Only the `inventory_units.assigned_to_id` changes, with a full audit trail in `inventory_transactions`.

**Server change required in `device_register.php`:**

- **Remove** the 409 guard at lines ~272-276 (currently blocks reassignment):
  ```php
  if ($existing
      && $existing->assigned_to_type === 'patient'
      && (int)$existing->assigned_to_id !== $patientId) {
      send_error('Device is assigned to another patient. Contact Trinity.', 409);
  }
  ```
- **Replace** with auto-reassign logic: write a "Returned" `inventory_transactions` row for the old patient, then fall through to the existing `assign_to_patient()` call which will write the "Dispensed" row for the new patient.
- Both transactions should reference `app_system_user_id()` as the actor, with notes like `"App-triggered reassignment from patient {old_id} to patient {new_id}"`.

**409 cases that REMAIN (these are not reassignment scenarios):**

- `status = 'Damaged'` — out of service
- Cuff size mismatch (physical accessory can't silently change size)
- Same MAC registered under a different product SKU (data integrity error)

### Serial Number = BLE MAC (same number, one identifier)

The 12-character hex string printed on the back of every iHealth device (e.g., `508CB15A1781`) IS the BLE MAC address. iHealth prints the MAC on the device label and labels it as the serial number. The value the nurse reads visually, the value the app reads via Bluetooth during pairing, and the value stored in the EMR's Serial Number field are all **the same string**. There is no second identifier.

**Implication for the schema:** `inventory_units` currently has two columns — `bluetooth_mac` (written by `device_register.php` today) and `serial_number` (shown in the EMR admin UI). The EMR admin UI only exposes "Serial Number", so app-paired units' identifiers currently land in a column the UI doesn't read.

**Fix — server change (one file, one routing change):**

- `device_register.php` `find_or_create_unit()`: change the `INSERT INTO inventory_units` to write the MAC value into `serial_number` instead of `bluetooth_mac`. Change the existence lookup at the top of the function from `WHERE bluetooth_mac = ?` to `WHERE serial_number = ?`. Same idempotency, same behavior — just the column that backs the identity.
- XXL cuff path already uses `serial_number` — no change there, it unifies naturally.

**No migration needed.** Confirmed: zero units in `inventory_units` have `bluetooth_mac` populated today (all development, no production data). The `bluetooth_mac` column stays in the schema as dead weight for safety — drop in a later cleanup pass after confirming nothing else references it.

**App:** zero changes. App still sends `{ "mac": "508CB15A1781", ... }` in the register payload. Server routes the value to whichever column is canonical.

**Labels:** everywhere in user-facing copy — app UI, EMR inventory UI, nurse docs, error messages — the word is **"Serial Number."** Code-level variable naming (`mac` in the app, `$mac` in the PHP payload handler) can stay as-is since BLE SDK terminology is `mac`.

### Scope summary

**App:**
- SQLite: add `emrUnitId`, `emrAccessoryUnitId`, `cuffSize` columns (additive migrations — existing pattern in `sqliteService.ts`)
- Redux: extend `DeviceRecord`, new `setDeviceEmrUnits` reducer
- New service: `src/services/deviceRegistrationService.ts`
- New screen: `src/screens/Devices/CuffSizeScreen.tsx` (BP devices only) — labels use **"Serial Number"** wherever a device identifier is shown to the user
- Modify: `AddDeviceScreen.confirmAddDevice()` → register after local save; handle 200/409/5xx/fatal. Note: "assigned to another patient" 409 no longer fires — that path is now auto-reassign on the server.
- Modify: `vitalsSyncService.VitalPayload` → include optional `unit_id`; look it up from device row at payload-build time. **If `emrUnitId` is null (registration still pending), omit `unit_id` entirely from the payload** (do not send `null`) — server's legacy path stores the reading with `patient_vitals.unit_id = NULL`, same as today.
- Modify: `vitalsSyncService` background tick → also sweep for devices with `emrUnitId IS NULL` and retry registration
- No Delete flow — device removal from the app is not part of this phase and is not needed for the EMR lifecycle model

**Server (`device_register.php`):**
- Route the MAC value into `serial_number` instead of `bluetooth_mac` in `find_or_create_unit()` (both the INSERT and the existence lookup). No migration needed — no production data yet.
- Remove the "assigned to another patient" 409 guard (lines ~272-276)
- Add auto-reassign logic: on existing serial assigned to a different patient, write a "Returned" `inventory_transactions` row for the old patient + update `inventory_units.assigned_to_id` → then fall through to existing `assign_to_patient()` which writes the "Dispensed" row
- Both audit rows attributed to `app_system_user_id()`, notes: `"App-triggered reassignment from patient {old_id} to patient {new_id}"`
- Retain 409 for: `Damaged`, cuff-size mismatch, wrong-SKU serial

### Dependencies

- **Phase 1** (app_messenger auth) is independent
- **Phase 2** (dead URL cleanup) is independent
- **Phase 9** (JWT): if Phase 10 ships before Phase 9, the register call uses the static `X-API-Key`; if after, it uses the JWT. Either order works; just make sure the header swap happens in both places (register + vitals sync + messenger) at the same time.

### Verification

Follow the verification plan in `APP_CUFF_SELECTION.md` (Standard/Large/XXL pair, Scale pair, cuff mismatch 409, idempotent re-pair, offline retry, etc.), **excluding** the "409 assigned to another patient" step — that scenario is now auto-reassign. Plus:

10. **Auto-reassign:** Patient A pairs a BP device → EMR shows unit Assigned to A. Log out. Log in as Patient B. Pair the same physical device.
    - Expected: 200 response with the same `unit_id`
    - `inventory_transactions` shows: "Returned" from A (actor = app_system_user), then "Dispensed" to B
    - `inventory_units.assigned_to_id` = B
    - Patient A's historical `patient_vitals` rows are unchanged (still `patient_id = A`)
11. **Reading with `unit_id`:** After successful register, take a BP reading → check `vitals_sync.php` log shows `unit_id` in payload; EMR `patient_vitals` row has `unit_id` populated (no longer NULL).
12. **Reading while registration pending:** Kill network → pair device → local save succeeds, registration enters retry state. Take a BP reading immediately. Vitals payload omits `unit_id` entirely. Server stores `patient_vitals.unit_id = NULL`. Once network returns, retry sweep registers the device and subsequent readings include `unit_id`.
13. **Reading after admin decommissions:** Admin sets unit to Decommissioned via EMR UI. App takes another reading. Sync returns 200 (no error), but EMR `app_vitals_rejected.log` has a `unit_not_assigned` entry and `patient_vitals` has no new row.
14. **Labels are "Serial Number":** Scan every user-facing string in the device-add flow and device list screens — should say "Serial Number" (not "MAC", not "Bluetooth Address"). Same on EMR inventory admin UI.
15. **InventoryController smoke test:** After the `device_register.php` routing change ships, open the Device Inventory admin page and confirm app-paired devices appear in the list with their serial numbers visible. Prior to this change, `bluetooth_mac` column was populated but `serial_number` was not, so app-paired devices were invisible in the admin UI. This verification confirms the UI picks them up correctly.

### Risk

- **Medium.** Touches five files across services/screens/redux/sqlite. Cuff-size UI is new and user-facing.
- **Largest regression risk:** readings mid-rollout that hit the new `unit_id`-sending code path but reference a device where registration hasn't succeeded yet. Spec says "send without `unit_id` in that case" — make sure `VitalPayload` marks `unit_id` as optional and the build logic omits the key entirely (rather than sending `null`) when EMR id is missing.

---

## Known EMR Visibility Gaps (Informational — Not In Scope)

The following tables are written by the CareView API but currently read by **nothing** in the EMR admin UI. They are not broken — they hold real, accurate data. They are invisible to clinicians because the consuming EMR views haven't been built yet. This is a known gap, deliberately deferred to a separate EMR project:

| Table | Written by | EMR reader | Status |
|---|---|---|---|
| `patient_vitals` | `vitals_sync.php` | DashboardController, PatientController, charts, alerts | ✅ Live |
| `patient_app_alerts` (daily health checks) | `screening_sync.php` | None | ⏸ Deferred to EMR project |
| `patient_app_urine_protein` | `screening_sync.php` | None | ⏸ Deferred to EMR project |
| `app_messages` | `app_messenger.php` | None (SMS goes to staff phone out-of-band) | ⏸ Deferred to EMR project |
| `inventory_units` (app-registered) | `device_register.php` | InventoryController (will pick them up after Phase 10 routes MAC to `serial_number`) | 🟡 Fixed by Phase 10 |

**Why this is safe:** The app plan's job is to make sure the app captures correct data, the API receives it cleanly, and the DB holds it in the right shape. EMR-side visibility is a separate workstream that will benefit from having real historical data to build against by the time it starts. Shipping this plan first means the engagement widgets, compliance dashboards, and alert triage screens that the EMR project builds later will have real patient data to work with on day one.

**No action required in this plan.** Logging here for traceability.

### Live Dashboard That Benefits From This Plan

`patient_compliance_alerts` is a populated, cron-refreshed table tracking per-patient `hours_overdue` per vital sign. The EMR care team already consumes it. Three phases in this plan indirectly improve its accuracy:

- **Phase 5 (SQLite throw)** — silent-failed writes currently let the app claim success while no vital row ever reaches `patient_vitals`; the compliance cron then shows false "overdue" for patients who took a reading the phone dropped. Fixing this reduces false positives.
- **Phase 6b (HS2S dedup)** — removes phantom double-readings that currently poll the compliance cron into thinking the patient is more engaged than they are.
- **Phase 10 (`unit_id` in vitals)** — lets the compliance dashboard attribute readings to specific devices, enabling future "this device is failing" detection.

No code changes to the compliance table or its cron are in scope — the plan just makes the data feeding it more reliable.

### `vital_signs` Table — BG is Dormant, Not Dead

The EMR's `vital_signs` table has three entries: BP (1), Blood Glucose (2), Weight (3). The `dexcom_sync_log` table confirms glucose is ingested via a separate Dexcom path, not via the CareView app. **Do not remove** the `VitalType::BloodGlucose` enum case or `formatGlucose()` function from `vitals_sync.php` — the enum is live in the EMR via the Dexcom integration, and keeping the API code ready means a future CareView-side glucose re-integration has a runway. Removed from backlog.

---

## Backlog (post-launch, P2/P3)

Not ship-blockers. Grouped for future PRs:

**Security/Auth hardening**
- Demo login code `123456` gated by `APP_ENV=production`
- SQLCipher for SQLite encryption at rest
- DB error message leak (generic server responses)
- Move API key to `.env` (superseded by JWT rotation anyway)

**Data/UX polish**
- Patient messages persisted to local `messages` table + queue
- Camera permission prompt in `AddDeviceScreen.tsx`
- Vitals sync `fetchWithTimeout` wrapper (10–15s)
- Urine-protein 24h deferral window
- Nav reset-listener refactor
- Loading states on list screens
- Android `connectedDevices` → `ConcurrentHashMap`
- iOS `_gattPeripherals` cleanup in `startGATTScan`
- HS2S body-composition profile (only if body-fat/BMI features ship)

**Code hygiene**
- Remove `BG5`/`BG5S` from `DeviceType` union
- Remove `stopMeasurement` no-op
- Remove `syncOfflineData` unimplemented
- `getDeviceCategory` unknown → null, not "BP"
- Demo-data cleanup via `is_demo` column
- `vitals_sync.php:35` timezone comment
- `verify_code.php` provider: `null` instead of empty strings
- Server-side `urine_protein_deferred` branch removal (covered in Phase 3c)
- *(Removed: "Server-side glucose vocabulary cleanup" — `vital_sign_id=2` is live via Dexcom ingestion, not dead code)*

---

## Final Considerations Before Starting

1. **Do not batch phases into one PR.** Each phase should be its own PR for rollback safety.
2. **Legal review for Phase 4c/4d is a calendar dependency** — start it now; it's likely slower than your code work.
3. **Phases 1 and 9 both involve `app_messenger.php` + `SendMessageModal`.** After Phase 1 ships, note it in the issue tracker so Phase 9 knows to replace the header (not add another).
4. **Phase 5 is the most likely place to discover regressions.** The codebase currently relies on swallowed errors in some code paths. Run both platforms through a full capture flow before merging.
5. **Phase 6b (HS2S dedup) must be tested on real hardware.** Simulator can't reproduce.
6. **Keep the `modules/react-native-ihealth-devices` folder's diff minimal.** Phase 6 changes three small things. If the diff grows, stop and reassess.
7. **Hand me fixes by phase number** (e.g., "execute Phase 2") and I'll propose the exact diff for review before any edits land.

---

## Out of Scope (Reminder)

- `device_register.php` integration — future TODO
- iHealth SDK version differences — normal vendor behavior
- Non-surgical native module edits — working code, do not refactor
