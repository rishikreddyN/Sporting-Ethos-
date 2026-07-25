import { initDb, getDb } from './db';
import { clearEscalationTimer } from './escalation';

async function runTests() {
  console.log('=== STARTING PATIENT CHECK-IN SYSTEM INTEGRATION TESTS (PHASE 2) ===');
  
  // 1. Initialize DB connection
  await initDb();
  const db = getDb();
  console.log('✓ Database connected.');

  // Reset database state for clean run
  const nowTime = new Date();
  const oneHourAgo = new Date(nowTime.getTime() - 1 * 60 * 60 * 1000).toISOString();
  const twoHoursLater = new Date(nowTime.getTime() + 2 * 60 * 60 * 1000).toISOString();
  await db.run(
    "UPDATE appointments SET status = 'awaiting', escalated = 0, checked_in_at = NULL, symptoms = NULL, scheduled_time = ?, qr_expires_at = ?",
    [oneHourAgo, twoHoursLater]
  );
  await db.run("DELETE FROM check_ins");
  await db.run("DELETE FROM escalations");
  await db.run("DELETE FROM audit_logs");
  await db.run("UPDATE clinic_config SET value = '300' WHERE key = 'escalation_window_seconds'");
  console.log('✓ Database cleaned and reset to awaiting.');

  // 2. Test Fetching appointments
  const appts = await db.all("SELECT * FROM appointments");
  if (appts.length === 0) {
    throw new Error("No appointments found in database. Seed failed.");
  }
  console.log(`✓ Fetched ${appts.length} appointments from DB.`);

  // 3. Test Configuration GET/POST APIs
  console.log('Testing Configuration API endpoints...');
  
  // Fetch default config
  const configRes = await fetch('http://localhost:3001/api/config');
  const config = await configRes.json();
  if (config.escalation_window_seconds !== '300') {
    throw new Error(`Expected default escalation limit to be '300', but got '${config.escalation_window_seconds}'`);
  }
  console.log('✓ Default config retrieved successfully (300 seconds).');

  // Change config via API to 10 seconds
  const configUpdateRes = await fetch('http://localhost:3001/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'escalation_window_seconds', value: '10' })
  });
  const configUpdateData = await configUpdateRes.json();
  if (!configUpdateRes.ok || configUpdateData.value !== '10') {
    throw new Error(`Config update failed: ${JSON.stringify(configUpdateData)}`);
  }
  console.log('✓ Config updated successfully to 10 seconds.');

  // 4. Test Concurrency checks (firing two parallel check-ins at once)
  const testAppt = appts[0];
  console.log(`Testing Check-in Concurrency (Race Condition) for patient: ${testAppt.patient_name}`);

  const checkinRequests = await Promise.all([
    fetch('http://localhost:3001/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId: testAppt.id, symptoms: 'Concurrency test request 1', bypassGeofence: true })
    }),
    fetch('http://localhost:3001/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId: testAppt.id, symptoms: 'Concurrency test request 2', bypassGeofence: true })
    })
  ]);

  const status1 = checkinRequests[0].status;
  const status2 = checkinRequests[1].status;
  const data1 = await checkinRequests[0].json();
  const data2 = await checkinRequests[1].json();

  console.log(`Request 1 completed with Status: ${status1}`);
  console.log(`Request 2 completed with Status: ${status2}`);

  // One request must succeed (200), and the other must fail with conflict (409)
  const okCount = (status1 === 200 ? 1 : 0) + (status2 === 200 ? 1 : 0);
  const conflictCount = (status1 === 409 ? 1 : 0) + (status2 === 409 ? 1 : 0);

  if (okCount !== 1 || conflictCount !== 1) {
    throw new Error(`Concurrency race test failed! Expected 1 success and 1 Conflict, but got: Successes=${okCount}, Conflicts=${conflictCount}`);
  }
  console.log('✓ Check-in Concurrency Race successfully resolved. Only one request succeeded, and duplicate check-in was blocked with 409 Conflict.');

  // 5. Verify Check-in Audit Logs were created
  const checkinLogs = await db.all("SELECT * FROM audit_logs WHERE event_type = 'check_in'");
  if (checkinLogs.length !== 1) {
    throw new Error(`Expected exactly 1 check_in audit log, found: ${checkinLogs.length}`);
  }
  console.log(`✓ Audit log verified: check_in event logged correctly. Patient name: ${checkinLogs[0].patient_name}`);

  // 6. Test Escalation timer (with custom short timeout of 500ms)
  console.log('Submitting check-in for second appointment to test escalation log...');
  const testAppt2 = appts[1];
  const checkin2Res = await fetch('http://localhost:3001/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appointmentId: testAppt2.id,
      symptoms: 'Back pain',
      bypassGeofence: true,
      testTimeoutMs: 500 // 500ms escalation timer
    })
  });
  if (!checkin2Res.ok) {
    throw new Error('Failed to check in second appointment.');
  }

  console.log('Waiting 1 second for escalation timer to trigger...');
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify status in DB is escalated and audit log exists
  const dbAppt2 = await db.get("SELECT * FROM appointments WHERE id = ?", [testAppt2.id]);
  if (dbAppt2.escalated !== 1) {
    throw new Error('Second appointment was not escalated by timer.');
  }

  const escalationLogs = await db.all("SELECT * FROM audit_logs WHERE event_type = 'escalation' AND appointment_id = ?", [testAppt2.id]);
  if (escalationLogs.length !== 1) {
    throw new Error(`Expected 1 escalation audit log, found: ${escalationLogs.length}`);
  }
  console.log(`✓ Audit log verified: escalation event logged. Details: "${escalationLogs[0].details}"`);

  // Clean up
  clearEscalationTimer(testAppt.id);
  clearEscalationTimer(testAppt2.id);

  // Restore DB to clean state for developer manual checks
  await db.run("UPDATE appointments SET status = 'awaiting', escalated = 0, checked_in_at = NULL, symptoms = NULL");
  await db.run("DELETE FROM check_ins");
  await db.run("DELETE FROM escalations");
  await db.run("DELETE FROM audit_logs");
  await db.run("UPDATE clinic_config SET value = '300' WHERE key = 'escalation_window_seconds'");
  console.log('✓ Database cleaned and restored to awaiting.');

  console.log('=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('❌ INTEGRATION TEST FAILED:', err);
  process.exit(1);
});
