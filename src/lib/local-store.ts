import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { QuizSubmission } from "./quiz";
import type { BookingWindow } from "./schedule";
import type { CrmEdit, CrmStage } from "./crm";

const deriveKey = promisify(scrypt);
export const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 8;
let database: DatabaseSync | undefined;

function databasePath() {
  const dataHome = process.platform === "win32"
    ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    : process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  // The database is runtime data and must never be copied into the deployment bundle.
  return resolve(/* turbopackIgnore: true */ process.env.AGENDADOR_DB_PATH || join(dataHome, "gatu-agendador", "agendador.sqlite"));
}

function db() {
  if (database) return database;
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const connection = new DatabaseSync(path);
  try {
    connection.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS admin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        email TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        window_start INTEGER NOT NULL,
        attempts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quiz_drafts (
        id INTEGER PRIMARY KEY,
        config TEXT NOT NULL CHECK (json_valid(config)),
        revision INTEGER NOT NULL CHECK (revision > 0)
      );
      CREATE TABLE IF NOT EXISTS quiz_publications (
        quiz_id INTEGER PRIMARY KEY REFERENCES quiz_drafts(id),
        slug TEXT NOT NULL UNIQUE,
        config TEXT NOT NULL CHECK (json_valid(config)),
        revision INTEGER NOT NULL CHECK (revision > 0)
      );
      CREATE TABLE IF NOT EXISTS quiz_responses (
        id TEXT PRIMARY KEY,
        quiz_id INTEGER REFERENCES quiz_drafts(id),
        revision INTEGER NOT NULL,
        received_at INTEGER NOT NULL,
        response TEXT NOT NULL CHECK (json_valid(response))
      );
      CREATE INDEX IF NOT EXISTS quiz_responses_received ON quiz_responses(received_at DESC);
      CREATE TABLE IF NOT EXISTS agenda_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        config TEXT NOT NULL CHECK (json_valid(config)),
        revision INTEGER NOT NULL CHECK (revision > 0)
      );
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY REFERENCES quiz_responses(id),
        slug TEXT NOT NULL,
        revision INTEGER NOT NULL,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL CHECK (end_at > start_at),
        title TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS booking_start ON bookings(start_at);
      CREATE TABLE IF NOT EXISTS meta_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pixel_id TEXT NOT NULL,
        encrypted_token TEXT NOT NULL,
        test_code TEXT NOT NULL,
        revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta_schedule_deliveries (
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
        destination TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS meta_schedule_due ON meta_schedule_deliveries(destination, next_attempt_at);
      CREATE TABLE IF NOT EXISTS meta_purchase_deliveries (
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
        destination TEXT NOT NULL,
        value_cents INTEGER NOT NULL CHECK (value_cents BETWEEN 0 AND 99999999999),
        occurred_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS meta_purchase_due ON meta_purchase_deliveries(destination, next_attempt_at);
      CREATE TABLE IF NOT EXISTS meta_checkout_deliveries (
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
        destination TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS meta_checkout_due ON meta_checkout_deliveries(destination, next_attempt_at);
      CREATE TABLE IF NOT EXISTS booking_notifications (
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
        created_at INTEGER NOT NULL,
        read_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS booking_notifications_created ON booking_notifications(created_at DESC);
      CREATE TABLE IF NOT EXISTS push_keys (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        browser_key TEXT NOT NULL,
        auth_secret TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_deliveries (
        booking_id TEXT NOT NULL REFERENCES booking_notifications(booking_id),
        endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL,
        PRIMARY KEY (booking_id, endpoint)
      );
      CREATE TABLE IF NOT EXISTS crm_leads (
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
        stage TEXT NOT NULL CHECK (stage IN ('scheduled', 'confirmed', 'met', 'proposal', 'won', 'lost')),
        note TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crm_deal_values (
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id),
        cents INTEGER CHECK (cents IS NULL OR cents BETWEEN 0 AND 99999999999)
      );
      CREATE TABLE IF NOT EXISTS crm_deleted_cards (
        booking_id TEXT PRIMARY KEY REFERENCES bookings(id)
      );
      CREATE TABLE IF NOT EXISTS crm_activity (
        id INTEGER PRIMARY KEY,
        booking_id TEXT NOT NULL REFERENCES bookings(id),
        created_at INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('stage', 'note')),
        from_stage TEXT,
        to_stage TEXT
      );
      CREATE INDEX IF NOT EXISTS crm_activity_booking ON crm_activity(booking_id, id DESC);
      CREATE TABLE IF NOT EXISTS google_calendar_connection (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        connection_id TEXT NOT NULL,
        encrypted_token TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS google_calendar_events (
        booking_id TEXT NOT NULL REFERENCES bookings(id),
        connection_id TEXT NOT NULL,
        PRIMARY KEY (booking_id, connection_id)
      );
      CREATE TABLE IF NOT EXISTS google_calendar_invitations (
        booking_id TEXT NOT NULL REFERENCES bookings(id),
        connection_id TEXT NOT NULL,
        PRIMARY KEY (booking_id, connection_id)
      );
    `);
    connection.exec("BEGIN IMMEDIATE");
    if (!(connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version) {
      const tableExists = connection.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?");
      if (tableExists.get("quiz_draft")) {
        connection.exec("INSERT INTO quiz_drafts (id, config, revision) SELECT id, config, revision FROM quiz_draft");
      }
      if (tableExists.get("quiz_publication")) {
        connection.exec("INSERT INTO quiz_publications (quiz_id, slug, config, revision) SELECT id, slug, config, revision FROM quiz_publication");
      }
      if (!connection.prepare("PRAGMA table_info(quiz_responses)").all().some(column => column.name === "quiz_id")) {
        connection.exec("ALTER TABLE quiz_responses ADD COLUMN quiz_id INTEGER REFERENCES quiz_drafts(id)");
        connection.exec("UPDATE quiz_responses SET quiz_id = 1");
      }
      connection.exec("CREATE INDEX IF NOT EXISTS quiz_responses_quiz_received ON quiz_responses(quiz_id, received_at DESC)");
      connection.exec("PRAGMA user_version = 1");
    }
    connection.exec("COMMIT");
    database = connection;
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function hasAdmin() {
  return Boolean(db().prepare("SELECT 1 FROM admin WHERE id = 1").get());
}

async function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await deriveKey(password, salt, 64) as Buffer).toString("hex");
  return { salt, hash };
}

export async function createAdmin(email: string, password: string) {
  const { salt, hash } = await hashAdminPassword(password);
  const result = db().prepare(`
    INSERT INTO admin (id, email, password_salt, password_hash)
    VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `).run(email, salt, hash);
  return result.changes === 1 ? hash : null;
}

export async function resetAdminPassword(email: string, password: string) {
  const { salt, hash } = await hashAdminPassword(password);
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = connection.prepare("UPDATE admin SET password_salt = ?, password_hash = ? WHERE id = 1 AND email = ?")
      .run(salt, hash, email);
    if (result.changes !== 1) return false;
    connection.exec("DELETE FROM admin_sessions; DELETE FROM login_attempts;");
    connection.exec("COMMIT");
    return true;
  } finally {
    if (connection.isTransaction) connection.exec("ROLLBACK");
  }
}

export async function verifyAdminCredentials(email: string, password: string) {
  const row = db().prepare("SELECT email, password_salt, password_hash FROM admin WHERE id = 1").get() as
    { email: string; password_salt: string; password_hash: string } | undefined;
  const actual = await deriveKey(password, row?.password_salt ?? "gatu-agendador-invalid-login", 64) as Buffer;
  const expected = row ? Buffer.from(row.password_hash, "hex") : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && row?.email === email ? row.password_hash : null;
}

export function reserveLoginAttempt() {
  const now = Date.now();
  const result = db().prepare(`
    INSERT INTO login_attempts (id, window_start, attempts) VALUES (1, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END,
      attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END
    WHERE window_start <= ? OR attempts < ?
  `).run(now, now - LOGIN_WINDOW_MS, now - LOGIN_WINDOW_MS, now - LOGIN_WINDOW_MS, MAX_LOGIN_ATTEMPTS);
  return result.changes === 1;
}

function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(verifiedPasswordHash: string) {
  const connection = db();
  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  connection.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);
  const result = connection.prepare(`
    INSERT INTO admin_sessions (token_hash, expires_at)
    SELECT ?, ? FROM admin WHERE id = 1 AND password_hash = ?
  `).run(sessionHash(token), now + SESSION_SECONDS * 1000, verifiedPasswordHash);
  if (result.changes !== 1) return null;
  connection.prepare("DELETE FROM login_attempts WHERE id = 1").run();
  return token;
}

export function hasSession(token?: string) {
  if (!token || !/^[\w-]{43}$/.test(token)) return false;
  return Boolean(db().prepare("SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .get(sessionHash(token), Date.now()));
}

export function revokeSession(token: string) {
  db().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(sessionHash(token));
}

export function loadDraft(quizId = 1) {
  return db().prepare("SELECT config, revision FROM quiz_drafts WHERE id = ?").get(quizId) as
    { config: string; revision: number } | undefined;
}

export function writeDraft(config: string, revision: number, quizId = 1) {
  if (revision === 0 && quizId !== 1) return null;
  const connection = db();
  const result = revision === 0
    ? connection.prepare("INSERT INTO quiz_drafts VALUES (1, ?, 1) ON CONFLICT(id) DO NOTHING").run(config)
    : connection.prepare("UPDATE quiz_drafts SET config = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
      .run(config, quizId, revision);
  return result.changes === 1 ? revision + 1 : null;
}

export function createQuizDraft(config: string) {
  const row = db().prepare(`
    INSERT INTO quiz_drafts (id, config, revision)
    SELECT MAX(COALESCE(MAX(id), 1), 1) + 1, ?, 1 FROM quiz_drafts RETURNING id
  `).get(config) as { id: number };
  return row.id;
}

export function listQuizDrafts() {
  return db().prepare(`
    SELECT d.id, json_extract(d.config, '$.name') AS name, d.revision,
      p.slug, p.revision AS publishedRevision
    FROM quiz_drafts d LEFT JOIN quiz_publications p ON p.quiz_id = d.id
    ORDER BY d.id
  `).all() as { id: number; name: string | null; revision: number; slug: string | null; publishedRevision: number | null }[];
}

export function readQuizPublication(quizId: number) {
  const row = db().prepare("SELECT slug, revision FROM quiz_publications WHERE quiz_id = ?").get(quizId) as
    { slug: string; revision: number } | undefined;
  return row ? { ...row } : null;
}

export function readPublication(slug: string) {
  return db().prepare("SELECT slug, config, revision FROM quiz_publications WHERE slug = ?").get(slug) as
    { slug: string; config: string; revision: number } | undefined;
}

export function publishDraft(baseSlug: string, revision: number, quizId = 1, requestedSlug = "") {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const draft = loadDraft(quizId);
    if (!draft || draft.revision !== revision) return undefined;

    const used = connection.prepare("SELECT 1 FROM quiz_publications WHERE slug = ? AND quiz_id <> ?");
    if (requestedSlug && used.get(requestedSlug, quizId)) return null;
    let slug = requestedSlug || readQuizPublication(quizId)?.slug;
    if (!slug) {
      slug = baseSlug;
      for (let index = 2; used.get(slug, quizId); index++) {
        const suffix = `-${index}`;
        slug = baseSlug.slice(0, 70 - suffix.length).replace(/-+$/, "") + suffix;
      }
    }
    connection.prepare(`
      INSERT INTO quiz_publications (quiz_id, slug, config, revision) VALUES (?, ?, ?, ?)
      ON CONFLICT(quiz_id) DO UPDATE SET slug = excluded.slug, config = excluded.config, revision = excluded.revision
    `).run(quizId, slug, draft.config, revision);
    connection.exec("COMMIT");
    return { slug, revision };
  } finally {
    if (connection.isTransaction) connection.exec("ROLLBACK");
  }
}

export function insertQuizResponse(slug: string, revision: number, id: string, response: QuizSubmission, agendaRevision?: number) {
  const connection = db();
  const result = connection.prepare(`
    INSERT INTO quiz_responses (id, quiz_id, revision, received_at, response)
    SELECT ?, quiz_id, revision, ?, ? FROM quiz_publications WHERE slug = ? AND revision = ?
      AND (? IS NULL OR COALESCE((SELECT revision FROM agenda_settings WHERE id = 1), 0) = ?)
    ON CONFLICT(id) DO NOTHING
  `).run(id, Date.now(), JSON.stringify(response), slug, revision, agendaRevision ?? null, agendaRevision ?? null);
  return result.changes === 1 || Boolean(connection.prepare(`
    SELECT 1 FROM quiz_responses r JOIN quiz_publications p ON p.quiz_id = r.quiz_id
    WHERE r.id = ? AND r.revision = ? AND p.slug = ?
  `).get(id, revision, slug));
}

export function recentQuizResponses(quizId = 1) {
  const rows = db().prepare(`
    SELECT r.id, r.received_at, r.response, b.start_at AS booking_start
    FROM quiz_responses r LEFT JOIN bookings b ON b.id = r.id
    WHERE r.quiz_id = ?
    ORDER BY r.received_at DESC LIMIT 100
  `).all(quizId) as { id: string; received_at: number; response: string; booking_start: number | null }[];
  return rows.map(row => ({ id: row.id, receivedAt: row.received_at, bookingStart: row.booking_start, ...JSON.parse(row.response) as QuizSubmission }));
}

export function readAgenda() {
  return db().prepare("SELECT config, revision FROM agenda_settings WHERE id = 1").get() as
    { config: string; revision: number } | undefined;
}

export function writeAgenda(config: string, revision: number) {
  const connection = db();
  const result = revision === 0
    ? connection.prepare("INSERT INTO agenda_settings VALUES (1, ?, 1) ON CONFLICT(id) DO NOTHING").run(config)
    : connection.prepare("UPDATE agenda_settings SET config = ?, revision = revision + 1 WHERE id = 1 AND revision = ?")
      .run(config, revision);
  return result.changes === 1 ? revision + 1 : null;
}

export function occupiedBookings(after: number) {
  return db().prepare("SELECT start_at AS start, end_at AS end FROM bookings WHERE end_at > ?").all(after) as BookingWindow[];
}

export function existingBooking(id: string, slug: string, revision: number): BookingWindow | null {
  const row = db().prepare("SELECT start_at AS start, end_at AS end FROM bookings WHERE id = ? AND slug = ? AND revision = ?")
    .get(id, slug, revision) as BookingWindow | undefined;
  return row ? { start: row.start, end: row.end } : null;
}

export function reserveBooking(slug: string, revision: number, agendaRevision: number, id: string, window: BookingWindow,
  title: string, response: QuizSubmission, connectionId = "", metaDestination?: string): BookingWindow | null {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const existing = existingBooking(id, slug, revision);
    if (existing) return existing;
    if (connection.prepare("SELECT 1 FROM bookings WHERE start_at < ? AND end_at > ?").get(window.end, window.start)) return null;
    const inserted = connection.prepare(`
      INSERT INTO quiz_responses (id, quiz_id, revision, received_at, response)
      SELECT ?, quiz_id, revision, ?, ? FROM quiz_publications WHERE slug = ? AND revision = ?
        AND (SELECT revision FROM agenda_settings WHERE id = 1) = ?
        AND COALESCE((SELECT connection_id FROM google_calendar_connection WHERE id = 1), '') = ?
      ON CONFLICT(id) DO NOTHING
    `).run(id, Date.now(), JSON.stringify(response), slug, revision, agendaRevision, connectionId);
    if (inserted.changes !== 1) return null;
    connection.prepare("INSERT INTO bookings (id, slug, revision, start_at, end_at, title) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, slug, revision, window.start, window.end, title);
    const now = Date.now();
    if (metaDestination && response.metaTracking?.clientUserAgent && response.metaTracking.eventSourceUrl) {
      connection.prepare("INSERT INTO meta_schedule_deliveries (booking_id, destination, next_attempt_at) VALUES (?, ?, ?)")
        .run(id, metaDestination, now);
    }
    connection.prepare("INSERT INTO booking_notifications (booking_id, created_at) VALUES (?, ?)").run(id, now);
    connection.prepare("INSERT INTO push_deliveries (booking_id, endpoint, available_at) SELECT ?, endpoint, ? FROM push_subscriptions").run(id, now);
    connection.exec("COMMIT");
    return window;
  } finally {
    if (connection.isTransaction) connection.exec("ROLLBACK");
  }
}

const CRM_CARD_NOT_DELETED = "NOT EXISTS (SELECT 1 FROM crm_deleted_cards d WHERE d.booking_id = b.id)";

type MetaSettings = { pixelId: string; token: string; testCode: string };

function metaKey(create = false) {
  const path = `${databasePath()}.meta-key`;
  try {
    return readFileSync(path);
  } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const key = randomBytes(32);
    writeFileSync(path, key, { flag: "wx", mode: 0o600 });
    return key;
  }
}

export function readMetaSettings() {
  const row = db().prepare("SELECT pixel_id AS pixelId, encrypted_token AS encryptedToken, test_code AS testCode, revision FROM meta_settings WHERE id = 1").get() as
    { pixelId: string; encryptedToken: string; testCode: string; revision: number } | undefined;
  if (!row) return undefined;
  const { encryptedToken, ...settings } = row;
  try {
    const record = Buffer.from(encryptedToken, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", metaKey(), record.subarray(0, 12));
    decipher.setAuthTag(record.subarray(12, 28));
    return { ...settings, token: Buffer.concat([decipher.update(record.subarray(28)), decipher.final()]).toString("utf8") };
  } catch {
    return { ...settings, token: "" };
  }
}

export function writeMetaSettings(settings: MetaSettings, revision: number) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const current = connection.prepare("SELECT revision FROM meta_settings WHERE id = 1").get() as { revision: number } | undefined;
    if ((current?.revision ?? 0) !== revision) return false;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", metaKey(true), iv);
    const ciphertext = Buffer.concat([cipher.update(settings.token, "utf8"), cipher.final()]);
    const record = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
    connection.prepare(`
      INSERT INTO meta_settings (id, pixel_id, encrypted_token, test_code, revision) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET pixel_id = excluded.pixel_id, encrypted_token = excluded.encrypted_token,
        test_code = excluded.test_code, revision = excluded.revision
    `).run(settings.pixelId, record, settings.testCode, revision + 1);
    connection.exec("COMMIT");
    return true;
  } finally {
    if (connection.isTransaction) connection.exec("ROLLBACK");
  }
}

const META_DELIVERY_TABLE = {
  Schedule: "meta_schedule_deliveries",
  InitiateCheckout: "meta_checkout_deliveries",
  Purchase: "meta_purchase_deliveries",
} as const;
type MetaEventName = keyof typeof META_DELIVERY_TABLE;

export function claimMetaEvents(eventName: MetaEventName, destination: string, now: number) {
  const connection = db();
  const table = META_DELIVERY_TABLE[eventName];
  const occurrenceField = eventName === "Schedule" ? "" : ", occurred_at AS occurredAt";
  const valueField = eventName === "Purchase" ? ", value_cents AS valueCents" : "";
  const claimed = connection.prepare(`
    UPDATE ${table} SET next_attempt_at = ?, attempts = attempts + 1
    WHERE booking_id IN (
      SELECT booking_id FROM ${table}
      WHERE destination = ? AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 10
    )
    RETURNING booking_id AS id, attempts${occurrenceField}${valueField}
  `).all(now + 60_000, destination, now) as { id: string; attempts: number; occurredAt?: number; valueCents?: number }[];
  const response = connection.prepare("SELECT response, received_at AS receivedAt FROM quiz_responses WHERE id = ?");
  return claimed.map(item => {
    const row = response.get(item.id) as { response: string; receivedAt: number };
    return { ...item, eventName, occurredAt: item.occurredAt ?? row.receivedAt, submission: JSON.parse(row.response) as QuizSubmission };
  });
}

export function finishMetaEvent(eventName: MetaEventName, id: string, attempt: number, retryAt: number | null) {
  db().prepare(`UPDATE ${META_DELIVERY_TABLE[eventName]} SET next_attempt_at = ? WHERE booking_id = ? AND attempts = ?`).run(retryAt, id, attempt);
}

export function nextMetaEvent(destination: string) {
  const row = db().prepare(`
    SELECT MIN(time) AS time FROM (
      SELECT MIN(next_attempt_at) AS time FROM meta_schedule_deliveries WHERE destination = ?
      UNION ALL
      SELECT MIN(next_attempt_at) AS time FROM meta_purchase_deliveries WHERE destination = ?
      UNION ALL
      SELECT MIN(next_attempt_at) AS time FROM meta_checkout_deliveries WHERE destination = ?
    )
  `).get(destination, destination, destination) as { time: number | null };
  return row.time;
}

export function upcomingBookings(now: number, { hideDeletedCards = false } = {}) {
  const rows = db().prepare(`
    SELECT b.id, b.start_at AS start, b.end_at AS end, b.title, r.response,
      EXISTS(SELECT 1 FROM google_calendar_events e JOIN google_calendar_connection c ON c.connection_id = e.connection_id
        WHERE e.booking_id = b.id) AS synced,
      EXISTS(SELECT 1 FROM google_calendar_invitations i JOIN google_calendar_connection c ON c.connection_id = i.connection_id
        WHERE i.booking_id = b.id) AS invited
    FROM bookings b JOIN quiz_responses r ON b.id = r.id
    WHERE b.end_at > ? ${hideDeletedCards ? `AND ${CRM_CARD_NOT_DELETED}` : ""}
    ORDER BY b.start_at LIMIT 100
  `).all(now) as (BookingWindow & { id: string; title: string; response: string; synced: number; invited: number })[];
  return rows.map(({ response, synced, invited, ...booking }) => ({
    ...booking, googleSynced: Boolean(synced), googleInvited: Boolean(invited), answers: (JSON.parse(response) as QuizSubmission).answers,
  }));
}

export function readBookingNotifications() {
  const dbConnection = db();
  const { unread } = dbConnection.prepare("SELECT COUNT(*) AS unread FROM booking_notifications WHERE read_at IS NULL").get() as { unread: number };
  const rows = dbConnection.prepare(`
    SELECT n.booking_id AS id, n.created_at AS createdAt, n.read_at AS readAt, b.title, b.start_at AS start, r.response
    FROM booking_notifications n JOIN bookings b ON n.booking_id = b.id JOIN quiz_responses r ON r.id = b.id
    ORDER BY n.created_at DESC, n.booking_id LIMIT 30
  `).all() as { id: string; createdAt: number; readAt: number | null; title: string; start: number; response: string }[];
  return { unread, items: rows.map(({ response, ...item }) => ({ ...item, name: (JSON.parse(response) as QuizSubmission).answers.name || "Lead sem nome" })) };
}

export function markBookingNotificationsRead(id?: string) {
  const connection = db();
  if (id !== undefined) connection.prepare("UPDATE booking_notifications SET read_at = ? WHERE booking_id = ? AND read_at IS NULL").run(Date.now(), id);
  else connection.prepare("UPDATE booking_notifications SET read_at = ? WHERE read_at IS NULL").run(Date.now());
}

type PushKeys = { publicKey: string; privateKey: string };

export function readPushKeys() {
  return db().prepare("SELECT public_key AS publicKey, private_key AS privateKey FROM push_keys WHERE id = 1").get() as PushKeys | undefined;
}

export function savePushKeys(keys: PushKeys) {
  db().prepare("INSERT OR IGNORE INTO push_keys VALUES (1, ?, ?)").run(keys.publicKey, keys.privateKey);
  return readPushKeys()!;
}

export function readPushSubscription(endpoint: string) {
  return db().prepare("SELECT browser_key AS p256dh, auth_secret AS auth FROM push_subscriptions WHERE endpoint = ?")
    .get(endpoint) as { p256dh: string; auth: string } | undefined;
}

export function hasPushSubscription(endpoint: string) {
  return Boolean(db().prepare("SELECT 1 FROM push_subscriptions WHERE endpoint = ?").get(endpoint));
}

export function savePushSubscription(endpoint: string, p256dh: string, auth: string) {
  return db().prepare(`
    INSERT INTO push_subscriptions (endpoint, browser_key, auth_secret)
    SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM push_subscriptions) < 20 OR EXISTS (SELECT 1 FROM push_subscriptions WHERE endpoint = ?)
    ON CONFLICT(endpoint) DO UPDATE SET browser_key = excluded.browser_key, auth_secret = excluded.auth_secret
  `).run(endpoint, p256dh, auth, endpoint).changes === 1;
}

export function deletePushSubscription(endpoint: string) {
  db().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

export function claimPushDeliveries(now: number) {
  const connection = db();
  connection.prepare(`
    DELETE FROM push_deliveries WHERE available_at <= ? AND
      (attempts >= 4 OR booking_id IN (SELECT booking_id FROM booking_notifications WHERE created_at < ?))
  `).run(now, now - 86_400_000);
  const rows = connection.prepare(`
    UPDATE push_deliveries SET attempts = attempts + 1, available_at = ?
    WHERE rowid IN (SELECT rowid FROM push_deliveries WHERE available_at <= ? ORDER BY available_at LIMIT 20)
    RETURNING booking_id AS id, endpoint, attempts
  `).all(now + 30_000, now) as { id: string; endpoint: string; attempts: number }[];
  const subscription = connection.prepare("SELECT browser_key AS p256dh, auth_secret AS auth FROM push_subscriptions WHERE endpoint = ?");
  return rows.flatMap(row => {
    const keys = subscription.get(row.endpoint) as { p256dh: string; auth: string } | undefined;
    return keys ? [{ ...row, keys: { ...keys } }] : [];
  });
}

export function finishPushDelivery(id: string, endpoint: string, attempt: number, retryAt?: number) {
  if (retryAt === undefined) db().prepare("DELETE FROM push_deliveries WHERE booking_id = ? AND endpoint = ? AND attempts = ?").run(id, endpoint, attempt);
  else db().prepare("UPDATE push_deliveries SET available_at = ? WHERE booking_id = ? AND endpoint = ? AND attempts = ?").run(retryAt, id, endpoint, attempt);
}

export function nextPushAttempt() {
  const row = db().prepare("SELECT MIN(available_at) AS time FROM push_deliveries").get() as { time: number | null };
  return row.time;
}

const LEAD_SELECT = `
  SELECT b.id, b.start_at AS start, b.end_at AS end, b.title, r.received_at, r.response,
    COALESCE(c.stage, 'scheduled') AS stage, COALESCE(c.note, '') AS note, COALESCE(c.revision, 0) AS revision,
    v.cents AS dealValueCents
  FROM bookings b JOIN quiz_responses r ON r.id = b.id
  LEFT JOIN crm_leads c ON c.booking_id = b.id
  LEFT JOIN crm_deal_values v ON v.booking_id = b.id
`;

type CrmRow = BookingWindow & { id: string; title: string; received_at: number; response: string; stage: CrmStage; note: string; revision: number; dealValueCents: number | null };

function toCrmLead({ response, received_at, ...lead }: CrmRow) {
  const { answers, extra, source, metaTracking } = JSON.parse(response) as QuizSubmission;
  return { ...lead, bookedAt: received_at, answers, extra, source, metaTracking };
}

export function readCrmLeads() {
  const rows = db().prepare(`${LEAD_SELECT} WHERE ${CRM_CARD_NOT_DELETED} ORDER BY r.received_at DESC, b.id`).all() as CrmRow[];
  return rows.map(toCrmLead);
}

export function readCrmActivity(id: string) {
  const rows = db().prepare(`
    SELECT id, created_at AS createdAt, kind, from_stage AS fromStage, to_stage AS toStage
    FROM crm_activity WHERE booking_id = ? ORDER BY id DESC
  `).all(id) as { id: number; createdAt: number; kind: "stage" | "note"; fromStage: CrmStage | null; toStage: CrmStage | null }[];
  return rows.map(row => ({ ...row }));
}

export function writeCrmLead(id: string, revision: number, edit: CrmEdit, metaDestination?: string) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const previous = connection.prepare(`${LEAD_SELECT} WHERE b.id = ? AND ${CRM_CARD_NOT_DELETED}`).get(id) as CrmRow | undefined;
    if (!previous || previous.revision !== revision) return null;

    const moved = "stage" in edit && edit.stage !== previous.stage;
    const noted = "note" in edit && edit.note !== previous.note;
    const dealValueCents = "dealValueCents" in edit ? edit.dealValueCents : previous.dealValueCents;
    const valued = dealValueCents !== previous.dealValueCents;
    if (!moved && !noted && !valued) return toCrmLead(previous);
    const stage = "stage" in edit ? edit.stage : previous.stage;
    const note = "note" in edit ? edit.note : previous.note;
    connection.prepare(`
      INSERT INTO crm_leads (booking_id, stage, note, revision) VALUES (?, ?, ?, ?)
      ON CONFLICT(booking_id) DO UPDATE SET stage = excluded.stage, note = excluded.note, revision = excluded.revision
    `).run(id, stage, note, revision + 1);
    if (valued) {
      connection.prepare(`
        INSERT INTO crm_deal_values (booking_id, cents) VALUES (?, ?)
        ON CONFLICT(booking_id) DO UPDATE SET cents = excluded.cents
      `).run(id, dealValueCents);
    } else {
      connection.prepare("INSERT INTO crm_activity (booking_id, created_at, kind, from_stage, to_stage) VALUES (?, ?, ?, ?, ?)")
        .run(id, Date.now(), moved ? "stage" : "note", moved ? previous.stage : null, moved ? stage : null);
    }
    const lead = toCrmLead({ ...previous, stage, note, dealValueCents, revision: revision + 1 });
    if (metaDestination && moved && lead.stage === "proposal" && (lead.metaTracking?.enabledAt !== undefined || lead.metaTracking?.purchaseConsent === true)) {
      const now = Date.now();
      connection.prepare(`
        INSERT INTO meta_checkout_deliveries (booking_id, destination, occurred_at, next_attempt_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(booking_id) DO NOTHING
      `).run(id, metaDestination, now, now);
    }
    if (metaDestination && lead.stage === "won" && (moved || valued) && dealValueCents !== null && (lead.metaTracking?.enabledAt !== undefined || lead.metaTracking?.purchaseConsent === true)) {
      const now = Date.now();
      connection.prepare(`
        INSERT INTO meta_purchase_deliveries (booking_id, destination, value_cents, occurred_at, next_attempt_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(booking_id) DO NOTHING
      `).run(id, metaDestination, dealValueCents, now, now);
    }
    connection.exec("COMMIT");
    return lead;
  } finally {
    if (connection.isTransaction) connection.exec("ROLLBACK");
  }
}

export function deleteCrmCard(id: string, revision: number) {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = connection.prepare(`
      INSERT INTO crm_deleted_cards (booking_id)
      SELECT b.id FROM bookings b LEFT JOIN crm_leads c ON c.booking_id = b.id
      WHERE b.id = ? AND COALESCE(c.revision, 0) = ? AND ${CRM_CARD_NOT_DELETED}
    `).run(id, revision);
    if (!result.changes) {
      return Boolean(connection.prepare("SELECT 1 FROM crm_deleted_cards WHERE booking_id = ?").get(id));
    }

    connection.prepare("DELETE FROM crm_activity WHERE booking_id = ?").run(id);
    connection.prepare("DELETE FROM crm_deal_values WHERE booking_id = ?").run(id);
    connection.prepare("DELETE FROM crm_leads WHERE booking_id = ?").run(id);
    connection.exec("COMMIT");
    return true;
  } finally {
    if (connection.isTransaction) connection.exec("ROLLBACK");
  }
}

export function readGoogleConnection() {
  return db().prepare("SELECT connection_id AS id, encrypted_token AS token FROM google_calendar_connection WHERE id = 1").get() as
    { id: string; token: string } | undefined;
}

export function writeGoogleConnection(id: string, token: string) {
  db().prepare("INSERT INTO google_calendar_connection VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET connection_id = excluded.connection_id, encrypted_token = excluded.encrypted_token")
    .run(id, token);
}

export function deleteGoogleConnection() {
  db().prepare("DELETE FROM google_calendar_connection WHERE id = 1").run();
}

export function markGoogleSynced(bookingId: string, connectionId: string, invited: boolean) {
  const connection = db();
  connection.prepare("INSERT OR IGNORE INTO google_calendar_events VALUES (?, ?)").run(bookingId, connectionId);
  if (invited) connection.prepare("INSERT OR IGNORE INTO google_calendar_invitations VALUES (?, ?)").run(bookingId, connectionId);
}
