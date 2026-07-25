import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = path.join(__dirname, '../patient_checkin.db');

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'expert' | 'staff' | 'supervisor';
}

export interface Appointment {
  id: string;
  patient_name: string;
  patient_email: string;
  expert_id: string;
  scheduled_time: string;
  status: 'awaiting' | 'checked_in' | 'acknowledged' | 'in_consultation' | 'completed';
  qr_code_token: string;
  qr_expires_at: string;
  symptoms?: string;
  checked_in_at?: string;
  escalated?: number; // 0 or 1
}

export interface AuditLog {
  id: string;
  appointment_id: string;
  patient_name: string;
  event_type: string;
  previous_status: string;
  new_status: string;
  actor_name: string;
  timestamp: string;
  details?: string;
}

let db: Database<sqlite3.Database, sqlite3.Statement>;

export async function initDb(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await db.run('PRAGMA foreign_keys = ON');

  // Create Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('expert', 'staff', 'supervisor'))
    )
  `);

  // Create Appointments table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_name TEXT NOT NULL,
      patient_email TEXT NOT NULL,
      expert_id TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('awaiting', 'checked_in', 'acknowledged', 'in_consultation', 'completed')) DEFAULT 'awaiting',
      qr_code_token TEXT NOT NULL UNIQUE,
      qr_expires_at TEXT NOT NULL,
      symptoms TEXT,
      checked_in_at TEXT,
      escalated INTEGER DEFAULT 0 CHECK(escalated IN (0, 1)),
      FOREIGN KEY (expert_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create Check-ins table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS check_ins (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL UNIQUE,
      checked_in_at TEXT NOT NULL,
      symptoms TEXT,
      location_lat REAL,
      location_lng REAL,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    )
  `);

  // Create Escalations table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      resolved_at TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'resolved')) DEFAULT 'pending',
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
    )
  `);

  // [NEW] Clinic Config table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // [NEW] Audit Logs table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details TEXT
    )
  `);

  // Seed default configuration value if not exists
  const configCheck = await db.get("SELECT COUNT(*) as count FROM clinic_config WHERE key = 'escalation_window_seconds'");
  if (configCheck && (configCheck as any).count === 0) {
    await db.run("INSERT INTO clinic_config (key, value) VALUES ('escalation_window_seconds', '300')");
  }

  // Seed mock users if empty
  const userCount = await db.get('SELECT COUNT(*) as count FROM users');
  if (userCount && (userCount as any).count === 0) {
    console.log('Seeding database with clinic doctors...');
    
    const experts: User[] = [
      { id: 'exp-1', name: 'Dr. Parth Patil', email: 'parth.patil@sportingethos.com', role: 'expert' },
      { id: 'exp-2', name: 'Dr. Shilpa',      email: 'shilpa@sportingethos.com',      role: 'expert' },
      { id: 'exp-3', name: 'Dr. Nishith',     email: 'nishith@sportingethos.com',     role: 'expert' },
    ];

    for (const u of experts) {
      await db.run('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)', [u.id, u.name, u.email, u.role]);
    }

    console.log('Database seeding complete.');
  }

  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized! Call initDb() first.');
  }
  return db;
}

/**
 * Add a status transition or escalation event into the audit logs.
 */
export async function addAuditLog(
  appointmentId: string,
  eventType: 'check_in' | 'acknowledge' | 'start_consultation' | 'complete' | 'escalation',
  prevStatus: string,
  newStatus: string,
  actorName: string,
  details?: string
): Promise<AuditLog> {
  const database = getDb();
  let patientName = 'Unknown';

  const appt = await database.get('SELECT patient_name FROM appointments WHERE id = ?', [appointmentId]);
  if (appt) {
    patientName = appt.patient_name;
  }

  const logRecord: AuditLog = {
    id: uuidv4(),
    appointment_id: appointmentId,
    patient_name: patientName,
    event_type: eventType,
    previous_status: prevStatus,
    new_status: newStatus,
    actor_name: actorName,
    timestamp: new Date().toISOString(),
    details: details || undefined
  };

  await database.run(
    `INSERT INTO audit_logs (id, appointment_id, patient_name, event_type, previous_status, new_status, actor_name, timestamp, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      logRecord.id,
      logRecord.appointment_id,
      logRecord.patient_name,
      logRecord.event_type,
      logRecord.previous_status,
      logRecord.new_status,
      logRecord.actor_name,
      logRecord.timestamp,
      logRecord.details || null
    ]
  );

  return logRecord;
}
