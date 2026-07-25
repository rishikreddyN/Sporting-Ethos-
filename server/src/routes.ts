import { Router, Request, Response } from 'express';
import { getDb, addAuditLog } from './db';
import { startEscalationTimer, triggerEscalationImmediately } from './escalation';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { sendQrEmail, getLastSentQr } from './email';
import { summarizeSymptoms, translateText } from './ai';

export function createRouter(io: Server): Router {
  const router = Router();

  const CLINIC_LAT = 12.9716;
  const CLINIC_LNG = 77.5946;
  const GEOFENCE_RADIUS_METERS = 200;

  function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // Get active configuration values
  router.get('/config', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const configRows = await db.all('SELECT * FROM clinic_config');
      const config: Record<string, string> = {};
      configRows.forEach(row => {
        config[row.key] = row.value;
      });
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch configurations' });
    }
  });

  // Set / Update configuration values
  router.post('/config', async (req: Request, res: Response) => {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value are required' });
    }

    try {
      const db = getDb();
      await db.run(
        'INSERT INTO clinic_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, String(value)]
      );

      console.log(`[Config Update] ${key} set to ${value}`);

      // Broadcast update via socket
      io.to('staff').emit('config:updated', { key, value: String(value) });

      res.json({ success: true, key, value: String(value) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  });

  // Get audit logs history (recent 100)
  router.get('/audit-logs', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const logs = await db.all('SELECT * FROM audit_logs ORDER BY datetime(timestamp) DESC LIMIT 100');
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });

  // Get all users (experts, staff)
  router.get('/users', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const users = await db.all('SELECT * FROM users');
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // Create / Register a new practitioner (expert)
  router.post('/users', async (req: Request, res: Response) => {
    const { name, email, role } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ error: 'name, email, and role are required' });
    }

    try {
      const db = getDb();
      const id = `exp-${uuidv4().substring(0, 8)}`;
      await db.run(
        'INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)',
        [id, name, email, role]
      );

      const newUser = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      res.json({ success: true, user: newUser });
    } catch (err: any) {
      console.error(err);
      if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(400).json({ error: 'Email address already registered' });
      }
      res.status(500).json({ error: 'Failed to register practitioner' });
    }
  });

  // Get all appointments (optionally filter by expert_id)
  router.get('/appointments', async (req: Request, res: Response) => {
    const { expert_id } = req.query;
    try {
      const db = getDb();
      let query = `
        SELECT a.*, u.name as expert_name, u.email as expert_email 
        FROM appointments a 
        JOIN users u ON a.expert_id = u.id
      `;
      const params: any[] = [];

      if (expert_id) {
        query += ' WHERE a.expert_id = ?';
        params.push(expert_id);
      }

      query += ' ORDER BY datetime(a.scheduled_time) ASC';

      const appointments = await db.all(query, params);
      res.json(appointments);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch appointments' });
    }
  });

  // Get appointment details by ID
  router.get('/appointments/:id', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const appointment = await db.get(
        `SELECT a.*, u.name as expert_name, u.email as expert_email 
         FROM appointments a 
         JOIN users u ON a.expert_id = u.id 
         WHERE a.id = ?`,
        [req.params.id]
      );
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }
      res.json(appointment);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch appointment details' });
    }
  });

  // Validate QR Code Token
  router.get('/qr-valid/:token', async (req: Request, res: Response) => {
    const { token } = req.params;
    try {
      const db = getDb();
      const appointment = await db.get(
        `SELECT a.*, u.name as expert_name, u.email as expert_email 
         FROM appointments a 
         JOIN users u ON a.expert_id = u.id 
         WHERE a.qr_code_token = ?`,
        [token]
      );

      if (!appointment) {
        return res.json({ valid: false, reason: 'Invalid check-in code' });
      }

      const now = new Date();
      const scheduledTime = new Date(appointment.scheduled_time);
      const expiresAt = new Date(appointment.qr_expires_at);

      const windowStart = new Date(scheduledTime.getTime() - 2 * 60 * 60 * 1000); // 2 hours prior

      if (now < windowStart) {
        return res.json({
          valid: false,
          reason: `Too early. Check-in opens at ${windowStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        });
      }

      if (now > expiresAt) {
        return res.json({
          valid: false,
          reason: 'This check-in code has expired'
        });
      }

      if (appointment.status !== 'awaiting') {
        return res.json({
          valid: false,
          reason: `Already checked in (Current Status: ${appointment.status})`
        });
      }

      res.json({
        valid: true,
        appointment
      });
    } catch (err) {
      res.status(500).json({ error: 'Database check failed' });
    }
  });

  // Submit Patient Check-In (Safeguarded against Race Conditions/Concurrency)
  router.post('/checkin', async (req: Request, res: Response) => {
    const { appointmentId, symptoms, lat, lng, bypassGeofence } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ error: 'Appointment ID is required' });
    }

    try {
      const db = getDb();

      // Fetch appointment to check validity
      const appointment = await db.get(
        'SELECT * FROM appointments WHERE id = ?',
        [appointmentId]
      );

      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found' });
      }

      if (appointment.status !== 'awaiting') {
        return res.status(409).json({ error: 'CONCURRENCY_ERROR', message: 'Duplicate check-in. Already checked in.' });
      }

      // Check time-bound window limits
      const now = new Date();
      const scheduledTime = new Date(appointment.scheduled_time);
      const expiresAt = new Date(appointment.qr_expires_at);
      const windowStart = new Date(scheduledTime.getTime() - 2 * 60 * 60 * 1000); // 2 hours prior

      if (now < windowStart) {
        return res.status(400).json({
          error: 'QR_VALIDATION_ERROR',
          message: `Too early. Check-in opens at ${windowStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        });
      }

      if (now > expiresAt) {
        return res.status(400).json({
          error: 'QR_VALIDATION_ERROR',
          message: 'This check-in code has expired.'
        });
      }

      // Geofence check first
      if (!bypassGeofence) {
        if (lat === undefined || lng === undefined) {
          return res.status(400).json({
            error: 'GEOFENCE_ERROR',
            message: 'Unable to verify location. Geolocation permission is required to check in.'
          });
        }
        const distance = calculateDistance(lat, lng, CLINIC_LAT, CLINIC_LNG);
        if (distance > GEOFENCE_RADIUS_METERS) {
          return res.status(400).json({
            error: 'GEOFENCE_ERROR',
            message: `You must be on-site to check in. (Distance to clinic: ${Math.round(distance)}m. Limit: ${GEOFENCE_RADIUS_METERS}m)`
          });
        }
      }

      const checkedInAt = new Date().toISOString();

      // CONCURRENCY SAFETY UPDATE:
      // Perform atomic database update, checking that the status is STILL 'awaiting'
      // If changes === 0, it means another request checked in this appointment in the same second!
      const updateResult = await db.run(
        `UPDATE appointments 
         SET status = 'checked_in', checked_in_at = ?, symptoms = ? 
         WHERE id = ? AND status = 'awaiting'`,
        [checkedInAt, symptoms || '', appointmentId]
      );

      if (updateResult.changes === 0) {
        console.log(`[CONCURRENCY BLOCK] Prevented race condition check-in on appointment ${appointmentId}`);
        return res.status(409).json({ 
          error: 'CONCURRENCY_ERROR', 
          message: 'This appointment has already been checked in. Duplicate check-in prevented.' 
        });
      }

      // Write check_in audit record
      const checkInId = uuidv4();
      await db.run(
        `INSERT INTO check_ins (id, appointment_id, checked_in_at, symptoms, location_lat, location_lng)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [checkInId, appointmentId, checkedInAt, symptoms || '', lat || null, lng || null]
      );

      // Write to Audit Logs!
      const auditRecord = await addAuditLog(
        appointmentId,
        'check_in',
        'awaiting',
        'checked_in',
        'Patient (Form)',
        symptoms ? `Self check-in completed. Symptoms: "${symptoms}"` : 'Self check-in completed.'
      );

      // Fetch the updated record
      const updatedAppt = await db.get(
        `SELECT a.*, u.name as expert_name, u.email as expert_email 
         FROM appointments a 
         JOIN users u ON a.expert_id = u.id 
         WHERE a.id = ?`,
        [appointmentId]
      );

      console.log(`[CHECKIN SUCCESS] Appointment ${appointmentId} checked in at ${checkedInAt}`);

      // Push real-time event via Socket.IO
      io.to('staff').emit('patient:checked-in', updatedAppt);
      io.to(`expert:${updatedAppt.expert_id}`).emit('patient:checked-in', updatedAppt);
      
      // Broadcast the audit log
      io.to('staff').emit('audit:new-log', auditRecord);

      // Start the escalation timer
      const customTimeout = req.body.testTimeoutMs;
      startEscalationTimer(appointmentId, io, customTimeout);

      // Trigger ASYNC confirmation email stub (Fires asynchronously after check-in, never blocking!)
      const triggerAsyncEmail = async () => {
        console.log(`[ASYNC EMAIL CONFIRMATION] Sending async checked-in email receipt to ${updatedAppt.patient_name} (${updatedAppt.patient_email})`);
        // Simulating mock network call
        await new Promise((resolve) => setTimeout(resolve, 800));
        console.log(`[ASYNC EMAIL CONFIRMATION] Stub Email successfully sent to ${updatedAppt.patient_email} (Audit Record ID: ${checkInId})`);
      };

      // Execute asynchronously, catch errors so it doesn't crash the check-in response
      triggerAsyncEmail().catch(err => console.error("Async confirmation email failed", err));

      // Run AI triage asynchronously and non-blockingly
      const triggerAsyncAiTriage = async () => {
        try {
          const aiResult = await summarizeSymptoms(symptoms || '');
          if (aiResult) {
            console.log(`[AI Triage Success] for appointment ${appointmentId}:`, aiResult);
            // Save to database
            await db.run(
              'UPDATE appointments SET ai_summary = ?, ai_urgency = ?, ai_reasoning = ? WHERE id = ?',
              [aiResult.summary, aiResult.urgency, aiResult.reasoning, appointmentId]
            );
            // Fetch updated appointment
            const finalAppt = await db.get(
              `SELECT a.*, u.name as expert_name, u.email as expert_email 
               FROM appointments a 
               JOIN users u ON a.expert_id = u.id 
               WHERE a.id = ?`,
              [appointmentId]
            );
            // Broadcast update to doctor / staff dashboards
            io.to('staff').emit('appointment:updated', finalAppt);
            io.to(`expert:${finalAppt.expert_id}`).emit('appointment:updated', finalAppt);
          }
        } catch (err) {
          console.error('[AI Triage Error] failed in background task:', err);
        }
      };

      triggerAsyncAiTriage().catch(err => console.error("Async AI triage failed", err));

      res.json({
        success: true,
        checkedInAt,
        appointment: updatedAppt
      });

    } catch (err) {
      console.error('Checkin failed:', err);
      res.status(500).json({ error: 'Check-in submission failed' });
    }
  });

  // DEVELOPER API: Create a new mock appointment dynamically
  router.post('/mock/create-appointment', async (req: Request, res: Response) => {
    const { patientName, patientEmail, expertId, scheduledOffsetMinutes } = req.body;

    if (!patientName || !expertId) {
      return res.status(400).json({ error: 'patientName and expertId are required' });
    }

    try {
      const db = getDb();
      const apptId = `appt-${uuidv4().substring(0, 8)}`;
      const token = `token-${uuidv4().substring(0, 8)}`;

      const scheduledTime = new Date();
      scheduledTime.setMinutes(scheduledTime.getMinutes() + (scheduledOffsetMinutes || 0));

      const expiresTime = new Date(scheduledTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours expiration

      await db.run(
        `INSERT INTO appointments (id, patient_name, patient_email, expert_id, scheduled_time, status, qr_code_token, qr_expires_at) 
         VALUES (?, ?, ?, ?, ?, 'awaiting', ?, ?)`,
        [apptId, patientName, patientEmail || 'mock@example.com', expertId, scheduledTime.toISOString(), token, expiresTime.toISOString()]
      );

      const newAppt = await db.get(
        `SELECT a.*, u.name as expert_name, u.email as expert_email 
         FROM appointments a 
         JOIN users u ON a.expert_id = u.id 
         WHERE a.id = ?`,
        [apptId]
      );

      // Send QR Code Email asynchronously using the configured SMTP service
      sendQrEmail(
        patientEmail || 'mock@example.com',
        patientName,
        newAppt.expert_name,
        newAppt.scheduled_time,
        token,
        newAppt.id
      ).catch(err => console.error('Failed to send QR code email', err));

      res.json({
        success: true,
        appointment: newAppt
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create mock appointment' });
    }
  });

  // DEVELOPER API: Get last sent email details
  router.get('/mock/last-sent-email', (req: Request, res: Response) => {
    const lastSent = getLastSentQr();
    res.json(lastSent);
  });

  // DEVELOPER API: Trigger escalation immediately for a check-in
  router.post('/mock/trigger-escalation', async (req: Request, res: Response) => {
    const { appointmentId } = req.body;
    if (!appointmentId) {
      return res.status(400).json({ error: 'appointmentId is required' });
    }

    try {
      await triggerEscalationImmediately(appointmentId, io);
      res.json({ success: true, message: 'Escalation triggered immediately' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to trigger escalation' });
    }
  });

  // GET endpoint to proxy TTS audio requests (bypasses browser referrer blocks)
  router.get('/tts', async (req: Request, res: Response) => {
    const text = req.query.text as string;
    const lang = (req.query.lang as string) || 'hi';

    if (!text) {
      return res.status(400).json({ error: 'text parameter is required' });
    }

    try {
      const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;
      const response = await fetch(googleTtsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: 'TTS generation failed' });
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=86400'
      });

      res.send(buffer);
    } catch (err) {
      console.error('[TTS Proxy Error]:', err);
      res.status(500).json({ error: 'TTS audio proxy error' });
    }
  });

  // POST endpoint to translate text using Groq
  router.post('/translate', async (req: Request, res: Response) => {
    const { text, targetLanguage } = req.body;
    if (!text || !targetLanguage) {
      return res.status(400).json({ error: 'text and targetLanguage are required' });
    }

    try {
      const translated = await translateText(text, targetLanguage);
      res.json({ translated });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Translation failed' });
    }
  });

  return router;
}
