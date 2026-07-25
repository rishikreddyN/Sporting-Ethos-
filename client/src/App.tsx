import { useState, useEffect } from 'react';
import LandingPage from './pages/LandingPage';
import PatientCheckIn from './pages/PatientCheckIn';
import DoctorDashboard from './pages/DoctorDashboard';
import ReceptionistDashboard from './pages/ReceptionistDashboard';
import MockAdmin from './pages/MockAdmin';

export default function App() {
  const getRouteInfo = () => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const name = params.get('name');
    const time = params.get('time');
    const patientId = params.get('patientId');
    
    // Support routing paths
    if (path === '/patient' || token) {
      return { page: 'patient', token, name, time, patientId };
    } else if (path === '/doctor') {
      return { page: 'doctor', token: null, name: null, time: null, patientId: null };
    } else if (path === '/dashboard') {
      return { page: 'dashboard', token: null, name: null, time: null, patientId: null };
    } else if (path === '/admin') {
      return { page: 'admin', token: null, name: null, time: null, patientId: null };
    } else {
      return { page: 'landing', token: null, name: null, time: null, patientId: null };
    }
  };

  const [route, setRoute] = useState(getRouteInfo());

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRouteInfo());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setRoute(getRouteInfo());
  };

  const renderContent = () => {
    switch (route.page) {
      case 'patient':
        return <PatientCheckIn 
          token={route.token} 
          preName={(route as any).name}
          preTime={(route as any).time}
          prePatientId={(route as any).patientId}
        />;
      case 'doctor':
        return <DoctorDashboard />;
      case 'dashboard':
        return <ReceptionistDashboard />;
      case 'admin':
        return <MockAdmin />;
      case 'landing':
      default:
        return <LandingPage onNavigate={navigateTo} />;
    }
  };

  // Hide clinic navigation headers from patients and landing selector views
  const hideNavbar = route.page === 'patient' || route.page === 'landing';

  return (
    <div className="app-container">
      {!hideNavbar && (
        <header className="navbar">
          <a href="#" className="brand" onClick={(e) => { e.preventDefault(); navigateTo('/'); }}>
            ⚡ <span className="brand-accent">Sporting Ethos</span> High Performance
          </a>
          <nav className="nav-links">
            <a
              href="/dashboard"
              className={`nav-link ${route.page === 'dashboard' ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); navigateTo('/dashboard'); }}
            >
              Receptionist Board
            </a>
            <a
              href="/doctor"
              className={`nav-link ${route.page === 'doctor' ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); navigateTo('/doctor'); }}
            >
              Doctor Dashboard
            </a>
            <a
              href="/admin"
              className={`nav-link ${route.page === 'admin' ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); navigateTo('/admin'); }}
            >
              Mock Admin Control (Dev)
            </a>
          </nav>
        </header>
      )}
      
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {renderContent()}
      </main>
    </div>
  );
}
