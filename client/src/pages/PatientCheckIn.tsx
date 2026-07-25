import { API_BASE } from '../config';
import { useState, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

// Hardcoded clinic coords
const CLINIC_LAT = 12.9716;
const CLINIC_LNG = 77.5946;

interface PatientCheckInProps {
  token: string | null;
  preName?: string | null;
  preTime?: string | null;
  prePatientId?: string | null;
}

interface AppointmentDetails {
  id: string;
  patient_name: string;
  patient_email: string;
  expert_name: string;
  scheduled_time: string;
  status: string;
  qr_code_token: string;
}

export default function PatientCheckIn({ 
  token,
  preName,
  preTime,
  prePatientId
}: PatientCheckInProps) {
  const [scanToken, setScanToken] = useState<string | null>(token);
  const [loading, setLoading] = useState<boolean>(() => {
    if (token && !preName) return true;
    return false;
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [appointment, setAppointment] = useState<AppointmentDetails | null>(() => {
    if (preName && preTime && prePatientId && token) {
      return {
        id: prePatientId,
        patient_name: preName,
        patient_email: '',
        expert_name: 'Verifying...',
        scheduled_time: preTime,
        status: 'awaiting',
        qr_code_token: token
      };
    }
    return null;
  });
  const [awaitingAppts, setAwaitingAppts] = useState<AppointmentDetails[]>([]);

  // Geolocation states
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'prompt' | 'fetching' | 'success' | 'denied' | 'error'>('prompt');
  const [distanceToClinic, setDistanceToClinic] = useState<number | null>(null);
  
  // Check-in input
  const [symptoms, setSymptoms] = useState<string>('');
  const [bypassGeofence, setBypassGeofence] = useState<boolean>(true); // Default to true for dev simulation
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [checkinSuccess, setCheckinSuccess] = useState<boolean>(false);
  const [checkinTime, setCheckinTime] = useState<string>('');

  // Calculate distance
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // meters
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Fetch geolocation
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('error');
      return;
    }
    
    setLocationStatus('fetching');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCoords({ lat: latitude, lng: longitude });
        setLocationStatus('success');
        const dist = calculateDistance(latitude, longitude, CLINIC_LAT, CLINIC_LNG);
        setDistanceToClinic(Math.round(dist));
      },
      (error) => {
        console.error('Geolocation failed', error);
        setLocationStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  // Fetch awaiting appointments on scanner load (for manual dev selector fallback)
  useEffect(() => {
    if (!scanToken) {
      fetch(`${API_BASE}/api/appointments`)
        .then(res => res.json())
        .then(data => {
          const awaiting = data.filter((a: any) => a.status === 'awaiting');
          setAwaitingAppts(awaiting);
        })
        .catch(err => console.error("Error fetching awaiting appts", err));
    }
  }, [scanToken]);

  // Webcam QR scanner logic
  useEffect(() => {
    if (scanToken) return;

    const scanner = new Html5QrcodeScanner(
      'reader',
      { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true
      },
      /* verbose= */ false
    );

    const onScanSuccess = (decodedText: string) => {
      console.log('Scanned text:', decodedText);
      let extractedToken = decodedText;
      let nameParam: string | null = null;
      let timeParam: string | null = null;
      let patientIdParam: string | null = null;

      try {
        if (decodedText.startsWith('http://') || decodedText.startsWith('https://')) {
          const url = new URL(decodedText);
          extractedToken = url.searchParams.get('token') || decodedText;
          nameParam = url.searchParams.get('name');
          timeParam = url.searchParams.get('time');
          patientIdParam = url.searchParams.get('patientId');
        }
      } catch (e) {
        console.error('Failed to parse URL', e);
      }

      scanner.clear().catch(err => console.error('Failed to clear scanner', err));

      if (nameParam && timeParam && patientIdParam) {
        setAppointment({
          id: patientIdParam,
          patient_name: nameParam,
          patient_email: '',
          expert_name: 'Verifying...',
          scheduled_time: timeParam,
          status: 'awaiting',
          qr_code_token: extractedToken
        });
        setLoading(false);
      } else {
        setLoading(true);
      }
      setScanToken(extractedToken);
    };

    const onScanFailure = () => {
      // Quiet ignore fails during continuous camera frames
    };

    scanner.render(onScanSuccess, onScanFailure);

    return () => {
      scanner.clear().catch(err => console.log('Scanner clear cleanup:', err));
    };
  }, [scanToken]);

  // Validate token once scanner outputs token or URL query is matched
  useEffect(() => {
    if (!scanToken) return;

    setErrorMsg(null);
    requestLocation();

    fetch(`${API_BASE}/api/qr-valid/${scanToken}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setAppointment(data.appointment);
        } else {
          setErrorMsg(data.reason || 'Invalid or expired check-in code.');
        }
      })
      .catch((err) => {
        console.error('Validation error', err);
        setErrorMsg('Network error validating code. Please check server connections.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [scanToken]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointment) return;

    setSubmitting(true);
    setErrorMsg(null);

    const payload = {
      appointmentId: appointment.id,
      symptoms,
      lat: coords?.lat,
      lng: coords?.lng,
      bypassGeofence
    };

    fetch(`${API_BASE}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setCheckinSuccess(true);
          setCheckinTime(new Date(data.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } else {
          if (data.error === 'GEOFENCE_ERROR') {
            setErrorMsg(data.message);
          } else {
            setErrorMsg(data.message || data.error || 'Check-in failed');
          }
        }
      })
      .catch((err) => {
        console.error('Submit error', err);
        setErrorMsg('Network error. Check-in submission failed.');
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  const handleResetScanner = () => {
    setScanToken(null);
    setAppointment(null);
    setErrorMsg(null);
    setCheckinSuccess(false);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="patient-card-container">
        <div className="patient-card">
          <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
          <p>Verifying check-in code...</p>
        </div>
      </div>
    );
  }

  // Scanner landing page viewport if no token is resolved
  if (!scanToken) {
    return (
      <div className="patient-card-container">
        <div className="patient-card" style={{ maxWidth: '440px' }}>
          <div className="patient-header">
            <div className="patient-logo">⚡</div>
            <h2>Sporting Ethos</h2>
            <p>Scan your appointment QR code to check in</p>
          </div>

          {/* Scanner Viewport */}
          <div className="scanner-viewport-wrapper">
            <div className="scanner-viewport">
              <div id="reader" style={{ width: '100%', border: 'none' }} />
              <div className="scanner-laser-line" />
              <div className="scanner-corner-guides" />
            </div>
          </div>
          <div className="scanner-hint-banner">
            Align check-in QR code inside framing guide
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '2.5rem', borderTop: '1px dashed var(--border-glass)', paddingTop: '1.25rem' }}>
            <div style={{ textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 700, textAlign: 'center' }}>
              🔧 Developer Simulation tools
            </div>

            {/* Awaiting patient selection dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Select an Awaiting Patient:
              </label>
              <select
                className="form-input"
                onChange={(e) => {
                  if (e.target.value) {
                    setScanToken(e.target.value);
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>-- Select a booked patient --</option>
                {awaitingAppts.map(appt => (
                  <option key={appt.id} value={appt.qr_code_token}>
                    {appt.patient_name} (with {appt.expert_name})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Enter qr_code_token manually"
                id="manual-token-input"
                style={{ fontSize: '0.8125rem', flex: 1 }}
              />
              <button
                className="btn btn-secondary"
                style={{ padding: '0.65rem 1rem' }}
                onClick={() => {
                  const input = document.getElementById('manual-token-input') as HTMLInputElement;
                  if (input && input.value.trim()) {
                    setScanToken(input.value.trim());
                  }
                }}
              >
                Bypass
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (checkinSuccess && appointment) {
    return (
      <div className="patient-card-container">
        <div className="patient-card">
          <div className="success-checkmark">
            <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
              <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
              <path className="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
          </div>
          
          <h2 style={{ marginBottom: '0.5rem' }}>Check-in Confirmed!</h2>
          <p style={{ color: '#a7f3d0', fontWeight: 600, fontSize: '1.125rem', marginBottom: '1.5rem' }}>
            Success at {checkinTime}
          </p>
          
          <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-glass)', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Patient Name</p>
            <p style={{ fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>{appointment.patient_name}</p>
            
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Assigned Expert</p>
            <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{appointment.expert_name}</p>
          </div>

          <p style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            Thank you for checking in. Please proceed to the waiting area. Your practitioner has been notified of your arrival.
          </p>

          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={handleResetScanner}>
            Back to Scanner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="patient-card-container">
      <div className="patient-card">
        <div className="patient-header">
          <div className="patient-logo">⚡</div>
          <h2>Sporting Ethos</h2>
          <p>High Performance Centre Check-In</p>
        </div>

        {errorMsg && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.3)', color: '#fda4af', padding: '0.75rem', borderRadius: '8px', fontSize: '0.875rem', textAlign: 'left' }}>
              <strong>Check-in Issue:</strong> {errorMsg}
            </div>
            <button className="btn btn-secondary" onClick={handleResetScanner} style={{ marginBottom: '1rem' }}>
              Back to Scanner
            </button>
          </div>
        )}

        {appointment && !errorMsg ? (
          <form onSubmit={handleSubmit}>
            <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.03)', padding: '1.25rem', borderRadius: '8px', border: '1px solid var(--border-glass)', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Appointment Summary</h3>
              <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{appointment.patient_name}</p>
              <p style={{ fontSize: '0.875rem' }}>
                With: <strong style={{ color: 'var(--accent-color)' }}>{appointment.expert_name}</strong>
              </p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Slot: {new Date(appointment.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {/* Geofence Status */}
            {locationStatus === 'fetching' && (
              <div className="location-banner location-warning">
                <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>
                Determining distance to clinic...
              </div>
            )}
            
            {locationStatus === 'success' && distanceToClinic !== null && (
              <div className={`location-banner ${distanceToClinic <= 200 ? 'location-success' : 'location-warning'}`}>
                📍 {distanceToClinic <= 200 
                  ? `On-site verification success (${distanceToClinic} meters from reception)`
                  : `You are ${distanceToClinic}m away. Must be within 200m.`}
              </div>
            )}

            {locationStatus === 'denied' && (
              <div className="location-banner location-warning">
                ⚠️ Geolocation permission denied. Please enable location or request front-desk bypass.
              </div>
            )}

            {locationStatus === 'error' && (
              <div className="location-banner location-warning">
                ⚠️ Unable to obtain geolocation reading.
              </div>
            )}

            {/* Symptoms Field */}
            <div className="form-group">
              <label className="form-label" htmlFor="symptoms">
                Current Condition / Symptom Update (Optional)
              </label>
              <textarea
                id="symptoms"
                className="form-input"
                style={{ resize: 'vertical', minHeight: '80px' }}
                placeholder="e.g. Right knee tightness, mild hamstring soreness..."
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
              />
            </div>

            {/* Developer controls directly in the page for convenience */}
            <div className="form-group" style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px dotted var(--border-glass)' }}>
              <label className="checkbox-group">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={bypassGeofence}
                  onChange={(e) => setBypassGeofence(e.target.checked)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  🔧 Bypass Geofence validation (Developer Override)
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleResetScanner}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ flex: 2 }}
                disabled={submitting || (!bypassGeofence && locationStatus === 'success' && distanceToClinic !== null && distanceToClinic > 200)}
              >
                {submitting ? 'Checking in...' : 'Confirm Arrival'}
              </button>
            </div>
          </form>
        ) : (
          !errorMsg && (
            <p style={{ color: 'var(--text-muted)' }}>Please review the error above or contact the front desk.</p>
          )
        )}
      </div>
    </div>
  );
}
