import { API_BASE } from '../config';
import { useState, useEffect } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  const [role, setRole] = useState<'select' | 'patient' | 'doctor'>('select');
  const [hasBooking, setHasBooking] = useState<'select' | 'yes' | 'no'>('select');

  // Booking states
  const [patientName, setPatientName] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [expertId, setExpertId] = useState('');
  const [offsetMinutes, setOffsetMinutes] = useState('0');
  const [practitioners, setPractitioners] = useState<User[]>([]);
  const [bookingSuccess, setBookingSuccess] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [etherealLink, setEtherealLink] = useState<string | null>(null);

  // Fetch practitioners for booking
  useEffect(() => {
    if (hasBooking === 'no') {
      fetch(`${API_BASE}/api/users`)
        .then(res => res.json())
        .then(data => {
          const experts = data.filter((u: User) => u.role === 'expert');
          setPractitioners(experts);
          if (experts.length > 0) setExpertId(experts[0].id);
        })
        .catch(err => console.error("Error fetching experts", err));
    }
  }, [hasBooking]);

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName || !expertId) {
      setErrorMsg('Name and practitioner are required.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/api/mock/create-appointment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName,
          patientEmail,
          expertId,
          scheduledOffsetMinutes: parseInt(offsetMinutes, 10)
        })
      });

      const data = await res.json();
      if (res.ok) {
        setBookingSuccess(data.appointment);
        // Fetch last sent preview URL from server
        const mailRes = await fetch(`${API_BASE}/api/mock/last-sent-email`);
        const mailData = await mailRes.json();
        if (mailData.url) {
          setEtherealLink(mailData.url);
        }
      } else {
        setErrorMsg(data.error || 'Failed to book appointment.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Network error creating appointment.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setRole('select');
    setHasBooking('select');
    setPatientName('');
    setPatientEmail('');
    setBookingSuccess(null);
    setErrorMsg(null);
    setEtherealLink(null);
  };

  return (
    <div className="patient-card-container" style={{ minHeight: 'calc(100vh - 4rem)' }}>
      {role === 'select' && (
        <div className="patient-card" style={{ maxWidth: '500px' }}>
          <div className="patient-header">
            <div className="patient-logo">⚡</div>
            <h2>Sporting Ethos High Performance</h2>
            <p>Welcome. Please choose your portal to continue:</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
            <button 
              className="btn btn-primary" 
              style={{ padding: '1.25rem', fontSize: '1.05rem' }}
              onClick={() => setRole('patient')}
            >
              👤 Patient Portal
            </button>
            <button 
              className="btn btn-secondary" 
              style={{ padding: '1.25rem', fontSize: '1.05rem', borderColor: 'var(--accent-color)', color: '#fff' }}
              onClick={() => onNavigate('/doctor')}
            >
              🩺 Practitioner Login
            </button>
          </div>
        </div>
      )}

      {role === 'patient' && hasBooking === 'select' && (
        <div className="patient-card" style={{ maxWidth: '460px' }}>
          <div className="patient-header">
            <div className="patient-logo">📅</div>
            <h2>Appointment Verification</h2>
            <p>Have you already booked an appointment today?</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
            <button 
              className="btn btn-primary" 
              style={{ padding: '1rem' }}
              onClick={() => onNavigate('/patient')}
            >
              Yes, I have an appointment ➔
            </button>
            <button 
              className="btn btn-secondary" 
              style={{ padding: '1rem' }}
              onClick={() => setHasBooking('no')}
            >
              No, I need to book one ➔
            </button>
            <button className="btn btn-secondary" style={{ marginTop: '0.5rem', opacity: 0.7 }} onClick={handleReset}>
              ◀ Back
            </button>
          </div>
        </div>
      )}

      {role === 'patient' && hasBooking === 'no' && !bookingSuccess && (
        <div className="patient-card" style={{ maxWidth: '480px' }}>
          <div className="patient-header">
            <div className="patient-logo">📝</div>
            <h2>Book Appointment</h2>
            <p>Enter your details to generate your check-in QR Code</p>
          </div>

          {errorMsg && (
            <div style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', color: '#fda4af', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.8125rem', textAlign: 'left' }}>
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleBookingSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Full Name</label>
              <input
                type="text"
                className="form-input"
                required
                placeholder="e.g. Peter Parker"
                value={patientName}
                onChange={e => setPatientName(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Email Address (for QR Code delivery)</label>
              <input
                type="email"
                className="form-input"
                required
                placeholder="e.g. peter@dailybugle.com"
                value={patientEmail}
                onChange={e => setPatientEmail(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Select Practitioner</label>
              <select
                className="form-input"
                value={expertId}
                onChange={e => setExpertId(e.target.value)}
              >
                {practitioners.map(doc => (
                  <option key={doc.id} value={doc.id}>{doc.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Appointment Time Offset</label>
              <select
                className="form-input"
                value={offsetMinutes}
                onChange={e => setOffsetMinutes(e.target.value)}
              >
                <option value="0">Scheduled Now (0m offset)</option>
                <option value="15">Scheduled in +15 minutes</option>
                <option value="60">Scheduled in +1 hour</option>
                <option value="-30">Scheduled -30 minutes ago (Late arrival)</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={handleReset}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={loading}>
                {loading ? 'Booking...' : 'Book & Send QR ➔'}
              </button>
            </div>
          </form>
        </div>
      )}

      {bookingSuccess && (
        <div className="patient-card" style={{ maxWidth: '480px' }}>
          <div className="success-checkmark">
            <svg className="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
              <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
              <path className="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
          </div>

          <h2 style={{ marginBottom: '0.5rem' }}>Appointment Scheduled!</h2>
          <p style={{ color: '#a7f3d0', fontWeight: 600, fontSize: '0.95rem', marginBottom: '1.5rem' }}>
            Check-In QR Code sent to {bookingSuccess.patient_email}
          </p>

          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Please open the email containing your personal QR Code on your phone or print it. When you arrive on-site, scan it under the reception webcam reader to complete checking in.
          </p>

          {etherealLink && (
            <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px dotted rgba(245, 158, 11, 0.2)', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', textAlign: 'left' }}>
              <strong style={{ fontSize: '0.75rem', color: '#fcd34d', display: 'block', marginBottom: '0.25rem' }}>
                🔧 DEV DEMO CONSOLE:
              </strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                No actual inbox access? Click the link below to preview the Ethereal email and view your scannable QR Code:
              </span>
              <a 
                href={etherealLink} 
                target="_blank" 
                rel="noopener noreferrer"
                className="btn btn-secondary" 
                style={{ display: 'block', textAlign: 'center', marginTop: '0.75rem', fontSize: '0.75rem', textDecoration: 'none', borderColor: '#fcd34d', color: '#fcd34d' }}
              >
                View Sent QR Email (Ethereal Preview) ↗
              </a>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={handleReset}>
              Return Home
            </button>
            <button className="btn btn-primary" style={{ flex: 1.5 }} onClick={() => onNavigate('/patient')}>
              Go to QR Scanner
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
