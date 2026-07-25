import { Server, Socket } from 'socket.io';
import { getDb, addAuditLog } from './db';
import { clearEscalationTimer } from './escalation';

export function setupSockets(io: Server) {
  io.on('connection', (socket: Socket) => {
    console.log(`Socket client connected: ${socket.id}`);

    socket.on('join', (data: { role: string; userId?: string }) => {
      const { role, userId } = data;
      console.log(`Socket ${socket.id} joining room role=${role}, userId=${userId}`);
      
      if (role === 'staff' || role === 'supervisor') {
        socket.join('staff');
      }
      
      if (userId) {
        socket.join(`expert:${userId}`);
      }
    });

    // Handle expert/staff acknowledging a checked-in patient
    socket.on('appointment:acknowledge', async (data: { appointmentId: string; actorId: string }) => {
      const { appointmentId, actorId } = data;
      try {
        const db = getDb();
        console.log(`[Socket Action] Appointment ${appointmentId} acknowledged by ${actorId}`);

        // Get actor name
        const actor = await db.get('SELECT name FROM users WHERE id = ?', [actorId]);
        const actorName = actor?.name || 'Clinic Staff';

        // Clear the escalation timer
        clearEscalationTimer(appointmentId);

        // Fetch current status before update for logging
        const originalAppt = await db.get('SELECT status FROM appointments WHERE id = ?', [appointmentId]);
        const prevStatus = originalAppt?.status || 'checked_in';

        // Update appointment status and escalation status
        await db.run(
          `UPDATE appointments 
           SET status = 'acknowledged', escalated = 0 
           WHERE id = ?`,
          [appointmentId]
        );

        // Update escalation log if any is pending
        await db.run(
          `UPDATE escalations 
           SET status = 'resolved', resolved_at = ? 
           WHERE appointment_id = ? AND status = 'pending'`,
          [new Date().toISOString(), appointmentId]
        );

        // Add to transition Audit Log
        const auditRecord = await addAuditLog(
          appointmentId,
          'acknowledge',
          prevStatus,
          'acknowledged',
          actorName,
          `Awaiting patient called into consult room`
        );

        // Fetch updated appointment details with expert data
        const appointment = await db.get(
          `SELECT a.*, u.name as expert_name, u.email as expert_email 
           FROM appointments a 
           JOIN users u ON a.expert_id = u.id 
           WHERE a.id = ?`,
          [appointmentId]
        );

        // Broadcast status update
        io.to('staff').emit('appointment:updated', appointment);
        if (appointment) {
          io.to(`expert:${appointment.expert_id}`).emit('appointment:updated', appointment);
        }

        // Broadcast new audit log to waiting rooms / dashboards
        io.to('staff').emit('audit:new-log', auditRecord);

      } catch (err) {
        console.error(`Failed to acknowledge appointment ${appointmentId}:`, err);
        socket.emit('error', { message: 'Failed to acknowledge appointment' });
      }
    });

    // Handle starting a consultation
    socket.on('appointment:start-consultation', async (data: { appointmentId: string }) => {
      const { appointmentId } = data;
      try {
        const db = getDb();
        console.log(`[Socket Action] Appointment ${appointmentId} consultation started`);

        // Fetch appt to log previous status and find expert name
        const appt = await db.get(
          `SELECT a.status, u.name as expert_name 
           FROM appointments a 
           JOIN users u ON a.expert_id = u.id 
           WHERE a.id = ?`,
          [appointmentId]
        );
        const prevStatus = appt?.status || 'acknowledged';
        const expertName = appt?.expert_name || 'Practitioner';

        await db.run(
          `UPDATE appointments SET status = 'in_consultation' WHERE id = ?`,
          [appointmentId]
        );

        // Write Audit Log
        const auditRecord = await addAuditLog(
          appointmentId,
          'start_consultation',
          prevStatus,
          'in_consultation',
          expertName,
          'Consultation session started'
        );

        const appointment = await db.get(
          `SELECT a.*, u.name as expert_name, u.email as expert_email 
           FROM appointments a 
           JOIN users u ON a.expert_id = u.id 
           WHERE a.id = ?`,
          [appointmentId]
        );

        io.to('staff').emit('appointment:updated', appointment);
        if (appointment) {
          io.to(`expert:${appointment.expert_id}`).emit('appointment:updated', appointment);
        }

        // Broadcast new audit log
        io.to('staff').emit('audit:new-log', auditRecord);

      } catch (err) {
        console.error(`Failed to start consultation ${appointmentId}:`, err);
        socket.emit('error', { message: 'Failed to start consultation' });
      }
    });

    // Handle completing a consultation
    socket.on('appointment:complete', async (data: { appointmentId: string }) => {
      const { appointmentId } = data;
      try {
        const db = getDb();
        console.log(`[Socket Action] Appointment ${appointmentId} completed`);

        // Fetch appt details for audit logging
        const appt = await db.get(
          `SELECT a.status, u.name as expert_name 
           FROM appointments a 
           JOIN users u ON a.expert_id = u.id 
           WHERE a.id = ?`,
          [appointmentId]
        );
        const prevStatus = appt?.status || 'in_consultation';
        const expertName = appt?.expert_name || 'Practitioner';

        await db.run(
          `UPDATE appointments SET status = 'completed' WHERE id = ?`,
          [appointmentId]
        );

        // Write Audit Log
        const auditRecord = await addAuditLog(
          appointmentId,
          'complete',
          prevStatus,
          'completed',
          expertName,
          'Session finalized successfully'
        );

        const appointment = await db.get(
          `SELECT a.*, u.name as expert_name, u.email as expert_email 
           FROM appointments a 
           JOIN users u ON a.expert_id = u.id 
           WHERE a.id = ?`,
          [appointmentId]
        );

        io.to('staff').emit('appointment:updated', appointment);
        if (appointment) {
          io.to(`expert:${appointment.expert_id}`).emit('appointment:updated', appointment);
        }

        // Broadcast new audit log
        io.to('staff').emit('audit:new-log', auditRecord);

      } catch (err) {
        console.error(`Failed to complete appointment ${appointmentId}:`, err);
        socket.emit('error', { message: 'Failed to complete appointment' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket client disconnected: ${socket.id}`);
    });
  });
}
