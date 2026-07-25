import { API_BASE } from '../config';
import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';

function AppointmentQRCode({ token }: { token: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const checkinUrl = `${window.location.origin}/patient?token=${token}`;

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, checkinUrl, {
        width: 100,
        margin: 1,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      }, (err) => {
        if (err) console.error(err);
      });
    }
  }, [token, checkinUrl]);

  return (
    <div className="qr-code-canvas-container" style={{ display: 'inline-block' }}>
      <canvas ref={canvasRef} style={{ width: '100px', height: '100px', display: 'block', borderRadius: '4px' }} />
    </div>
  );
}


interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Appointment {
  id: string;
  patient_name: string;
  patient_email: string;
  expert_id: string;
  expert_name: string;
  scheduled_time: string;
  status: string;
  qr_code_token: string;
  qr_expires_at: string;
  escalated?: number;
}

export default function MockAdmin() {
  const [users, setUsers] = useState<User[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  
  // New Appointment Form
  const [patientName, setPatientName] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [expertId, setExpertId] = useState('');
  const [offsetMinutes, setOffsetMinutes] = useState('0'); // Scheduled for now
  
  const [creating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSentEmail, setLastSentEmail] = useState<{ url: string; token: string } | null>(null);

  const fetchLastSent = () => {
    fetch(`${API_BASE}/api/mock/last-sent-email`)
      .then(res => res.json())
      .then(data => {
        if (data.url) {
          setLastSentEmail(data);
        }
      })
      .catch(err => console.error(err));
  };

  const loadData = () => {
    fetch(`${API_BASE}/api/users`)
      .then(res => res.json())
      .then(data => {
        setUsers(data);
        const experts = data.filter((u: User) => u.role === 'expert');
        if (experts.length > 0 && !expertId) {
          setExpertId(experts[0].id);
        }
      })
      .catch(err => console.error("Error loading users", err));

    fetch(`${API_BASE}/api/appointments`)
      .then(res => res.json())
      .then(data => setAppointments(data))
      .catch(err => console.error("Error loading appointments", err));
  };

  useEffect(() => {
    loadData();
    fetchLastSent();
    const interval = setInterval(() => {
      loadData();
      fetchLastSent();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName || !expertId) return;

    setCreating(true);
    setErrorMessage(null);

    fetch(`${API_BASE}/api/mock/create-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientName,
        patientEmail: patientEmail || undefined,
        expertId,
        scheduledOffsetMinutes: parseInt(offsetMinutes, 10)
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setPatientName('');
          setPatientEmail('');
          loadData();
        } else {
          setErrorMessage(data.error || 'Failed to create appointment');
        }
      })
      .catch(err => {
        console.error(err);
        setErrorMessage('Network error creating appointment');
      })
      .finally(() => {
        setCreating(false);
      });
  };

  const handleTriggerEscalation = (appointmentId: string) => {
    fetch(`${API_BASE}/api/mock/trigger-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId })
    })
      .then(res => res.json())
      .then(data => {
        console.log(data.message);
        loadData();
      })
      .catch(err => console.error(err));
  };

  // Simulate Concurrency Check-in (Race Condition test)
  const handleSimulateConcurrency = (appointmentId: string) => {
    console.log(`[Concurrency Simulation] Triggering simultaneous dual check-in on appointment: ${appointmentId}`);

    Promise.all([
      fetch(`${API_BASE}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId,
          symptoms: 'Concurrency check-in request A (winner/loser)',
          bypassGeofence: true
        })
      }),
      fetch(`${API_BASE}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appointmentId,
          symptoms: 'Concurrency check-in request B (winner/loser)',
          bypassGeofence: true
        })
      })
    ])
      .then(async ([resA, resB]) => {
        const dataA = await resA.json();
        const dataB = await resB.json();

        const descA = resA.status === 200 ? '✅ Success (Checked in)' : `❌ Error ${resA.status} (${dataA.error}: ${dataA.message || 'Duplicate check-in blocked'})`;
        const descB = resB.status === 200 ? '✅ Success (Checked in)' : `❌ Error ${resB.status} (${dataB.error}: ${dataB.message || 'Duplicate check-in blocked'})`;

        alert(
          `💥 Concurrency Race Test Completed!\n\n` +
          `We dispatched two check-in requests at the exact same millisecond:\n\n` +
          `Request A: ${descA}\n` +
          `Request B: ${descB}\n\n` +
          `Result: The database conditional atomic UPDATE verified the slot state. Only one request succeeded, and the second was safely rejected with a status of Conflict (409).`
        );
        loadData();
      })
      .catch(err => {
        console.error('Concurrency simulation failed', err);
        alert('Test failed due to network connectivity issues.');
      });
  };

  const getStatusBadgeStyle = (status: string, escalated?: number) => {
    if (escalated === 1 && status === 'checked_in') {
      return { background: 'var(--status-escalated-bg)', color: '#fda4af', borderColor: 'var(--status-escalated)' };
    }
    
    switch (status) {
      case 'awaiting':
        return { background: 'var(--status-awaiting-bg)', color: 'var(--text-secondary)', borderColor: 'var(--status-awaiting)' };
      case 'checked_in':
        return { background: 'var(--status-checked-in-bg)', color: '#fcd34d', borderColor: 'var(--status-checked-in)' };
      case 'acknowledged':
        return { background: 'var(--status-acknowledged-bg)', color: '#93c5fd', borderColor: 'var(--status-acknowledged)' };
      case 'in_consultation':
        return { background: 'var(--status-consultation-bg)', color: '#6ee7b7', borderColor: 'var(--status-consultation)' };
      case 'completed':
        return { background: 'var(--status-completed-bg)', color: '#2dd4bf', borderColor: 'var(--status-completed)' };
      default:
        return { background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' };
    }
  };

  return (
    <div className="mock-admin-container">
      <div>
        <h1 style={{ fontSize: '1.75rem', margin: 0, fontWeight: 700 }}>
          Developer & Mock Control Panel
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Manage appointments, simulate QR code scans, and trigger real-time behaviors
        </p>
      </div>

      <div className="mock-panels">
        {/* Panel 1: Create New Mock Appointment */}
        <div className="mock-panel">
          <h2 style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>
            Book Mock Appointment
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            This generates a unique appointment record in the database with a corresponding scannable QR code token.
          </p>

          {errorMessage && (
            <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)', color: '#fda4af', padding: '0.5rem', borderRadius: '6px', fontSize: '0.75rem' }}>
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleCreateAppointment} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Patient Name</label>
              <input
                type="text"
                className="form-input"
                required
                placeholder="e.g. Bruce Wayne"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Patient Email (for Mock Audit Receipt)</label>
              <input
                type="email"
                className="form-input"
                placeholder="e.g. bruce@waynecorp.com"
                value={patientEmail}
                onChange={(e) => setPatientEmail(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Practitioner / Expert</label>
              <select
                className="form-input"
                value={expertId}
                onChange={(e) => setExpertId(e.target.value)}
              >
                {users.filter(u => u.role === 'expert').map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Time Offset Slot</label>
              <select
                className="form-input"
                value={offsetMinutes}
                onChange={(e) => setOffsetMinutes(e.target.value)}
              >
                <option value="0">Scheduled Now (0 min offset)</option>
                <option value="15">Scheduled in +15 minutes</option>
                <option value="60">Scheduled in +1 hour</option>
                <option value="-30">Scheduled -30 minutes ago (Late arrival)</option>
              </select>
            </div>

            <button type="submit" className="btn btn-primary" disabled={creating} style={{ marginTop: '0.5rem' }}>
              {creating ? 'Creating...' : 'Create Appointment'}
            </button>
          </form>
        </div>

        {/* Panel 2: Scannable Appointments and Actions */}
        <div className="mock-panel" style={{ maxHeight: '600px', overflowY: 'auto' }}>
          {lastSentEmail && (
            <div style={{ background: 'rgba(245, 158, 11, 0.04)', border: '1px dashed rgba(245, 158, 11, 0.25)', padding: '0.75rem', borderRadius: '8px', marginBottom: '1.25rem', textAlign: 'left' }}>
              <span style={{ fontSize: '0.7rem', color: '#fcd34d', fontWeight: 700, display: 'block', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                ⚡ Demo Shortcut: Last Sent QR Email
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  Token: <code>{lastSentEmail.token}</code>
                </span>
                <a 
                  href={lastSentEmail.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.65rem', padding: '0.2rem 0.4rem', textDecoration: 'none', borderColor: '#fcd34d', color: '#fcd34d' }}
                >
                  View Sent QR Email ↗
                </a>
              </div>
            </div>
          )}

          <h2 style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>
            Active Appointments Today
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Simulate a mobile scan or manipulate the timer to check notifications.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {appointments.length === 0 ? (
              <p style={{ textAlign: 'center', margin: '3rem 0', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No appointments created. Use the form on the left.
              </p>
            ) : (
              appointments.map((appt) => {
                const badgeStyle = getStatusBadgeStyle(appt.status, appt.escalated);
                return (
                  <div key={appt.id} className="mock-list-item" style={{ flexDirection: 'column', gap: '0.75rem', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong style={{ color: 'var(--text-primary)' }}>{appt.patient_name}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          With {appt.expert_name} • Slot: {new Date(appt.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <span className="mock-badge" style={{ ...badgeStyle, border: '1px solid', padding: '0.2rem 0.5rem' }}>
                        {appt.escalated === 1 && appt.status === 'checked_in' ? 'ESCALATED' : appt.status.toUpperCase()}
                      </span>
                    </div>

                    {/* QR Code Scan Simulator Container */}
                    {appt.status === 'awaiting' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.75rem', background: 'rgba(0,0,0,0.15)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                          {/* Virtual QR Code Graphic */}
                          <AppointmentQRCode token={appt.qr_code_token} />

                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              Simulate patient scanning appointment QR code
                            </span>
                            
                            <a
                              href={`/patient?token=${appt.qr_code_token}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-secondary"
                              style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', width: 'fit-content', textDecoration: 'none' }}
                            >
                              Scan QR & Check In ↗
                            </a>
                          </div>
                        </div>

                        {/* Concurrency Simulator button */}
                        <button
                          onClick={() => handleSimulateConcurrency(appt.id)}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.4rem', borderStyle: 'dashed', borderColor: 'var(--status-checked-in)', color: '#fcd34d' }}
                          title="Fires 2 checkin requests simultaneously in the same millisecond to test SQLite locking"
                        >
                          💥 Simulate Concurrency Race (Fire 2 checks)
                        </button>
                      </div>
                    )}

                    {appt.status !== 'awaiting' && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(0,0,0,0.1)', padding: '0.5rem', borderRadius: '4px' }}>
                        QR token used and invalidated. Status transitioned to <strong>{appt.status.toUpperCase()}</strong>.
                      </div>
                    )}

                    {/* Quick debug actions */}
                    {appt.status === 'checked_in' && appt.escalated !== 1 && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleTriggerEscalation(appt.id)}
                          className="btn btn-danger"
                          style={{ flex: 1, fontSize: '0.75rem', padding: '0.4rem' }}
                        >
                          ⚡ Force Escalation Now (Skip Timer)
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
