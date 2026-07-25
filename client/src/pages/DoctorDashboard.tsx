import { API_BASE, WS_URL } from '../config';
import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { playChime, playAlert, unlockAudio, speak, speakEmergency, cancelSpeech } from '../utils/audio';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'expert' | 'staff' | 'supervisor';
}

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
  ai_summary?: string;
  ai_urgency?: string;
  ai_reasoning?: string;
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
  onFastForwardEscalation,
  onWarnLevelChange,
  patientName,
  onSpeakReminder
}: { 
  checkedInAt: string; 
  isEscalated: boolean; 
  escalationWindowSeconds: number;
  onFastForwardEscalation: () => void;
  onWarnLevelChange: (level: 0 | 50 | 80 | 100) => void;
  patientName: string;
  onSpeakReminder?: (templateKey: 'wait50' | 'wait80', patientName: string) => void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const totalSeconds = escalationWindowSeconds;

  const hasFired50 = useRef(false);
  const hasFired80 = useRef(false);
  const lastLevel = useRef<0 | 50 | 80 | 100>(0);

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

  useEffect(() => {
    const elapsedPercent = (elapsedSeconds / totalSeconds) * 100;
    
    // Determine warning level
    let currentLevel: 0 | 50 | 80 | 100 = 0;
    if (isEscalated || elapsedSeconds >= totalSeconds) {
      currentLevel = 100;
    } else if (elapsedPercent >= 80) {
      currentLevel = 80;
    } else if (elapsedPercent >= 50) {
      currentLevel = 50;
    }

    if (lastLevel.current !== currentLevel) {
      lastLevel.current = currentLevel;
      onWarnLevelChange(currentLevel);
    }

    // Voice Reminders
    if (elapsedPercent >= 80 && elapsedPercent < 100) {
      if (!hasFired80.current) {
        hasFired80.current = true;
        hasFired50.current = true;
        if (onSpeakReminder) {
          onSpeakReminder('wait80', patientName);
        } else {
          speak(`${patientName} has been waiting a while, please acknowledge soon.`);
        }
      }
    } else if (elapsedPercent >= 50 && elapsedPercent < 80) {
      if (!hasFired50.current) {
        hasFired50.current = true;
        if (onSpeakReminder) {
          onSpeakReminder('wait50', patientName);
        } else {
          speak(`Reminder: ${patientName} is waiting.`);
        }
      }
    }
  }, [elapsedSeconds, totalSeconds, isEscalated, patientName, onWarnLevelChange, onSpeakReminder]);

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

function PatientWaitingCard({
  appt,
  escalationWindowSeconds,
  onAcknowledge,
  onDeveloperEscalate,
  onSpeakReminder
}: {
  appt: Appointment;
  escalationWindowSeconds: number;
  onAcknowledge: (id: string) => void;
  onDeveloperEscalate: (id: string) => void;
  onSpeakReminder?: (templateKey: 'wait50' | 'wait80', patientName: string) => void;
}) {
  const [warnLevel, setWarnLevel] = useState<0 | 50 | 80 | 100>(0);
  
  const isEmergency = String(appt.ai_urgency).toLowerCase() === 'emergency';
  const isEsc = appt.escalated === 1 || warnLevel === 100;

  let stateClass = 'state-checked_in';
  if (isEmergency) {
    stateClass = 'state-emergency';
  } else if (isEsc) {
    stateClass = 'state-escalated';
  } else if (warnLevel === 80) {
    stateClass = 'state-warn-80';
  } else if (warnLevel === 50) {
    stateClass = 'state-warn-50';
  }

  let urgencyClass = 'urgency-moderate';
  const normUrgency = String(appt.ai_urgency).toLowerCase();
  if (normUrgency === 'routine') {
    urgencyClass = 'urgency-routine';
  } else if (normUrgency === 'emergency') {
    urgencyClass = 'urgency-urgent';
  } else if (normUrgency === 'moderate') {
    urgencyClass = 'urgency-moderate';
  }

  return (
    <div key={appt.id} className={`patient-mini-card ${stateClass}`}>
      <div className="card-header">
        <span className="patient-name">
          {isEmergency && <span style={{ marginRight: '0.35rem' }}>🚨</span>}
          {isEsc && !isEmergency && <span style={{ marginRight: '0.35rem', color: 'var(--status-escalated)' }}>⚠️</span>}
          {appt.patient_name}
          {isEmergency && <span className="emergency-header-badge" style={{ marginLeft: '0.5rem', background: '#ffffff', color: '#dc2626', fontSize: '0.6rem', fontWeight: 800, padding: '0.1rem 0.35rem', borderRadius: '3px', textTransform: 'uppercase', verticalAlign: 'middle', display: 'inline-block' }}>EMERGENCY FLAG</span>}
        </span>
        <span className="appointment-time">
          Arrived: {appt.checked_in_at ? new Date(appt.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Now'}
        </span>
      </div>

      {appt.ai_summary ? (
        <div className="ai-summary-container">
          <div className="ai-header-label">
            AI-assisted summary (not a diagnosis) — please review the patient directly
          </div>
          <div className="ai-summary-text">
            {appt.ai_summary}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
            <span className={`urgency-badge ${urgencyClass}`}>
              Urgency: {appt.ai_urgency}
            </span>
            {appt.ai_reasoning && (
              <span className="ai-reasoning-label" style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' }}>
                ({appt.ai_reasoning})
              </span>
            )}
          </div>
          
          {isEmergency ? (
            <div className="ai-disclaimer emergency-disclaimer" style={{ color: '#fca5a5', fontWeight: 'bold', borderTop: '1px dashed rgba(239,68,68,0.3)', marginTop: '0.5rem', paddingTop: '0.35rem' }}>
              ⚠️ AI-suggested triage flag — always confirm directly with the patient. Not a medical diagnosis.
            </div>
          ) : (
            <div className="ai-disclaimer">
              AI-generated summary for triage convenience only — always confirm with the patient directly.
            </div>
          )}
        </div>
      ) : (
        appt.symptoms && (
          <div className="symptoms-tag">
            📝 {appt.symptoms}
          </div>
        )
      )}

      {appt.checked_in_at && (
        <EscalationCountdown 
          checkedInAt={appt.checked_in_at}
          isEscalated={appt.escalated === 1}
          escalationWindowSeconds={escalationWindowSeconds}
          onFastForwardEscalation={() => onDeveloperEscalate(appt.id)}
          onWarnLevelChange={setWarnLevel}
          patientName={appt.patient_name}
          onSpeakReminder={onSpeakReminder}
        />
      )}

      <div className="card-actions">
        <button className="btn btn-primary" onClick={() => onAcknowledge(appt.id)}>
          Acknowledge & Call Patient
        </button>
      </div>
    </div>
  );
}

const LOCAL_FALLBACKS: Record<string, Record<string, string>> = {
  hi: {
    checkIn: "[Patient Name] ने [Doctor Name] के लिए चेक इन किया है।",
    wait50: "याद दिलाएं: [Patient Name] प्रतीक्षा कर रहे हैं।",
    wait80: "[Patient Name] को प्रतीक्षा करते हुए कुछ समय हो गया है, कृपया जल्द ही स्वीकार करें।",
    escalation: "एस्केलेशन: [Patient Name] ने प्रतीक्षा समय सीमा को पार कर लिया है।",
    emergency: "आपातकालीन संकेत: [Patient Name] को तत्काल ध्यान देने की आवश्यकता हो सकती है। कारण: [Reason]"
  },
  te: {
    checkIn: "[Patient Name] [Doctor Name] కొరకు చెక్-ఇన్ అయ్యారు.",
    wait50: "గుర్తుచేయడం: [Patient Name] వేచి ఉన్నారు.",
    wait80: "[Patient Name] చాలా సేపటి నుండి వేచి ఉన్నారు, దయచేసి త్వరగా అంగీకరించండి.",
    escalation: "ఎస్కలేషన్: [Patient Name] వేచి ఉండే సమయ పరిమితిని దాటారు.",
    emergency: "అత్యవసర ఫ్లాగ్: [Patient Name] కి తక్షణ శ్రద్ధ కావచ్చు. కారణం: [Reason]"
  },
  ta: {
    checkIn: "[Patient Name] [Doctor Name] க்காக செக்-இன் செய்துள்ளார்.",
    wait50: "நினைவூட்டல்: [Patient Name] காத்திருக்கிறார்.",
    wait80: "[Patient Name] சிறிது நேரமாகக் காத்திருக்கிறார், தயவுசெய்து விரைவில் ஒப்புக்கொள்ளவும்.",
    escalation: "எஸ்கலேஷன்: [Patient Name] காத்திருப்பு நேர வரம்பை மீறிவிட்டார்.",
    emergency: "அவசர எச்சரிக்கை: [Patient Name] க்கு உடனடி கவனம் தேவைப்படலாம். காரணம்: [Reason]"
  }
};

const STANDARD_TEMPLATES = {
  checkIn: "[Patient Name] has checked in for [Doctor Name].",
  wait50: "Reminder: [Patient Name] is waiting.",
  wait80: "[Patient Name] has been waiting a while, please acknowledge soon.",
  escalation: "Escalation: [Patient Name] has exceeded the wait limit.",
  emergency: "Emergency flag: [Patient Name] may need immediate attention. Reason: [Reason]"
};

export default function DoctorDashboard() {
  const [practitioners, setPractitioners] = useState<User[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<User | null>(() => {
    const saved = localStorage.getItem('selected_doctor_profile');
    return saved ? JSON.parse(saved) : null;
  });

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [escalationWindowSeconds, setEscalationWindowSeconds] = useState<number>(300);
  const [notifications, setNotifications] = useState<ToastNotification[]>([]);
  
  const [selectedLang, setSelectedLang] = useState<string>(() => sessionStorage.getItem('doctor_lang_pref') || 'en');
  const [translationCache, setTranslationCache] = useState<Record<string, string>>({});
  
  const announcedEmergenciesRef = useRef<Set<string>>(new Set());

  const preFetchTranslations = async (lang: string) => {
    if (lang === 'en') {
      setTranslationCache({});
      return;
    }

    const targetLangName = lang === 'hi' ? 'Hindi' : lang === 'te' ? 'Telugu' : 'Tamil';
    const updatedCache: Record<string, string> = {};

    console.log(`[Translation Cache] Pre-fetching templates for ${targetLangName}...`);

    const promises = Object.entries(STANDARD_TEMPLATES).map(async ([key, templateText]) => {
      try {
        const res = await fetch(`${API_BASE}/api/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: templateText, targetLanguage: targetLangName })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.translated) {
            updatedCache[key] = data.translated;
            return;
          }
        }
      } catch (err) {
        console.error(`Failed to pre-fetch translation for ${key}`, err);
      }
      
      // Fallback
      const fallback = LOCAL_FALLBACKS[lang]?.[key];
      if (fallback) {
        updatedCache[key] = fallback;
      } else {
        updatedCache[key] = templateText;
      }
    });

    await Promise.all(promises);
    setTranslationCache(updatedCache);
    console.log(`[Translation Cache] Finished pre-fetching templates for ${targetLangName}:`, updatedCache);
  };

  useEffect(() => {
    if (selectedDoctor && selectedLang !== 'en') {
      preFetchTranslations(selectedLang);
    }
  }, [selectedDoctor, selectedLang]);

  const speakAlertText = async (templateKey: string, params: Record<string, string>, isEmergency: boolean = false) => {
    const speechLang = selectedLang === 'hi' ? 'hi-IN' : selectedLang === 'te' ? 'te-IN' : selectedLang === 'ta' ? 'ta-IN' : 'en-IN';
    
    if (selectedLang === 'en') {
      let text = STANDARD_TEMPLATES[templateKey as keyof typeof STANDARD_TEMPLATES];
      Object.entries(params).forEach(([key, val]) => {
        text = text.replace(`[${key}]`, val);
      });
      if (isEmergency) {
        speakEmergency(text, speechLang);
      } else {
        speak(text, speechLang);
      }
      return;
    }

    let templateText = translationCache[templateKey] || LOCAL_FALLBACKS[selectedLang]?.[templateKey] || STANDARD_TEMPLATES[templateKey as keyof typeof STANDARD_TEMPLATES];
    
    // Dynamic reason translation for emergency alert
    if (templateKey === 'emergency' && params['Reason'] && params['Reason'] !== 'No specific reasoning provided.') {
      try {
        const targetLangName = selectedLang === 'hi' ? 'Hindi' : selectedLang === 'te' ? 'Telugu' : 'Tamil';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5s timeout
        
        const res = await fetch(`${API_BASE}/api/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: params['Reason'], targetLanguage: targetLangName }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (res.ok) {
          const data = await res.json();
          if (data.translated) {
            params['Reason'] = data.translated;
          }
        }
      } catch (err) {
        console.warn(`Reason translation failed or timed out: ${err}. Using original English reason.`);
      }
    }

    Object.entries(params).forEach(([key, val]) => {
      templateText = templateText.replace(`[${key}]`, val);
    });

    if (isEmergency) {
      speakEmergency(templateText, speechLang);
    } else {
      speak(templateText, speechLang);
    }
  };

  const handleSpeakReminder = (templateKey: 'wait50' | 'wait80', patientName: string) => {
    speakAlertText(templateKey, { 'Patient Name': patientName });
  };
  
  // Registration form states
  const [showRegisterForm, setShowRegisterForm] = useState<boolean>(false);
  const [newDocName, setNewDocName] = useState<string>('');
  const [newDocSpecialty, setNewDocSpecialty] = useState<string>('Physiotherapist');
  const [newDocEmail, setNewDocEmail] = useState<string>('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registering, setRegistering] = useState<boolean>(false);

  // Audio unlock — must be false on every fresh page load (browser policy requires
  // a user gesture per-session; sessionStorage was unreliable across hot-reloads)
  const [audioUnlocked, setAudioUnlocked] = useState<boolean>(false);

  const handleEnableSound = async () => {
    await unlockAudio();
    setAudioUnlocked(true);
    const speechLang = selectedLang === 'hi' ? 'hi-IN' : selectedLang === 'te' ? 'te-IN' : selectedLang === 'ta' ? 'ta-IN' : 'en-IN';
    speak('Sound alerts enabled. You will be notified when patients check in.', speechLang);
  };

  const handleTestVoice = () => {
    const speechLang = selectedLang === 'hi' ? 'hi-IN' : selectedLang === 'te' ? 'te-IN' : selectedLang === 'ta' ? 'ta-IN' : 'en-IN';
    speak('This is a test. Voice announcements are working correctly.', speechLang);
    playChime();
  };

  const socketRef = useRef<Socket | null>(null);

  const fetchPractitioners = () => {
    fetch(`${API_BASE}/api/users`)
      .then(res => res.json())
      .then(data => {
        const experts = data.filter((u: User) => u.role === 'expert');
        setPractitioners(experts);
      })
      .catch(err => console.error("Error fetching practitioners", err));
  };

  // Fetch practitioners list
  useEffect(() => {
    fetchPractitioners();
  }, []);

  // Fetch appointments for this specific doctor
  const loadDoctorAppointments = (doctorId: string) => {
    fetch(`${API_BASE}/api/appointments?expert_id=${doctorId}`)
      .then(res => res.json())
      .then(data => setAppointments(data))
      .catch(err => console.error(err));

    fetch(`${API_BASE}/api/config`)
      .then(res => res.json())
      .then(data => {
        if (data.escalation_window_seconds) {
          setEscalationWindowSeconds(parseInt(data.escalation_window_seconds, 10));
        }
      })
      .catch(err => console.error(err));
  };

  useEffect(() => {
    if (selectedDoctor) {
      loadDoctorAppointments(selectedDoctor.id);
    }
  }, [selectedDoctor]);

  // WebSocket connections for specific doctor room
  useEffect(() => {
    if (!selectedDoctor) return;

    const socket = io(WS_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(`Doctor ${selectedDoctor.name} socket connected`);
      // Join the doctor specific room! Receives events ONLY for this doctor.
      socket.emit('join', { role: 'expert', userId: selectedDoctor.id });
    });

    socket.on('patient:checked-in', (updatedAppt: Appointment) => {
      // Double check just in case, but WebSocket room directs this to us
      if (updatedAppt.expert_id !== selectedDoctor.id) return;

      console.log('[Doctor Alert] patient:checked-in event received:', updatedAppt.patient_name);
      
      const docCleanName = selectedDoctor.name.split('(')[0].trim();
      const docSpoken = docCleanName.toLowerCase().startsWith('dr.') ? docCleanName : `Dr. ${docCleanName}`;
      
      playChime();
      // Announce via translated alert — falls through to English if translation not ready
      speakAlertText('checkIn', { 'Patient Name': updatedAppt.patient_name, 'Doctor Name': docSpoken });

      const id = Date.now().toString();
      setNotifications(prev => [
        {
          id,
          title: 'Patient Arrived 📍',
          message: `${updatedAppt.patient_name} has checked in for your consultation.`,
          type: 'info'
        },
        ...prev
      ]);
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 7000);

      setAppointments(prev => {
        const exists = prev.some(a => a.id === updatedAppt.id);
        if (exists) {
          return prev.map(a => a.id === updatedAppt.id ? updatedAppt : a);
        }
        return [...prev, updatedAppt];
      });
    });

    socket.on('appointment:updated', (updatedAppt: Appointment) => {
      if (updatedAppt.expert_id !== selectedDoctor.id) return;
      
      setAppointments(prev => prev.map(a => a.id === updatedAppt.id ? updatedAppt : a));

      // Trigger immediate emergency alert if not already announced
      const urgency = String(updatedAppt.ai_urgency).toLowerCase();
      if (urgency === 'emergency' && !announcedEmergenciesRef.current.has(updatedAppt.id)) {
        announcedEmergenciesRef.current.add(updatedAppt.id);
        console.log('[Doctor Alert] IMMEDIATE Emergency Triage for:', updatedAppt.patient_name);
        playAlert();
        // Translate emergency reason dynamically then speak
        speakAlertText(
          'emergency',
          {
            'Patient Name': updatedAppt.patient_name,
            'Reason': updatedAppt.ai_reasoning || 'No specific reasoning provided.'
          },
          true // isEmergency
        );
      }
    });

    socket.on('escalation:triggered', (data: { appointmentId: string; appointment: Appointment }) => {
      if (data.appointment.expert_id !== selectedDoctor.id) return;

      console.log('[Doctor Warning] Your patient escalated:', data);
      playAlert();
      // Speak the translated escalation string
      speakAlertText('escalation', { 'Patient Name': data.appointment.patient_name });

      const id = Date.now().toString();
      setNotifications(prev => [
        {
          id,
          title: '⚠️ URGENT: Check-in Delay',
          message: `Your checked-in patient ${data.appointment.patient_name} needs acknowledgment!`,
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

    return () => {
      socket.disconnect();
    };
  }, [selectedDoctor]);

  const handleSelectDoctor = (doctor: User) => {
    setSelectedDoctor(doctor);
    localStorage.setItem('selected_doctor_profile', JSON.stringify(doctor));
    // Pre-fetch translations for the selected language if not English
    if (selectedLang !== 'en') {
      preFetchTranslations(selectedLang);
    }
  };

  const handleLogout = () => {
    setSelectedDoctor(null);
    localStorage.removeItem('selected_doctor_profile');
    setAppointments([]);
  };

  const handleAcknowledge = (appointmentId: string) => {
    if (!socketRef.current || !selectedDoctor) return;
    socketRef.current.emit('appointment:acknowledge', {
      appointmentId,
      actorId: selectedDoctor.id
    });
    cancelSpeech();
  };

  const handleStartConsultation = (appointmentId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('appointment:start-consultation', { appointmentId });
  };

  const handleComplete = (appointmentId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('appointment:complete', { appointmentId });
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

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocName || !newDocEmail || !newDocSpecialty) return;
    setRegistering(true);
    setRegisterError(null);

    const formattedSpecialty = `Dr. ${newDocName} (${newDocSpecialty})`;

    fetch(`${API_BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formattedSpecialty,
        email: newDocEmail,
        role: 'expert'
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.user) {
          setNewDocName('');
          setNewDocEmail('');
          setShowRegisterForm(false);
          fetchPractitioners();
          handleSelectDoctor(data.user);
        } else {
          setRegisterError(data.error || 'Registration failed');
        }
      })
      .catch(err => {
        console.error(err);
        setRegisterError('Connection error registering doctor');
      })
      .finally(() => {
        setRegistering(false);
      });
  };

  // If no doctor selected, show practitioner select landing screen
  if (!selectedDoctor) {
    return (
      <div className="patient-card-container" style={{ minHeight: 'calc(100vh - 4rem)' }}>
        <div className="patient-card" style={{ maxWidth: '520px' }}>
          
          {showRegisterForm ? (
            <>
              <div className="patient-header">
                <div className="patient-logo">➕</div>
                <h2>Register Practitioner</h2>
                <p>Create a new doctor profile to access the dashboard</p>
              </div>

              {registerError && (
                <div style={{ background: 'rgba(224,62,38,0.1)', border: '1px solid rgba(224,62,38,0.25)', color: '#fda4af', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.8125rem', textAlign: 'left' }}>
                  ⚠️ {registerError}
                </div>
              )}

              <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Practitioner Name</label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    placeholder="e.g. Stephen Strange"
                    value={newDocName}
                    onChange={e => setNewDocName(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Specialization / Department</label>
                  <select
                    className="form-input"
                    value={newDocSpecialty}
                    onChange={e => setNewDocSpecialty(e.target.value)}
                  >
                    <option value="Physiotherapist">Physiotherapist</option>
                    <option value="Sports Medicine">Sports Medicine</option>
                    <option value="Nutritionist">Nutritionist</option>
                    <option value="Orthopedic Surgeon">Orthopedic Surgeon</option>
                    <option value="Cardiologist">Cardiologist</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    className="form-input"
                    required
                    placeholder="e.g. strange@sportingethos.com"
                    value={newDocEmail}
                    onChange={e => setNewDocEmail(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    style={{ flex: 1 }} 
                    onClick={() => { setShowRegisterForm(false); setRegisterError(null); }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1.5 }} disabled={registering}>
                    {registering ? 'Creating...' : 'Create Profile & Login'}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="patient-header">
                <div className="patient-logo">🩺</div>
                <h2>Practitioner Portal</h2>
                <p>Select your practitioner profile to view your live patient queue</p>
              </div>

              {/* ── Language Preference (Doctor-only, session-scoped) ── */}
              <div style={{ marginTop: '1.25rem', textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🌐 Voice Announcement Language
                </label>
                <select
                  id="doctor-lang-selector"
                  className="form-input"
                  value={selectedLang}
                  onChange={e => {
                    const lang = e.target.value;
                    setSelectedLang(lang);
                    sessionStorage.setItem('doctor_lang_pref', lang);
                    setTranslationCache({});
                    if (lang !== 'en') preFetchTranslations(lang);
                  }}
                  style={{ fontSize: '0.875rem', marginBottom: 0 }}
                >
                  <option value="en">🇬🇧 English</option>
                  <option value="hi">🇮🇳 Hindi (हिन्दी)</option>
                  <option value="te">🇮🇳 Telugu (తెలుగు)</option>
                  <option value="ta">🇮🇳 Tamil (தமிழ்)</option>
                </select>
                {selectedLang !== 'en' && (
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.4rem', marginBottom: 0 }}>
                    ✅ Voice alerts will be spoken in the selected language after you log in.
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginTop: '1.5rem', textAlign: 'left' }}>
                {practitioners.map(doc => (
                  <div 
                    key={doc.id}
                    onClick={() => handleSelectDoctor(doc)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '1.25rem',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      transition: 'all 0.2s ease-in-out'
                    }}
                    className="practitioner-select-row"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent-color)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                    }}
                  >
                    <div>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>{doc.name}</h3>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{doc.email}</p>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 700 }}>Log In ➔</span>
                  </div>
                ))}
                {practitioners.length === 0 && (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading practitioner profiles...</p>
                )}

                <button 
                  className="btn btn-secondary" 
                  style={{ marginTop: '0.75rem', width: '100%', padding: '0.75rem' }} 
                  onClick={() => setShowRegisterForm(true)}
                >
                  ➕ Register as a New Practitioner
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    );
  }

  const awaitingCol = appointments.filter(a => a.status === 'awaiting');
  const checkedInCol = appointments.filter(a => a.status === 'checked_in');
  const consultationCol = appointments.filter(a => a.status === 'acknowledged' || a.status === 'in_consultation');
  const completedCol = appointments.filter(a => a.status === 'completed');

  return (
    <div className="dashboard-container">

      {/* ─── One-time Sound Unlock Banner ─────────────────────────────── */}
      {!audioUnlocked && (
        <div style={{
          background: '#1a1f12',
          border: '1px solid #4a7c2f',
          borderRadius: '10px',
          padding: '0.75rem 1.25rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.25rem' }}>🔔</span>
            <div>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', color: '#a3d977', margin: 0 }}>
                Enable Voice Announcements
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                Click once to activate automatic voice alerts when patients check in — no further action needed.
              </p>
            </div>
          </div>
          <button
            onClick={handleEnableSound}
            style={{
              background: '#4a7c2f',
              border: 'none',
              borderRadius: '8px',
              padding: '0.5rem 1.25rem',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'background 0.2s'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#3d6827')}
            onMouseLeave={e => (e.currentTarget.style.background = '#4a7c2f')}
          >
            🔊 Enable Sound
          </button>
        </div>
      )}

      {/* ─── Active banner once unlocked ──────────────────────────────── */}
      {audioUnlocked && (
        <div style={{
          background: 'rgba(74, 124, 47, 0.08)',
          border: '1px solid rgba(74, 124, 47, 0.25)',
          borderRadius: '10px',
          padding: '0.5rem 1.25rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.8rem',
          color: '#6db33f'
        }}>
          <span>🔊</span>
          <span>Voice alerts active — you'll hear announcements automatically when patients check in.</span>
        </div>
      )}

      {/* Header View */}
      <div className="dashboard-header-panel">
        <div>
          <h1 style={{ fontSize: '1.75rem', margin: 0, fontWeight: 700 }}>
            Practitioner Dashboard
          </h1>
          <p style={{ fontSize: '0.875rem' }}>
            Logged in as: <strong style={{ color: 'var(--accent-color)' }}>{selectedDoctor.name}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {audioUnlocked && (
            <button
              onClick={handleTestVoice}
              style={{
                background: 'rgba(74,124,47,0.15)',
                border: '1px solid rgba(74,124,47,0.4)',
                borderRadius: '8px',
                padding: '0.5rem 1rem',
                color: '#6db33f',
                fontWeight: 600,
                fontSize: '0.8rem',
                cursor: 'pointer'
              }}
            >
              🔊 Test Voice
            </button>
          )}
          <button className="btn btn-secondary" onClick={handleLogout}>
            Switch Profile / Log Out
          </button>
        </div>
      </div>

      {/* 4 Status columns specific to this doctor */}
      <div className="board-grid">
        
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
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Awaiting QR Scan</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 2: Checked In (Awaiting Acknowledge / Escalating) */}
        <div className="board-column">
          <div className="column-header">
            <h3 className="column-title" style={{ color: 'var(--status-checked-in)' }}>
              <span className="pulse-indicator arrived"></span>
              Your Arrived Patients
            </h3>
            <span className="column-count">
              {checkedInCol.length}
            </span>
          </div>
          <div className="column-cards-container">
            {checkedInCol.length === 0 ? (
              <p style={{ textAlign: 'center', margin: '2rem 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                No patients in waiting room
              </p>
            ) : (
              checkedInCol.map(appt => (
                <PatientWaitingCard
                  key={appt.id}
                  appt={appt}
                  escalationWindowSeconds={escalationWindowSeconds}
                  onAcknowledge={handleAcknowledge}
                  onDeveloperEscalate={handleDeveloperEscalate}
                  onSpeakReminder={handleSpeakReminder}
                />
              ))
            )}
          </div>
        </div>

        {/* Column 3: In Consultation */}
        <div className="board-column">
          <div className="column-header">
            <h3 className="column-title" style={{ color: 'var(--status-consultation)' }}>
              <span className="pulse-indicator active"></span>
              Active Consultations
            </h3>
            <span className="column-count">{consultationCol.length}</span>
          </div>
          <div className="column-cards-container">
            {consultationCol.length === 0 ? (
              <p style={{ textAlign: 'center', margin: '2rem 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                No active consult sessions
              </p>
            ) : (
              consultationCol.map(appt => (
                <div key={appt.id} className="patient-mini-card state-in_consultation">
                  <div className="card-header">
                    <span className="patient-name">{appt.patient_name}</span>
                    <span className="appointment-time">Active</span>
                  </div>
                  
                  {appt.status === 'acknowledged' && (
                    <div className="card-actions">
                      <button className="btn btn-primary" onClick={() => handleStartConsultation(appt.id)}>
                        Start Consultation
                      </button>
                    </div>
                  )}

                  {appt.status === 'in_consultation' && (
                    <div className="card-actions">
                      <button 
                        className="btn btn-secondary"
                        style={{ borderColor: 'var(--status-consultation)', color: '#a7f3d0' }}
                        onClick={() => handleComplete(appt.id)}
                      >
                        Mark Completed
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 4: Completed */}
        <div className="board-column">
          <div className="column-header">
            <h3 className="column-title" style={{ color: 'var(--status-completed)' }}>✓ Completed Today</h3>
            <span className="column-count">{completedCol.length}</span>
          </div>
          <div className="column-cards-container">
            {completedCol.length === 0 ? (
              <p style={{ textAlign: 'center', margin: '2rem 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                No consultations finished yet
              </p>
            ) : (
              completedCol.map(appt => (
                <div key={appt.id} className="patient-mini-card state-completed">
                  <div className="card-header">
                    <span className="patient-name">{appt.patient_name}</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--status-consultation)', fontWeight: 600, marginTop: '0.25rem' }}>
                    ✓ Done
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Notifications Drawer */}
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
