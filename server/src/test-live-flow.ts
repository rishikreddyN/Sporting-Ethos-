async function testLiveFlow() {
  console.log('--- STARTING LIVE FLOW VERIFICATION TESTS ---');
  
  const testCases = [
    {
      patientName: 'Routine Patient',
      patientEmail: 'routine@example.com',
      symptoms: 'just here for a routine checkup',
    },
    {
      patientName: 'Moderate Patient',
      patientEmail: 'moderate@example.com',
      symptoms: 'back pain for the last 3 days, getting worse',
    },
    {
      patientName: 'Emergency Patient',
      patientEmail: 'emergency@example.com',
      symptoms: 'sudden chest pain and trouble breathing',
    }
  ];

  for (const tc of testCases) {
    console.log(`\n========================================`);
    console.log(`Step 1: Creating mock appointment for [${tc.patientName}]...`);
    
    // Create Appointment
    const createRes = await fetch('http://localhost:3001/api/mock/create-appointment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientName: tc.patientName,
        patientEmail: tc.patientEmail,
        expertId: 'exp-1',
        scheduledOffsetMinutes: 10
      })
    });
    
    const createData: any = await createRes.json();
    if (!createRes.ok || !createData.success) {
      console.error(`❌ Failed to create appointment for ${tc.patientName}:`, createData);
      continue;
    }
    
    const appt = createData.appointment;
    console.log(`Appointment created: ID=${appt.id}, Token=${appt.qr_code_token}`);
    
    // Check in Patient
    console.log(`Step 2: Checking in [${tc.patientName}] with symptoms: "${tc.symptoms}"...`);
    const checkinRes = await fetch('http://localhost:3001/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appointmentId: appt.id,
        token: appt.qr_code_token,
        bypassGeofence: true,
        symptoms: tc.symptoms
      })
    });
    
    const checkinData: any = await checkinRes.json();
    if (!checkinRes.ok || !checkinData.success) {
      console.error(`❌ Check-in failed for ${tc.patientName}:`, checkinData);
      continue;
    }
    
    console.log(`Check-in confirmation received: status=${checkinData.appointment.status}`);
    
    // Wait a brief moment for AI triage to run asynchronously
    console.log(`Step 3: Waiting 3 seconds for async AI triage calculation...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  
  console.log('\n--- LIVE FLOW VERIFICATION TESTS COMPLETED ---');
}

testLiveFlow();
