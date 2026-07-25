import { API_BASE, WS_URL } from '../config';
import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { playChime, playAlert } from '../utils/audio';

interface Appointment {
  id: string;
  patient_name: string;
  patient_email: string;
  expert_id: string;
  expert_name: string;
  scheduled_time: string;
  status: 'awaiting' | 'checked_in' | 'acknowledged' | 'in_consultation' | 'completed';
  checked_in_at?: string;
  symptoms?: string;
  escalated?: number;
}

interface AuditLog {
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

interface ToastNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'escalation';
}

function EscalationCountdown({ 
  checkedInAt, 
  isEscalated, 
  escalationWindowSeconds,
  onFastForwardEscalation
}: { 
  checkedInAt: string; 
  isEscalated: boolean; 
  escalationWindowSeconds: number;
  onFastForwardEscalation: () => void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const totalSeconds = escalationWindowSeconds;

  useEffect(() => {
    const checkinTime = new Date(checkedInAt).getTime();
    const update = () => {
      const diff = Math.floor((Date.now() - checkinTime) / 1000);
      setElapsedSeconds(Math.max(0, diff));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [checkedInAt]);

  const timeLeft = Math.max(0, totalSeconds - elapsedSeconds);
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const percentage = Math.max(0, (timeLeft / totalSeconds) * 100);

  if (isEscalated || timeLeft === 0) {
    return (
      <div style={{ marginTop: '0.5rem' }}>
        <div className="countdown-container">
          <div className="countdown-bar" style={{ width: '0%', background: 'var(--status-escalated)' }}></div>
        </div>
        <div className="countdown-text warning">
          <span>⚠️ EXCEEDED LIMIT ({Math.round(totalSeconds / 60)}m)!</span>
          <span>Escalated</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div className="countdown-container">
        <div className="countdown-bar" style={{ width: `${percentage}%` }}></div>
      </div>
      <div className="countdown-text">
        <span>⏰ Escalation in {minutes}:{seconds < 10 ? `0${seconds}` : seconds}</span>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onFastForwardEscalation();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '0.65rem',
            textDecoration: 'underline',
            cursor: 'pointer'
          }}
          title="Instantly trigger escalation for testing purposes"
        >
          Fast-forward
        </button>
      </div>
    </div>
  );
}

export default function ReceptionistDashboard() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [escalationWindowSeconds, setEscalationWindowSeconds] = useState<number>(300);
  const [notifications, setNotifications] = useState<ToastNotification[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const loadData = () => {
    // Fetch all appointments
    fetch(`${API_BASE}/api/appointments`)
      .then(res => res.json())
      .then(data => setAppointments(data))
      .catch(err => console.error("Error fetching appointments", err));

    // Fetch config
    fetch(`${API_BASE}/api/config`)
      .then(res => res.json())
      .then(data => {
        if (data.escalation_window_seconds) {
          setEscalationWindowSeconds(parseInt(data.escalation_window_seconds, 10));
        }
      })
      .catch(err => console.error("Error fetching config", err));

    // Fetch audit logs
    fetch(`${API_BASE}/api/audit-logs`)
      .then(res => res.json())
      .then(data => setAuditLogs(data))
      .catch(err => console.error("Error fetching audit logs", err));
  };

  useEffect(() => {
    loadData();
  }, []);

  // WebSockets setup
  useEffect(() => {
    const socket = io(WS_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Receptionist socket connected');
      socket.emit('join', { role: 'staff' });
    });

    socket.on('patient:checked-in', (updatedAppt: Appointment) => {
      console.log('[Receptionist Alert] Patient checked in:', updatedAppt);
      playChime();
      
      const id = Date.now().toString();
      setNotifications(prev => [
        {
          id,
          title: 'Patient Checked In 📍',
          message: `${updatedAppt.patient_name} has arrived for ${updatedAppt.expert_name}.`,
          type: 'info'
        },
        ...prev
      ]);
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 6000);

      setAppointments(prev => {
        const exists = prev.some(a => a.id === updatedAppt.id);
        if (exists) {
          return prev.map(a => a.id === updatedAppt.id ? updatedAppt : a);
        }
        return [...prev, updatedAppt];
      });
    });

    socket.on('appointment:updated', (updatedAppt: Appointment) => {
      setAppointments(prev => prev.map(a => a.id === updatedAppt.id ? updatedAppt : a));
    });

    socket.on('escalation:triggered', (data: { appointmentId: string; appointment: Appointment }) => {
      console.log('[Receptionist Warning] Patient Escalated:', data);
      playAlert(); // plays the warning siren sound effect

      const id = Date.now().toString();
      setNotifications(prev => [
        {
          id,
          title: '⚠️ CRITICAL ALERT: Escalation',
          message: `Patient ${data.appointment.patient_name} waiting unacknowledged for ${data.appointment.expert_name}!`,
          type: 'escalation'
        },
        ...prev
      ]);
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 10000);

      setAppointments(prev => prev.map(a => a.id === data.appointmentId ? { ...a, escalated: 1, status: 'checked_in' } : a));
    });

    socket.on('config:updated', (data: { key: string; value: string }) => {
      if (data.key === 'escalation_window_seconds') {
        setEscalationWindowSeconds(parseInt(data.value, 10));
      }
    });

    socket.on('audit:new-log', (newLog: AuditLog) => {
      setAuditLogs(prev => [newLog, ...prev.slice(0, 99)]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleEscalationWindowChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const seconds = parseInt(e.target.value, 10);
    setEscalationWindowSeconds(seconds);

    fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'escalation_window_seconds', value: String(seconds) })
    })
      .then(res => res.json())
      .then(data => console.log('Config updated', data))
      .catch(err => console.error(err));
  };

  // Receptionist acts as staff, so actorId is receptionist identifier
  const handleFrontDeskAcknowledge = (appointmentId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('appointment:acknowledge', {
      appointmentId,
      actorId: 'staff-1' // Alice Receptionist ID
    });
  };

  const handleDeveloperEscalate = (appointmentId: string) => {
    fetch(`${API_BASE}/api/mock/trigger-escalation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appointmentId })
    })
      .catch(err => console.error(err));
  };

  const handleCloseToast = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const awaitingCol = appointments.filter(a => a.status === 'awaiting');
  const checkedInCol = appointments.filter(a => a.status === 'checked_in');
  const consultationCol = appointments.filter(a => a.status === 'acknowledged' || a.status === 'in_consultation');
  const completedCol = appointments.filter(a => a.status === 'completed');

  const getAuditLogColor = (eventType: string) => {
    switch (eventType) {
      case 'check_in': return '#f59e0b';
      case 'escalation': return '#f43f5e';
      case 'acknowledge': return '#3b82f6';
      case 'start_consultation': return '#10b981';
      case 'complete': return '#14b8a6';
      default: return 'var(--text-secondary)';
    }
  };

  return (
    <div className="dashboard-container">
      {/* Header Banner */}
      <div className="dashboard-header-panel">
        <div>
          <h1 style={{ fontSize: '1.75rem', margin: 0, fontWeight: 700 }}>
            Receptionist Waiting Room Board
          </h1>
          <p style={{ fontSize: '0.875rem' }}>
            Full clinic overview & escalation supervision (All Practitioners)
          </p>
        </div>

        {/* Receptionist Configuration */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(255,255,255,0.03)', padding: '0.75rem 1rem', borderRadius: '10px', border: '1px solid var(--border-glass)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            🚨 ESCALATION LIMIT:
          </span>
          <select
            value={escalationWindowSeconds}
            onChange={handleEscalationWindowChange}
            className="form-input"
            style={{ width: 'auto', padding: '0.375rem 1.5rem 0.375rem 0.75rem', fontSize: '0.8125rem', backgroundPosition: 'right 0.5rem center' }}
            title="Configure check-in waiting limit globally"
          >
            <option value="30">30 seconds (Demo)</option>
            <option value="60">1 minute</option>
            <option value="180">3 minutes</option>
            <option value="300">5 minutes (Default)</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1.25rem', flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        
        {/* Waiting Room Grid */}
        <div className="board-grid" style={{ flex: 3 }}>
          
          {/* Column 1: Awaiting */}
          <div className="board-column">
            <div className="column-header">
              <h3 className="column-title">
                <span className="pulse-indicator awaiting"></span>
                Awaiting Arrival
              </h3>
              <span className="column-count">{awaitingCol.length}</span>
            </div>
            <div className="column-cards-container">
              {awaitingCol.length === 0 ? (
                <p style={{ textAlign: 'center', margin: '2rem 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  No appointments pending
                </p>
              ) : (
                awaitingCol.map(appt => (
                  <div key={appt.id} className="patient-mini-card">
                    <div className="card-header">
                      <span className="patient-name">{appt.patient_name}</span>
                      <span className="appointment-time">
                        {new Date(appt.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="assigned-expert">👤 {appt.expert_name}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 2: Checked In (Awaiting Practitioner Acknowledge) */}
          <div className="board-column">
            <div className="column-header">
              <h3 className="column-title" style={{ color: 'var(--status-checked-in)' }}>
                <span className="pulse-indicator arrived"></span>
                Checked In
              </h3>
              <span className="column-count">
                {checkedInCol.length}
              </span>
            </div>
            <div className="column-cards-container">
              {checkedInCol.length === 0 ? (
                <p style={{ textAlign: 'center', margin: '2rem 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  No patients waiting
                </p>
              ) : (
                checkedInCol.map(appt => {
                  const isEsc = appt.escalated === 1;
                  return (
                    <div key={appt.id} className={`patient-mini-card state-checked_in ${isEsc ? 'state-escalated' : ''}`}>
                      <div className="card-header">
                        <span className="patient-name">
                          {isEsc && <span style={{ marginRight: '0.35rem', color: 'var(--status-escalated)' }}>⚠️</span>}
                          {appt.patient_name}
                        </span>
                        <span className="appointment-time">
                          Arrived: {appt.checked_in_at ? new Date(appt.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
                        </span>
                      </div>
                      <div className="assigned-expert">
                        👤 {appt.expert_name}
                      </div>

                      {appt.symptoms && (
                        <div className="symptoms-tag">
                          📝 {appt.symptoms}
                        </div>
                      )}

                      {appt.checked_in_at && (
                        <EscalationCountdown 
                          checkedInAt={appt.checked_in_at}
                          isEscalated={isEsc}
                          escalationWindowSeconds={escalationWindowSeconds}
                          onFastForwardEscalation={() => handleDeveloperEscalate(appt.id)}
                        />
                      )}

                      <div className="card-actions">
                        <button className="btn btn-secondary" onClick={() => handleFrontDeskAcknowledge(appt.id)}>
                          Front-desk Acknowledge
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Column 3: In Consultation */}
          <div className="board-column">
            <div className="column-header">
              <h3 className="column-title" style={{ color: 'var(--status-consultation)' }}>
                <span className="pulse-indicator active"></span>
                In Consultation
              </h3>
              <span className="column-count">{consultationCol.length}</span>
            </div>
            <div className="column-cards-container">
              {consultationCol.length === 0 ? (
                <p style={{ textAlign: 'center', margin: '2rem 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  No active sessions
                </p>
              ) : (
                consultationCol.map(appt => (
                  <div key={appt.id} className="patient-mini-card state-in_consultation">
                    <div className="card-header">
                      <span className="patient-name">{appt.patient_name}</span>
                      <span className="appointment-time">{appt.status.toUpperCase()}</span>
                    </div>
                    <div className="assigned-expert">👤 {appt.expert_name}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 4: Completed */}
          <div className="board-column">
            <div className="column-header">
              <h3 className="column-title" style={{ color: 'var(--status-completed)' }}>✓ Completed</h3>
              <span className="column-count">{completedCol.length}</span>
            </div>
            <div className="column-cards-container">
              {completedCol.length === 0 ? (
                <p style={{ textAlign: 'center', margin: '2rem 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  No completed sessions today
                </p>
              ) : (
                completedCol.map(appt => (
                  <div key={appt.id} className="patient-mini-card state-completed">
                    <div className="card-header">
                      <span className="patient-name">{appt.patient_name}</span>
                    </div>
                    <div className="assigned-expert">👤 {appt.expert_name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--status-consultation)', fontWeight: 600, marginTop: '0.25rem' }}>
                      ✓ Done
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Audit Logs Sidebar */}
        <div style={{
          flex: 1, 
          minWidth: '280px', 
          maxWidth: '350px',
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-color)', 
          borderRadius: '12px', 
          padding: '1.25rem 1rem', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '0.75rem',
          height: 'inherit',
          maxHeight: 'calc(100vh - 10rem)',
          overflow: 'hidden'
        }}>
          <div>
            <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              📋 Transition Audit Feed
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Chronological log of clinic state changes
            </p>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.625rem', paddingRight: '0.25rem', marginTop: '0.5rem' }}>
            {auditLogs.map(log => {
              const color = getAuditLogColor(log.event_type);
              return (
                <div key={log.id} style={{
                  background: 'rgba(255,255,255,0.01)',
                  border: '1px solid var(--border-color)',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ 
                      color, 
                      fontWeight: 700, 
                      fontSize: '0.6875rem',
                      textTransform: 'uppercase',
                      padding: '0.1rem 0.35rem',
                      background: `${color}15`,
                      border: `1px solid ${color}30`,
                      borderRadius: '4px'
                    }}>
                      {log.event_type.replace('_', ' ')}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.6875rem' }}>
                      {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    Patient: {log.patient_name}
                  </p>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {log.details || `Moved status from ${log.previous_status} to ${log.new_status}`}
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', marginTop: '0.25rem', fontStyle: 'italic' }}>
                    Actor: {log.actor_name}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Notifications overlay toasts */}
      <div className="notifications-overlay">
        {notifications.map(n => (
          <div key={n.id} className={`notification-toast ${n.type === 'escalation' ? 'escalation' : ''}`}>
            <div className="toast-icon">
              {n.type === 'escalation' ? '⚠️' : '🔔'}
            </div>
            <div className="toast-body">
              <div className="toast-title" style={{ color: n.type === 'escalation' ? '#f43f5e' : 'var(--text-primary)' }}>
                {n.title}
              </div>
              <div className="toast-desc">{n.message}</div>
            </div>
            <button className="toast-close" onClick={() => handleCloseToast(n.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
