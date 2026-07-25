import { getDb, addAuditLog } from './db';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

const activeTimers: Record<string, NodeJS.Timeout> = {};

/**
 * Start an escalation timer for an appointment.
 */
export function startEscalationTimer(appointmentId: string, io: Server, customTimeoutMs?: number) {
  clearEscalationTimer(appointmentId);

  const db = getDb();

  // We will fetch the timeout length asynchronously from clinic_config when starting the timer
  // to support dynamic dashboard configurations!
  // This satisfies: "make the window configurable from the dashboard (not hardcoded), default 5 min"
  const fetchTimeoutAndStart = async () => {
    try {
      let timeoutMs = 300000; // default 5 minutes

      if (customTimeoutMs !== undefined) {
        timeoutMs = customTimeoutMs;
      } else {
        const configRecord = await db.get("SELECT value FROM clinic_config WHERE key = 'escalation_window_seconds'");
        if (configRecord) {
          timeoutMs = parseInt(configRecord.value, 10) * 1000;
        }
      }

      console.log(`Starting escalation timer for appointment ${appointmentId} (${timeoutMs / 1000}s)`);

      const timer = setTimeout(async () => {
        try {
          // Fetch appointment to confirm status is still 'checked_in'
          const appointment = await db.get(
            'SELECT * FROM appointments WHERE id = ?',
            [appointmentId]
          );

          if (!appointment || appointment.status !== 'checked_in') {
            console.log(`Escalation timer fired for ${appointmentId} but status is now '${appointment?.status}'. No escalation.`);
            delete activeTimers[appointmentId];
            return;
          }

          // Mark appointment as escalated in DB
          await db.run(
            'UPDATE appointments SET escalated = 1 WHERE id = ?',
            [appointmentId]
          );

          // Create an escalation record
          const escalationId = uuidv4();
          const triggeredAt = new Date().toISOString();
          await db.run(
            'INSERT INTO escalations (id, appointment_id, triggered_at, status) VALUES (?, ?, ?, ?)',
            [escalationId, appointmentId, triggeredAt, 'pending']
          );

          // Write to Audit Log
          const auditRecord = await addAuditLog(
            appointmentId,
            'escalation',
            'checked_in',
            'checked_in',
            'System',
            `Escalation timer expired. Patient waited > ${timeoutMs / 1000}s.`
          );

          // Fetch the updated appointment details
          const updatedAppt = await db.get(
            `SELECT a.*, u.name as expert_name, u.email as expert_email 
             FROM appointments a 
             JOIN users u ON a.expert_id = u.id 
             WHERE a.id = ?`,
            [appointmentId]
          );

          console.log(`[ESCALATION TRIGGERED] Appointment ${appointmentId} has expired unacknowledged.`);

          // Notify through WebSockets
          io.to('staff').emit('escalation:triggered', {
            appointmentId,
            escalationId,
            triggeredAt,
            appointment: updatedAppt,
            auditLog: auditRecord
          });

          io.to(`expert:${appointment.expert_id}`).emit('escalation:triggered', {
            appointmentId,
            escalationId,
            triggeredAt,
            appointment: updatedAppt,
            auditLog: auditRecord
          });

        } catch (err) {
          console.error(`Error in escalation timer callback for appointment ${appointmentId}:`, err);
        } finally {
          delete activeTimers[appointmentId];
        }
      }, timeoutMs);

      activeTimers[appointmentId] = timer;

    } catch (err) {
      console.error(`Failed to register escalation timer for appointment ${appointmentId}:`, err);
    }
  };

  fetchTimeoutAndStart();
}

/**
 * Cancel and delete any active escalation timer for an appointment.
 */
export function clearEscalationTimer(appointmentId: string) {
  if (activeTimers[appointmentId]) {
    console.log(`Clearing escalation timer for appointment ${appointmentId}`);
    clearTimeout(activeTimers[appointmentId]);
    delete activeTimers[appointmentId];
  }
}

/**
 * Manually trigger escalation immediately (useful for debugging and mock interfaces).
 */
export async function triggerEscalationImmediately(appointmentId: string, io: Server) {
  clearEscalationTimer(appointmentId);
  
  const db = getDb();
  
  // Update DB
  await db.run(
    'UPDATE appointments SET escalated = 1 WHERE id = ?',
    [appointmentId]
  );

  const escalationId = uuidv4();
  const triggeredAt = new Date().toISOString();
  await db.run(
    'INSERT INTO escalations (id, appointment_id, triggered_at, status) VALUES (?, ?, ?, ?)',
    [escalationId, appointmentId, triggeredAt, 'pending']
  );

  // Write to Audit Log
  const auditRecord = await addAuditLog(
    appointmentId,
    'escalation',
    'checked_in',
    'checked_in',
    'System',
    'Escalation triggered manually by developer'
  );

  const updatedAppt = await db.get(
    `SELECT a.*, u.name as expert_name, u.email as expert_email 
     FROM appointments a 
     JOIN users u ON a.expert_id = u.id 
     WHERE a.id = ?`,
    [appointmentId]
  );

  console.log(`[MANUAL ESCALATION TRIGGERED] Appointment ${appointmentId}`);

  io.to('staff').emit('escalation:triggered', {
    appointmentId,
    escalationId,
    triggeredAt,
    appointment: updatedAppt,
    auditLog: auditRecord
  });

  io.to(`expert:${updatedAppt.expert_id}`).emit('escalation:triggered', {
    appointmentId,
    escalationId,
    triggeredAt,
    appointment: updatedAppt,
    auditLog: auditRecord
  });
}
